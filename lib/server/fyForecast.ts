import { getPromoOverlays, getWeeklyFacts } from "@/lib/repo";
import { isNonPerformance } from "@/lib/data/nonPerformanceTypes";
import { getState } from "@/lib/server/appstate";
import type { NielsenWeeklyRow } from "@/lib/types/db";
import type { PlanAdjustment } from "@/lib/repo/client";
import { itemRatio, projectItemWeek, trendOf, type Trend } from "@/lib/server/projection";
import { readLeOverlay, type LeOverlay } from "@/lib/leovl";

/* The FY forecast construction, shared by the Sales Dashboard's FY mode and
   the Monthly Forecast Review (and matching the Base Business Review Total-year view):
   measured actuals through the NIQ data edge, then, per division × brand ×
   item, each remaining week's base projected as last year's shape at this
   year's run-rate (lib/server/projection: the aligned 2025 week scaled by
   how the latest 13 weeks are running against a year earlier, the item's
   own ratio where it is big enough to read, the brand's where it is not) ×
   the expected lift of whichever Telus performance window covers the week —
   the windows' predicted lift (year-ago actual vs base over the shifted
   window, promoted-week average fallback). Funding vehicles (EDLP, Slotting)
   add no lift; overlapping windows take the strongest read. The brand's
   series is the sum of its items', by construction. */

const DAY = 86400000;
const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
const yearAgoWeek = (w: string) => new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);

// LE adjustments (adj:<mkt>:<year>) apply to the FORECAST weeks; a short
// cache keeps the dashboard's 13-division × 3-brand sweep to one read each
const adjCache = new Map<string, { at: number; adjs: PlanAdjustment[] }>();
async function adjustmentsFor(mkt: string, year: number): Promise<PlanAdjustment[]> {
  const key = `${mkt}:${year}`;
  const hit = adjCache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.adjs;
  const adjs = ((await getState(`adj:${mkt}:${year}`).catch(() => undefined)) as PlanAdjustment[] | undefined) ?? [];
  adjCache.set(key, { at: Date.now(), adjs });
  return adjs;
}

// the estimate's promotion changes (leovl:<mkt>:<year>) — same short cache
const ovlCache = new Map<string, { at: number; ovl: LeOverlay }>();
async function overlayFor(mkt: string, year: number): Promise<LeOverlay> {
  const key = `${mkt}:${year}`;
  const hit = ovlCache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.ovl;
  const ovl = readLeOverlay(await getState(`leovl:${mkt}:${year}`).catch(() => undefined));
  ovlCache.set(key, { at: Date.now(), ovl });
  return ovl;
}

/** Drop the cached adjustments and overlays — called when either is written,
    so the very next forecast reads the new document rather than a copy up to
    five seconds old. */
export function invalidateForecastCaches() {
  adjCache.clear();
  ovlCache.clear();
}

export type FyWeek = {
  w: string;
  measured: boolean;  // on file, vs forecast
  ty$: number;        // this year: measured retail dollars, or the forecast
  tyU: number;
  prior$: number;     // prior-year actuals on the aligned week (364 days back)
  priorU: number;
};

/* The whole construction for ONE item's rows. The seasonality index, the
   trend the projection runs at and each window's expected lift are the
   BRAND's (Telus windows are brand-level, and a small item's own lift read is
   noise), while the base, the actuals and the shape are the item's own — its
   own trend ratio where it is big enough to read. The brand's series is the
   sum of its items' (see fyWeeklySeries), so items always sum to the brand. */
function buildSeries(
  rows: NielsenWeeklyRow[],
  ctx: BrandCtx,
  fyWeeks: string[],
  allWeeks: string[],
  latestWeek: string,
  upc: string
): FyWeek[] {
  const wA$ = new Map<string, number>(), wAU = new Map<string, number>();
  const wB$ = new Map<string, number>(), wBU = new Map<string, number>();
  let firstWeek: string | undefined;
  for (const r of rows) {
    wA$.set(r.week_ending, (wA$.get(r.week_ending) ?? 0) + (r.dollars ?? 0));
    wAU.set(r.week_ending, (wAU.get(r.week_ending) ?? 0) + (r.units ?? 0));
    wB$.set(r.week_ending, (wB$.get(r.week_ending) ?? 0) + (r.base_dollars ?? r.dollars ?? 0));
    wBU.set(r.week_ending, (wBU.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
    if (firstWeek === undefined || r.week_ending < firstWeek) firstWeek = r.week_ending;
  }
  const last52 = allWeeks.slice(-52);
  const avg52$ = last52.reduce((a, w) => a + (wB$.get(w) ?? 0), 0) / Math.max(last52.length, 1);
  const avg52U = last52.reduce((a, w) => a + (wBU.get(w) ?? 0), 0) / Math.max(last52.length, 1);
  const live = ctx.live.has(upc);
  const ratio$ = itemRatio(wB$, allWeeks, ctx.trend$);
  const ratioU = itemRatio(wBU, allWeeks, ctx.trendU);
  const proj = (im: Map<string, number>, w: string, ratio: number, a52: number) =>
    live ? projectItemWeek({ im, w, firstWeek, ratio, a52, engine: ctx.engine, measuredWeeks: allWeeks, shapeYearsBack: 1 }) : 0;

  return fyWeeks.map((w) => {
    const src = yearAgoWeek(w);
    const measured = w <= latestWeek;
    let ty$: number, tyU: number;
    if (measured) {
      ty$ = wA$.get(w) ?? 0; tyU = wAU.get(w) ?? 0;
    } else {
      const base$ = proj(wB$, w, ratio$, avg52$);
      const baseU = proj(wBU, w, ratioU, avg52U);
      const wt = utcOf(w);
      let lift = 0;
      for (const o of ctx.lifts) if (o.s <= wt && o.e >= wt - 6 * DAY) lift = Math.max(lift, o.lift);
      /* LE adjustments on the forecast weeks: applied in full on the item
         they name, and item rows weighted by the item's share of the brand
         base only when the series is the whole brand. */
      let f = 1;
      for (const a of ctx.brandAdjs) {
        if (utcOf(a.from) > wt || utcOf(a.to) < wt - 6 * DAY) continue;
        f *= 1 + (a.pct / 100) * (a.upc === "ALL" ? 1 : a.upc === upc ? 1 : 0);
      }
      ty$ = base$ * (1 + lift) * f; tyU = baseU * (1 + lift) * f;
    }
    return { w, measured, ty$, tyU, prior$: wA$.get(src) ?? 0, priorU: wAU.get(src) ?? 0 };
  });
}

type BrandCtx = {
  engine: number[];                     // month index over the items that still sell
  live: Set<string>;                    // items with volume in the latest 52 weeks
  trend$: Trend;                        // the brand this year against last, dollars …
  trendU: Trend;                        // … and units — the level the projection runs at
  lifts: { s: number; e: number; lift: number }[];
  brandAdjs: PlanAdjustment[];
};

/** The seasonality shape, each Telus window's expected lift, the LE
    adjustments and the item base shares for a division × brand — the context
    every series under that brand shares. */
async function brandContext(code: string, brand: string, facts: NielsenWeeklyRow[], allWeeks: string[], fyYear: number): Promise<BrandCtx> {
  const wAU = new Map<string, number>(), wBU = new Map<string, number>(), wAcv = new Map<string, number>();
  const last52From = allWeeks[Math.max(allWeeks.length - 52, 0)] ?? "";
  // the items that still sell — the only ones the projection is for, and the
  // only ones whose history shapes it (a delisted item's shape is not on the shelf)
  const live = new Set(facts.filter((r) => r.week_ending >= last52From && (r.units ?? 0) > 0).map((r) => r.upc));
  const liveB$ = new Map<string, number>(), liveBU = new Map<string, number>();
  for (const r of facts) {
    const b = r.base_units ?? r.units ?? 0;
    wAU.set(r.week_ending, (wAU.get(r.week_ending) ?? 0) + (r.units ?? 0));
    wBU.set(r.week_ending, (wBU.get(r.week_ending) ?? 0) + b);
    wAcv.set(r.week_ending, Math.max(wAcv.get(r.week_ending) ?? 0, r.acv_any_promo ?? 0));
    if (live.has(r.upc)) {
      liveBU.set(r.week_ending, (liveBU.get(r.week_ending) ?? 0) + b);
      liveB$.set(r.week_ending, (liveB$.get(r.week_ending) ?? 0) + (r.base_dollars ?? r.dollars ?? 0));
    }
  }

  // seasonality engine over the items that still sell, for items without a shape of their own
  const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
  let grandSum = 0;
  for (const [w, v] of liveBU) {
    monthTot[+w.slice(5, 7) - 1] += v; monthN[+w.slice(5, 7) - 1] += 1; grandSum += v;
  }
  const grandAvg = grandSum / Math.max(liveBU.size, 1);
  const engine = monthTot.map((t, m) => (monthN[m] > 0 && grandAvg > 0 ? t / monthN[m] / grandAvg : 1));
  // this year against last for the brand — the level the projection runs at
  const trend$ = trendOf(liveB$, allWeeks);
  const trendU = trendOf(liveBU, allWeeks);

  // expected lift per Telus window — year-ago actual vs base over the shifted
  // window (units), promoted-week average as the fallback
  let pA = 0, pB = 0;
  for (const [w, acv] of wAcv) {
    if (acv >= 10) { pA += wAU.get(w) ?? 0; pB += wBU.get(w) ?? 0; }
  }
  const fallbackLift = pB > 0 ? (pA - pB) / pB : 0;
  const liftOver = (sISO: string, eISO: string) => {
    const s = utcOf(sISO), e = utcOf(eISO);
    let a = 0, bb = 0;
    for (const w of allWeeks) {
      const wt = utcOf(w);
      if (s <= wt && e >= wt - 6 * DAY) { a += wAU.get(w) ?? 0; bb += wBU.get(w) ?? 0; }
    }
    return bb > 0 ? (a - bb) / bb : null;
  };
  /* The book's windows, read through the estimate's overlay: a cancelled
     promotion carries no lift, a changed one runs on its new window (and
     its stated lift, when one was given), and an added one is a window of
     its own. All of it only ever reaches the FORECAST weeks — a promotion
     that has already run is in the actuals whatever the overlay says. */
  const ovl = await overlayFor(code, fyYear);
  const liftFor = (sISO: string, eISO: string, stated: number | null | undefined) =>
    stated === null || stated === undefined ? (liftOver(yearAgoWeek(sISO), yearAgoWeek(eISO)) ?? fallbackLift) : stated / 100;
  const lifts = (await getPromoOverlays({ market_code: code, brand }))
    .filter((o) => !isNonPerformance(o.performance_type) && !ovl.cancelled[o.promo_id])
    .map((o) => {
      const c = ovl.changes[o.promo_id];
      const sISO = c?.start ?? o.start_date, eISO = c?.end ?? o.end_date;
      return { s: utcOf(sISO), e: utcOf(eISO), lift: liftFor(sISO, eISO, c?.lift_pct) };
    });
  for (const a of ovl.added) {
    if (a.brand !== brand || isNonPerformance(a.perf)) continue;
    lifts.push({ s: utcOf(a.start), e: utcOf(a.end), lift: liftFor(a.start, a.end, a.lift_pct) });
  }

  const brandAdjs = (await adjustmentsFor(code, fyYear)).filter((a) => a.brand === brand);
  return { engine, live, trend$, trendU, lifts, brandAdjs };
}

/** The FY weekly series for one division × brand (optionally one item);
    null when no facts exist. The brand's series is the sum of its items'. */
export async function fyWeeklySeries(
  code: string,
  brand: string,
  fyWeeks: string[],
  allWeeks: string[],
  latestWeek: string,
  upc?: string
): Promise<FyWeek[] | null> {
  const byItem = await fyWeeklyByItem(code, brand, fyWeeks, allWeeks, latestWeek);
  if (!byItem.size) return null;
  if (upc) return byItem.get(upc) ?? null;
  const sum: FyWeek[] = fyWeeks.map((w) => ({ w, measured: w <= latestWeek, ty$: 0, tyU: 0, prior$: 0, priorU: 0 }));
  for (const series of byItem.values()) {
    series.forEach((x, i) => { sum[i].ty$ += x.ty$; sum[i].tyU += x.tyU; sum[i].prior$ += x.prior$; sum[i].priorU += x.priorU; });
  }
  return sum;
}

/** The same series for every item under a division × brand, in one pass.
    Summing these gives the brand series exactly — the Monthly Forecast
    Review, the LE snapshots and their item drill-downs all rest on that. */
export async function fyWeeklyByItem(
  code: string,
  brand: string,
  fyWeeks: string[],
  allWeeks: string[],
  latestWeek: string
): Promise<Map<string, FyWeek[]>> {
  const out = new Map<string, FyWeek[]>();
  const all = await getWeeklyFacts({ market_code: code, brand });
  if (!all.length) return out;
  const ctx = await brandContext(code, brand, all, allWeeks, +fyWeeks[0].slice(0, 4));
  const byUpc = new Map<string, NielsenWeeklyRow[]>();
  for (const r of all) (byUpc.get(r.upc) ?? byUpc.set(r.upc, []).get(r.upc)!).push(r);
  for (const [upc, rows] of byUpc) {
    out.set(upc, buildSeries(rows, ctx, fyWeeks, allWeeks, latestWeek, upc));
  }
  return out;
}
