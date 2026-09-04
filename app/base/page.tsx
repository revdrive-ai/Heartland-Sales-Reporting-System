import { getPriceList, getPromoOverlays, getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import ScopeEmpty from "@/components/ScopeEmpty";
import BaseView, { type BaseData, type WeekPoint } from "@/components/base/BaseView";

/* Base & Lift Lab — the Nielsen weekly trend (actual vs NIQ base) for one
   division × brand (or a single item), with the Telus promotion windows
   overlaid and the seasonality-index card beside the chart. Timeframes:
   rolling windows (4/13/26/52 weeks, year-to-date) or a total calendar year —
   including future years, which render as a planning view until their NIQ
   weeks land. Controls travel in the URL. */

const OWN_BRANDS = ["SPLENDA", "SLIMFAST", "JAVA HOUSE"]; // NIQ brands with own-side data
const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const ROLLING: Record<string, number> = { "4w": 4, "13w": 13, "26w": 26, "52w": 52 };
const FIRST_PLAN_YEAR = 2024;
const DAY = 86400000;

/** Every NIQ week-ending (Saturday) of a calendar year. */
function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mkt?: string; brand?: string; item?: string; metric?: string; win?: string }>;
}) {
  const sp = await searchParams;
  const [allMarkets, gscope, allItems] = await Promise.all([listMarkets(), getScope(), listItems()]);
  const markets = gscope.active ? allMarkets.filter((m) => gscope.marketCodes.includes(m.code)) : allMarkets;
  if (gscope.active && markets.length === 0) {
    return (
      <ScopeEmpty current="base" crumb="Trade Workflow · Step 1" title="Base & Lift Lab"
        label={gscope.label}
        message="No Nielsen trading areas in this scope have data on file — only the 13 ALBSCO divisions are loaded so far." />
    );
  }
  const mkt = markets.some((m) => m.code === sp.mkt) ? sp.mkt!
    : markets.some((m) => m.code === "ALB-JEWEL") ? "ALB-JEWEL" : markets[0].code;
  const brand = OWN_BRANDS.includes(sp.brand ?? "") ? sp.brand! : "SPLENDA";
  const metric = sp.metric === "dollars" ? "dollars" : "units";

  const allWeeks = await listWeekEndings(mkt);
  const latestWeek = allWeeks[allWeeks.length - 1];
  const latestDataYear = +latestWeek.slice(0, 4);
  const currentYear = new Date().getUTCFullYear();

  // Total-year choices run 2024 → two years past today, in perpetuity.
  const years: number[] = [];
  for (let y = FIRST_PLAN_YEAR; y <= Math.max(latestDataYear, currentYear) + 2; y++) years.push(y);

  // Timeframe: rolling (4w/13w/26w/52w), year-to-date, or a total year.
  const rawWin = sp.win ?? "52w";
  const win = ROLLING[rawWin] || rawWin === "ytd" || (/^\d{4}$/.test(rawWin) && years.includes(+rawWin))
    ? rawWin : "52w";

  let weeks: string[];
  let winLabel: string;
  let planningYear = false;
  if (ROLLING[win]) {
    weeks = allWeeks.slice(-ROLLING[win]);
    winLabel = `Latest ${ROLLING[win]} weeks`;
  } else if (win === "ytd") {
    weeks = allWeeks.filter((w) => w.startsWith(String(latestDataYear)));
    winLabel = `Year to date (${latestDataYear})`;
  } else {
    const y = +win;
    weeks = allWeeks.filter((w) => w.startsWith(win));
    winLabel = `Total year ${y}`;
    if (weeks.length === 0) {
      weeks = saturdaysOfYear(y); // future year — the expected NIQ week axis
      planningYear = true;
    }
  }
  const from = weeks[0];
  const to = weeks[weeks.length - 1];

  // Every week on file for this division × brand — drives the item list and
  // the seasonality card (which always uses full history, not the window).
  const factsAll = await getWeeklyFacts({ market_code: mkt, brand });
  // Item picker: only items that actually moved volume in the latest 52 weeks
  // at this division × brand — dead/delisted items drop out of the list.
  const recentFrom = allWeeks[Math.max(allWeeks.length - 52, 0)];
  const upcsWithVolume = new Set(
    factsAll.filter((r) => r.week_ending >= recentFrom && (r.units ?? 0) > 0).map((r) => r.upc)
  );
  const items = allItems
    .filter((i) => i.brand === brand && upcsWithVolume.has(i.upc))
    .map((i) => ({ upc: i.upc, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const item = items.some((i) => i.upc === sp.item) ? sp.item! : "ALL";
  const itemName = item === "ALL" ? null : items.find((i) => i.upc === item)!.name;

  const scoped = factsAll.filter((r) => item === "ALL" || r.upc === item);
  const facts = planningYear ? [] : scoped.filter((r) => r.week_ending >= from && r.week_ending <= to);

  // full-history weekly actuals for the selection — feeds the year-ago overlay
  const weekActual = new Map<string, number>();
  for (const r of scoped) {
    const v = (metric === "units" ? r.units : r.dollars) ?? 0;
    weekActual.set(r.week_ending, (weekActual.get(r.week_ending) ?? 0) + v);
  }
  const yearAgoWeek = (w: string) =>
    new Date(Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10)) - 364 * DAY).toISOString().slice(0, 10);

  // aggregate the selection per week (trend chart)
  const byWeek = new Map<string, WeekPoint>();
  for (const w of weeks) {
    const ly = weekActual.get(yearAgoWeek(w));
    byWeek.set(w, { week: w, actual: planningYear ? null : 0, base: planningYear ? null : 0, actualLY: ly === undefined ? null : Math.round(ly), promoAcv: 0 });
  }
  for (const r of facts) {
    const p = byWeek.get(r.week_ending);
    if (!p) continue;
    p.actual = (p.actual ?? 0) + ((metric === "units" ? r.units : r.dollars) ?? 0);
    p.base = (p.base ?? 0) + ((metric === "units" ? r.base_units : r.base_dollars) ?? 0);
    p.promoAcv = Math.max(p.promoAcv, r.acv_any_promo ?? 0);
  }
  const points = weeks.map((w) => {
    const p = byWeek.get(w)!;
    return {
      ...p,
      actual: p.actual === null ? null : Math.round(p.actual),
      base: p.base === null ? null : Math.round(p.base),
      promoAcv: Math.round(p.promoAcv * 10) / 10,
    };
  });

  /* Seasonality index over the full history: monthly average weekly base
     units (the promo-stripped series) against the all-weeks average — the
     "engine" curve — plus each year's own actuals-derived index. */
  const weekBase = new Map<string, number>();
  for (const r of scoped) {
    const v = (r.base_units ?? r.units ?? 0);
    weekBase.set(r.week_ending, (weekBase.get(r.week_ending) ?? 0) + v);
  }
  const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
  const yearly = new Map<number, { tot: number[]; n: number[] }>();
  for (const [w, v] of weekBase) {
    const m = +w.slice(5, 7) - 1;
    const y = +w.slice(0, 4);
    monthTot[m] += v; monthN[m] += 1;
    const yr = yearly.get(y) ?? { tot: Array(12).fill(0), n: Array(12).fill(0) };
    yr.tot[m] += v; yr.n[m] += 1;
    yearly.set(y, yr);
  }
  const grandAvg = [...weekBase.values()].reduce((a, v) => a + v, 0) / Math.max(weekBase.size, 1);
  const idx = (tot: number[], n: number[], avg: number) =>
    tot.map((t, m) => (n[m] > 0 && avg > 0 ? +(t / n[m] / avg).toFixed(3) : null));
  const engine = idx(monthTot, monthN, grandAvg);
  const seasonYears = [...yearly.entries()]
    .filter(([, v]) => v.n.filter((x) => x > 0).length >= 6) // skip heavily partial years
    .sort(([a], [b]) => a - b)
    .map(([y, v]) => {
      const wks = v.n.reduce((a, x) => a + x, 0);
      const avg = v.tot.reduce((a, x) => a + x, 0) / Math.max(wks, 1);
      return { label: String(y), values: idx(v.tot, v.n, avg) };
    });

  /* Plan-year series: for a future year, carry the actual NIQ base from the
     matching weeks a year earlier (364 days — Saturdays stay aligned) as far
     as that source year has actualized, and project the remaining weeks as
     the latest-52-week average base shaped by the seasonality engine. */
  let plan: BaseData["plan"] = null;
  if (planningYear) {
    const weekBaseM = new Map<string, number>(); // weekly base in the chosen metric
    for (const r of scoped) {
      const v = (metric === "units" ? r.base_units ?? r.units : r.base_dollars ?? r.dollars) ?? 0;
      weekBaseM.set(r.week_ending, (weekBaseM.get(r.week_ending) ?? 0) + v);
    }
    const last52 = allWeeks.slice(-52);
    const avgBase = last52.reduce((a, w) => a + (weekBaseM.get(w) ?? 0), 0) / Math.max(last52.length, 1);
    const actualized: (number | null)[] = [];
    const projected: (number | null)[] = [];
    let nAct = 0;
    for (const w of weeks) {
      const src = yearAgoWeek(w);
      if (src <= latestWeek) {
        actualized.push(Math.round(weekBaseM.get(src) ?? 0));
        projected.push(null);
        nAct++;
      } else {
        actualized.push(null);
        projected.push(Math.round(avgBase * (engine[+w.slice(5, 7) - 1] ?? 1)));
      }
    }
    // Each item's share of the brand base over the latest 52 weeks — the
    // weight an item-level planner adjustment carries in the all-items view.
    const last52Set = new Set(last52);
    const shareTot = new Map<string, number>();
    let shareSum = 0;
    for (const r of factsAll) {
      if (!last52Set.has(r.week_ending)) continue;
      const v = (metric === "units" ? r.base_units ?? r.units : r.base_dollars ?? r.dollars) ?? 0;
      shareTot.set(r.upc, (shareTot.get(r.upc) ?? 0) + v);
      shareSum += v;
    }
    const itemShare: Record<string, number> = {};
    for (const [u, v] of shareTot) itemShare[u] = shareSum > 0 ? +(v / shareSum).toFixed(4) : 0;

    plan = {
      sourceYear: +win - 1,
      actualized,
      projected,
      actualizedWeeks: nAct,
      totActualized: actualized.reduce((a: number, v) => a + (v ?? 0), 0),
      totProjected: projected.reduce((a: number, v) => a + (v ?? 0), 0),
      itemShare,
    };
  }

  /* Dated list-price changes touching this selection inside the window — a
     record counts as a change only when an earlier record exists for the same
     item, so the initial list seeding doesn't mark every chart. */
  const selUpcs = new Set(item === "ALL" ? items.map((i) => i.upc) : [item]);
  const priceRows = await getPriceList();
  const seenFg = new Set<string>();
  const priceMarks: { date: string; label: string }[] = [];
  for (const r of priceRows) { // sorted fg → effective_from
    const isChange = seenFg.has(r.fg);
    seenFg.add(r.fg);
    if (!isChange || !r.upc || !selUpcs.has(r.upc)) continue;
    if (r.effective_from < from || r.effective_from > to) continue;
    priceMarks.push({
      date: r.effective_from,
      label: `${r.item.length > 22 ? r.item.slice(0, 21) + "…" : r.item}${r.unit_price !== null ? ` $${r.unit_price.toFixed(2)}` : ""}`,
    });
  }

  const overlays = await getPromoOverlays({ market_code: mkt, brand, from, to });

  /* Lift per promotion window, in the chosen metric.
     Actual lift: (actual − NIQ base) / base summed over the window's weeks on
     file. Predicted lift: the same measure over the matching weeks a year
     earlier — what this window "should" do based on last year — falling back
     to the selection's all-history promoted-week lift (weeks where NIQ saw
     ≥ 10 %ACV promo support) when there is no year-ago data. */
  const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
  const weekBaseFull = new Map<string, number>(); // full-history base, chosen metric
  for (const r of scoped) {
    const v = (metric === "units" ? r.base_units : r.base_dollars) ?? 0;
    weekBaseFull.set(r.week_ending, (weekBaseFull.get(r.week_ending) ?? 0) + v);
  }
  const promoWeeks = new Set<string>();
  for (const r of scoped) if ((r.acv_any_promo ?? 0) >= 10) promoWeeks.add(r.week_ending);
  let pA = 0, pB = 0;
  for (const w of promoWeeks) { pA += weekActual.get(w) ?? 0; pB += weekBaseFull.get(w) ?? 0; }
  const fallbackLift = pB > 0 ? (pA - pB) / pB : null;

  const liftOver = (sISO: string, eISO: string) => {
    const s = utcOf(sISO), e = utcOf(eISO);
    let a = 0, b = 0, n = 0;
    for (const w of allWeeks) {
      const wt = utcOf(w); // a week-ending Saturday covers the 7 days ending that day
      if (s <= wt && e >= wt - 6 * DAY) { a += weekActual.get(w) ?? 0; b += weekBaseFull.get(w) ?? 0; n++; }
    }
    return { lift: n > 0 && b > 0 ? (a - b) / b : null, weeks: n };
  };
  const overlayRows = overlays.map((o) => {
    const act = liftOver(o.start_date, o.end_date);
    const pred = liftOver(yearAgoWeek(o.start_date), yearAgoWeek(o.end_date));
    return {
      ...o,
      pred_lift: pred.lift ?? fallbackLift,
      pred_fallback: pred.lift === null,
      actual_lift: act.lift,
      lift_partial: utcOf(o.end_date) > utcOf(latestWeek),
    };
  });

  const totActual = points.reduce((a, p) => a + (p.actual ?? 0), 0);
  const totBase = points.reduce((a, p) => a + (p.base ?? 0), 0);

  const data: BaseData = {
    markets: markets.map((m) => ({ code: m.code, name: m.name })),
    brands: OWN_BRANDS,
    items,
    mkt,
    brand,
    item,
    itemName,
    metric,
    win,
    winLabel,
    years,
    latestDataYear,
    planningYear,
    plan,
    points,
    overlays: overlayRows,
    priceMarks,
    season: { labels: MONTH_LABELS, engine, years: seasonYears },
    totals: {
      actual: totActual,
      base: totBase,
      incremental: totActual - totBase,
      niqPromoWeeks: points.filter((p) => p.promoAcv >= 10).length,
    },
  };

  return <BaseView data={data} />;
}
