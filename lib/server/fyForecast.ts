import { getPromoOverlays, getWeeklyFacts } from "@/lib/repo";
import { isNonPerformance } from "@/lib/data/nonPerformanceTypes";
import { getState } from "@/lib/server/appstate";
import type { PlanAdjustment } from "@/lib/repo/client";

/* The FY forecast construction, shared by the Sales Dashboard's FY mode and
   the Monthly Forecast Review (and matching the Base & Lift Total-year view):
   measured actuals through the NIQ data edge, then, per division × brand,
   each week's year-ago NIQ base carried 364 days forward (engine-shaped
   latest-52-week run rate where a source week is unmeasured) × the expected
   lift of whichever Telus performance window covers the week — the windows'
   predicted lift (year-ago actual vs base over the shifted window, promoted-
   week average fallback). Funding vehicles (EDLP, Slotting) add no lift;
   overlapping windows take the strongest read. */

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

export type FyWeek = {
  w: string;
  measured: boolean;  // on file, vs forecast
  ty$: number;        // this year: measured retail dollars, or the forecast
  tyU: number;
  prior$: number;     // prior-year actuals on the aligned week (364 days back)
  priorU: number;
};

/** The FY weekly series for one division × brand (optionally one item);
    null when no facts exist. */
export async function fyWeeklySeries(
  code: string,
  brand: string,
  fyWeeks: string[],
  allWeeks: string[],
  latestWeek: string,
  upc?: string
): Promise<FyWeek[] | null> {
  let facts = await getWeeklyFacts({ market_code: code, brand });
  if (upc) facts = facts.filter((r) => r.upc === upc);
  if (!facts.length) return null;

  const wA$ = new Map<string, number>(), wAU = new Map<string, number>();
  const wB$ = new Map<string, number>(), wBU = new Map<string, number>();
  const wAcv = new Map<string, number>();
  for (const r of facts) {
    wA$.set(r.week_ending, (wA$.get(r.week_ending) ?? 0) + (r.dollars ?? 0));
    wAU.set(r.week_ending, (wAU.get(r.week_ending) ?? 0) + (r.units ?? 0));
    wB$.set(r.week_ending, (wB$.get(r.week_ending) ?? 0) + (r.base_dollars ?? r.dollars ?? 0));
    wBU.set(r.week_ending, (wBU.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
    wAcv.set(r.week_ending, Math.max(wAcv.get(r.week_ending) ?? 0, r.acv_any_promo ?? 0));
  }

  // seasonality engine + latest-52 run rate, for source weeks never measured
  const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
  let grandSum = 0;
  for (const [w, v] of wBU) {
    monthTot[+w.slice(5, 7) - 1] += v; monthN[+w.slice(5, 7) - 1] += 1; grandSum += v;
  }
  const grandAvg = grandSum / Math.max(wBU.size, 1);
  const engine = monthTot.map((t, m) => (monthN[m] > 0 && grandAvg > 0 ? t / monthN[m] / grandAvg : 1));
  const last52 = allWeeks.slice(-52);
  const avg52$ = last52.reduce((a, w) => a + (wB$.get(w) ?? 0), 0) / Math.max(last52.length, 1);
  const avg52U = last52.reduce((a, w) => a + (wBU.get(w) ?? 0), 0) / Math.max(last52.length, 1);

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
  const windows = (await getPromoOverlays({ market_code: code, brand }))
    .filter((o) => !isNonPerformance(o.performance_type))
    .map((o) => ({
      s: utcOf(o.start_date), e: utcOf(o.end_date),
      lift: liftOver(yearAgoWeek(o.start_date), yearAgoWeek(o.end_date)) ?? fallbackLift,
    }));

  /* LE adjustments on the forecast weeks — the same multiplier rule the plan
     view applies: item rows weighted by the item's share of the brand base
     (latest 52 measured weeks). Measured weeks never move. */
  const fyYear = +fyWeeks[0].slice(0, 4);
  const brandAdjs = (await adjustmentsFor(code, fyYear)).filter((a) => a.brand === brand);
  const shareTot = new Map<string, number>();
  let shareSum = 0;
  if (brandAdjs.some((a) => a.upc !== "ALL")) {
    const last52Set = new Set(allWeeks.slice(-52));
    for (const r of facts) {
      const v = r.base_units ?? r.units ?? 0;
      if (last52Set.has(r.week_ending) && v > 0) {
        shareTot.set(r.upc, (shareTot.get(r.upc) ?? 0) + v);
        shareSum += v;
      }
    }
  }
  const share = (u: string) => (shareSum > 0 ? (shareTot.get(u) ?? 0) / shareSum : 0);

  return fyWeeks.map((w) => {
    const src = yearAgoWeek(w);
    const measured = w <= latestWeek;
    let ty$: number, tyU: number;
    if (measured) {
      ty$ = wA$.get(w) ?? 0; tyU = wAU.get(w) ?? 0;
    } else {
      const m = +w.slice(5, 7) - 1;
      const base$ = src <= latestWeek ? (wB$.get(src) ?? 0) : avg52$ * engine[m];
      const baseU = src <= latestWeek ? (wBU.get(src) ?? 0) : avg52U * engine[m];
      const wt = utcOf(w);
      let lift = 0;
      for (const o of windows) if (o.s <= wt && o.e >= wt - 6 * DAY) lift = Math.max(lift, o.lift);
      let f = 1;
      for (const a of brandAdjs) {
        if (utcOf(a.from) > wt || utcOf(a.to) < wt - 6 * DAY) continue;
        f *= 1 + (a.pct / 100) * (a.upc === "ALL" ? 1 : upc ? (a.upc === upc ? 1 : 0) : share(a.upc));
      }
      ty$ = base$ * (1 + lift) * f; tyU = baseU * (1 + lift) * f;
    }
    return { w, measured, ty$, tyU, prior$: wA$.get(src) ?? 0, priorU: wAU.get(src) ?? 0 };
  });
}
