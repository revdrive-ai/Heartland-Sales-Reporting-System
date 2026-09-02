import { getPromoOverlays, getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import ScopeEmpty from "@/components/ScopeEmpty";
import BaseView, { type BaseData, type WeekPoint } from "@/components/base/BaseView";

/* Base & Lift Lab — the Nielsen weekly trend (actual vs NIQ base) for one
   division × brand (or a single item), with the Telus promotion windows
   overlaid and the seasonality-index card beside the chart (hideable, as in
   the reference mockup). Controls travel in the URL. */

const OWN_BRANDS = ["SPLENDA", "SLIMFAST", "JAVA HOUSE"]; // NIQ brands with own-side data
const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

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
  const win = sp.win === "all" ? "all" : "52w";

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

  const allWeeks = await listWeekEndings(mkt);
  const weeks = win === "all" ? allWeeks : allWeeks.slice(-52);
  const from = weeks[0];
  const to = weeks[weeks.length - 1];

  const scoped = factsAll.filter((r) => item === "ALL" || r.upc === item);
  const facts = scoped.filter((r) => r.week_ending >= from && r.week_ending <= to);

  // aggregate the selection per week (trend chart)
  const byWeek = new Map<string, WeekPoint>();
  for (const w of weeks) byWeek.set(w, { week: w, actual: 0, base: 0, promoAcv: 0 });
  for (const r of facts) {
    const p = byWeek.get(r.week_ending);
    if (!p) continue;
    p.actual += (metric === "units" ? r.units : r.dollars) ?? 0;
    p.base += (metric === "units" ? r.base_units : r.base_dollars) ?? 0;
    p.promoAcv = Math.max(p.promoAcv, r.acv_any_promo ?? 0);
  }
  const points = weeks.map((w) => {
    const p = byWeek.get(w)!;
    return { ...p, actual: Math.round(p.actual), base: Math.round(p.base), promoAcv: Math.round(p.promoAcv * 10) / 10 };
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
  const years = [...yearly.entries()]
    .filter(([, v]) => v.n.filter((x) => x > 0).length >= 6) // skip heavily partial years
    .sort(([a], [b]) => a - b)
    .map(([y, v]) => {
      const wks = v.n.reduce((a, x) => a + x, 0);
      const avg = v.tot.reduce((a, x) => a + x, 0) / Math.max(wks, 1);
      return { label: String(y), values: idx(v.tot, v.n, avg) };
    });

  const overlays = await getPromoOverlays({ market_code: mkt, brand, from, to });

  const totActual = points.reduce((a, p) => a + p.actual, 0);
  const totBase = points.reduce((a, p) => a + p.base, 0);

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
    points,
    overlays,
    season: { labels: MONTH_LABELS, engine, years },
    totals: {
      actual: totActual,
      base: totBase,
      incremental: totActual - totBase,
      niqPromoWeeks: points.filter((p) => p.promoAcv >= 10).length,
    },
  };

  return <BaseView data={data} />;
}
