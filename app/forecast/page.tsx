import { listItems, listMarkets, listWeekEndings } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import { fyWeeklySeries } from "@/lib/server/fyForecast";
import ScopeEmpty from "@/components/ScopeEmpty";
import ForecastView, { type ForecastData } from "@/components/forecast/ForecastView";

/* Monthly Forecast Review — workflow step 4. The FY forecast (measured
   actuals through the NIQ data edge + the year-ago-base × expected-Telus-lift
   forecast to year-end, the same construction as the Sales Dashboard FY mode
   and the Base & Lift Total-year view) rolled up to calendar months and read
   against prior-year actuals, month by month — the review cadence: which
   months are locked (fully measured), which are landing, and what the rest
   of the year is expected to do. */

const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mkt?: string; brand?: string }>;
}) {
  const [allMarkets, items, gscope] = await Promise.all([listMarkets(), listItems(), getScope()]);
  const markets = gscope.active ? allMarkets.filter((m) => gscope.marketCodes.includes(m.code)) : allMarkets;
  if (gscope.active && markets.length === 0) {
    return (
      <ScopeEmpty current="forecast" crumb="Trade Workflow · Step 4" title="Monthly Forecast Review"
        label={gscope.label}
        message="No Nielsen trading areas in this scope have data on file — only the 13 ALBSCO divisions are loaded so far." />
    );
  }
  const ownBrands = [...new Set(items.filter((i) => i.is_own).map((i) => i.brand))].sort();

  const sp = await searchParams;
  const mkt = markets.some((m) => m.code === sp.mkt) ? sp.mkt! : "ALL";
  const brand = ownBrands.includes(sp.brand ?? "") ? sp.brand! : "ALL";
  const scopeMarkets = mkt === "ALL" ? markets.map((m) => m.code) : [mkt];

  const allWeeks = await listWeekEndings(scopeMarkets[0]);
  const latestWeek = allWeeks[allWeeks.length - 1];
  const fyYear = +latestWeek.slice(0, 4);
  const fyWeeks = saturdaysOfYear(fyYear);

  // month buckets: this year (measured + forecast), prior-year aligned actuals
  type Mo = { fy$: number; fyU: number; prior$: number; measuredWks: number; totalWks: number };
  const months: Mo[] = Array.from({ length: 12 }, () => ({ fy$: 0, fyU: 0, prior$: 0, measuredWks: 0, totalWks: 0 }));
  const brandTot = new Map<string, { fy: number; prior: number }>();
  const wkCounted = new Set<string>(); // count measured/total weeks once, not per div × brand

  for (const code of scopeMarkets) {
    for (const b of ownBrands) {
      if (brand !== "ALL" && b !== brand) continue;
      const series = await fyWeeklySeries(code, b, fyWeeks, allWeeks, latestWeek);
      if (!series) continue;
      let bFy = 0, bPrior = 0;
      for (const s of series) {
        const m = +s.w.slice(5, 7) - 1;
        months[m].fy$ += s.ty$; months[m].fyU += s.tyU; months[m].prior$ += s.prior$;
        bFy += s.ty$; bPrior += s.prior$;
        if (!wkCounted.has(s.w)) {
          wkCounted.add(s.w);
          months[m].totalWks++;
          if (s.measured) months[m].measuredWks++;
        }
      }
      const bt = brandTot.get(b) ?? { fy: 0, prior: 0 };
      bt.fy += bFy; bt.prior += bPrior;
      brandTot.set(b, bt);
    }
  }

  const rows = months.map((m, i) => ({
    month: MONTHS[i],
    status: (m.measuredWks === m.totalWks ? "actual" : m.measuredWks === 0 ? "forecast" : "partial") as "actual" | "partial" | "forecast",
    measuredWks: m.measuredWks,
    totalWks: m.totalWks,
    fy: Math.round(m.fy$),
    fyU: Math.round(m.fyU),
    prior: Math.round(m.prior$),
  }));

  const tot = rows.reduce((a, r) => ({ fy: a.fy + r.fy, prior: a.prior + r.prior, fyU: a.fyU + r.fyU }), { fy: 0, prior: 0, fyU: 0 });
  const measured$ = months.reduce((a, m, i) => a + (rows[i].status === "actual" ? m.fy$ : 0), 0)
    + months.reduce((a, m, i) => (rows[i].status === "partial" ? a + m.fy$ * (m.measuredWks / Math.max(m.totalWks, 1)) : a), 0);

  const data: ForecastData = {
    markets: [{ code: "ALL", name: gscope.active ? `All in scope — ${gscope.label}` : "All divisions (Albertsons total)" }, ...markets.map((m) => ({ code: m.code, name: m.name }))],
    ownBrands,
    mkt, brand,
    fyYear, priorYear: fyYear - 1,
    latestWeek,
    rows,
    totals: { fy: Math.round(tot.fy), prior: Math.round(tot.prior), fyU: Math.round(tot.fyU), measuredApprox: Math.round(measured$) },
    brandRows: [...brandTot.entries()]
      .map(([name, v]) => ({ name, fy: Math.round(v.fy), prior: Math.round(v.prior) }))
      .sort((a, b) => b.fy - a.fy),
  };

  return <ForecastView data={data} />;
}
