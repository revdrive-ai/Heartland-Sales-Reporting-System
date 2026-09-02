import { getPromoOverlays, getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
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
  const upcsWithData = new Set(factsAll.map((r) => r.upc));
  const items = allItems
    .filter((i) => i.brand === brand && upcsWithData.has(i.upc))
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

  const overlays = await getPromoOverlays({ market_code: mkt, brand, from, to });

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
    points,
    overlays,
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
