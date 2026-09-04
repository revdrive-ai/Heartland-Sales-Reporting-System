import { getPriceList, getWeeklyFacts, listItems, listMarkets, listWeekEndings, priceAsOf } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import ScopeEmpty from "@/components/ScopeEmpty";
import ReportingView, { type ReportingData } from "@/components/reporting/ReportingView";
import type { NielsenWeeklyRow } from "@/lib/types/db";

/* Sales Dashboard — workflow step 3, the landing view. Tracks the measured
   retail business on the real NIQ pull: own-brand dollars/units/price with
   true year-over-year (last W weeks vs the same weeks a year earlier), share
   of the measured competitive set, brand and division cuts, and item-level
   movers. Controls travel in the URL. */

const WINDOWS = [13, 26, 52] as const;
const DAY = 86400000;

type Agg = { dollars: number; units: number };

const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
const yearAgoWeek = (w: string) => new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);

/** Every NIQ week-ending (Saturday) of a calendar year. */
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
  searchParams: Promise<{ mkt?: string; brand?: string; win?: string }>;
}) {
  const [allMarkets, items, gscope] = await Promise.all([listMarkets(), listItems(), getScope()]);
  const markets = gscope.active ? allMarkets.filter((m) => gscope.marketCodes.includes(m.code)) : allMarkets;
  if (gscope.active && markets.length === 0) {
    return (
      <ScopeEmpty current="reporting" crumb="Trade Workflow · Step 3" title="Sales Dashboard"
        label={gscope.label}
        message="No Nielsen trading areas in this scope have data on file — only the 13 ALBSCO divisions are loaded so far." />
    );
  }
  const ownBrands = [...new Set(items.filter((i) => i.is_own).map((i) => i.brand))].sort();
  const itemMeta = new Map(items.map((i) => [i.upc, i]));

  const sp = await searchParams;
  const mkt = markets.some((m) => m.code === sp.mkt) ? sp.mkt! : "ALL";
  const brand = ownBrands.includes(sp.brand ?? "") ? sp.brand! : "ALL";
  const win = (WINDOWS as readonly number[]).includes(Number(sp.win)) ? (Number(sp.win) as 13 | 26 | 52) : 52;

  const scopeMarkets = mkt === "ALL" ? markets.map((m) => m.code) : [mkt];

  // week axis (every division carries the same 157 NIQ weeks)
  const allWeeks = await listWeekEndings(scopeMarkets[0]);
  const latestWeek = allWeeks[allWeeks.length - 1];
  const latestDataYear = +latestWeek.slice(0, 4);

  // plan years looking forward — 2027, 2028, … in perpetuity
  const years: number[] = [];
  for (let y = latestDataYear + 1; y <= Math.max(latestDataYear, new Date().getUTCFullYear()) + 2; y++) years.push(y);
  const planYear = /^\d{4}$/.test(sp.win ?? "") && years.includes(+sp.win!) ? +sp.win! : null;

  if (planYear) {
    return renderPlanYear({
      planYear, years, markets, marketList: scopeMarkets, allWeeks, latestWeek,
      ownBrands, mkt, brand, gscope, items,
    });
  }

  const curWeeks = allWeeks.slice(-win);
  const lyWeeks = allWeeks.slice(-(win + 52), -52);
  const from = lyWeeks[0];
  const to = curWeeks[curWeeks.length - 1];

  // one pass over the scope's rows in [from, to]
  const rows: NielsenWeeklyRow[] = [];
  for (const code of scopeMarkets) {
    rows.push(...(await getWeeklyFacts({ market_code: code, from, to })));
  }

  const curSet = new Set(curWeeks);
  const lySet = new Set(lyWeeks);
  const lyIndex = new Map(lyWeeks.map((w, i) => [w, i]));
  const curIndex = new Map(curWeeks.map((w, i) => [w, i]));

  const zero = (): Agg => ({ dollars: 0, units: 0 });
  const tot = { cur: zero(), ly: zero() };                 // own scope
  const comp = { cur: zero(), ly: zero() };                // competitive set
  const seriesTY = Array(win).fill(0);
  const seriesLY = Array(win).fill(0);
  const byBrand = new Map<string, { cur: Agg; ly: Agg }>();
  const byGroup = new Map<string, { cur: Agg; ly: Agg }>(); // divisions (ALL) or categories (single division)
  const byItem = new Map<string, { cur: Agg; ly: Agg }>();

  const marketName = new Map(markets.map((m) => [m.code, m.name]));

  for (const r of rows) {
    const isCur = curSet.has(r.week_ending);
    const isLy = !isCur && lySet.has(r.week_ending);
    if (!isCur && !isLy) continue;
    const meta = itemMeta.get(r.upc);
    const own = meta?.is_own ?? false;
    const inBrandScope = own && (brand === "ALL" || r.brand === brand);
    const d = r.dollars ?? 0;
    const u = r.units ?? 0;
    const side = isCur ? "cur" : "ly";

    if (own && brand === "ALL") {
      // brand cut always spans all own brands (plus the competitive set row)
    }
    if (own) {
      const b = byBrand.get(r.brand) ?? { cur: zero(), ly: zero() };
      b[side].dollars += d; b[side].units += u;
      byBrand.set(r.brand, b);
    } else {
      comp[side].dollars += d; comp[side].units += u;
    }

    if (!inBrandScope) continue;

    tot[side].dollars += d; tot[side].units += u;
    if (isCur) seriesTY[curIndex.get(r.week_ending)!] += d;
    else seriesLY[lyIndex.get(r.week_ending)!] += d;

    const g = mkt === "ALL" ? (marketName.get(r.market_code) ?? r.market_code) : r.category;
    const gg = byGroup.get(g) ?? { cur: zero(), ly: zero() };
    gg[side].dollars += d; gg[side].units += u;
    byGroup.set(g, gg);

    const it = byItem.get(r.upc) ?? { cur: zero(), ly: zero() };
    it[side].dollars += d; it[side].units += u;
    byItem.set(r.upc, it);
  }

  const pct = (cur: number, ly: number) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);
  const shareCur = tot.cur.dollars + comp.cur.dollars > 0 && brand === "ALL"
    ? (tot.cur.dollars / (tot.cur.dollars + comp.cur.dollars)) * 100 : null;
  const shareLy = tot.ly.dollars + comp.ly.dollars > 0 && brand === "ALL"
    ? (tot.ly.dollars / (tot.ly.dollars + comp.ly.dollars)) * 100 : null;

  const brandRows = [...byBrand.entries()]
    .map(([name, v]) => ({ name, ty: Math.round(v.cur.dollars), ly: Math.round(v.ly.dollars) }))
    .sort((a, b) => b.ty - a.ty);
  brandRows.push({ name: "Competitive set", ty: Math.round(comp.cur.dollars), ly: Math.round(comp.ly.dollars) });

  const groupRows = [...byGroup.entries()]
    .map(([name, v]) => ({ name, ty: Math.round(v.cur.dollars), ly: Math.round(v.ly.dollars) }))
    .sort((a, b) => b.ty - a.ty);

  const movers = [...byItem.entries()]
    .map(([upc, v]) => {
      const meta = itemMeta.get(upc);
      return {
        upc,
        name: meta?.name ?? upc,
        brand: meta?.brand ?? "",
        ty: Math.round(v.cur.dollars),
        ly: Math.round(v.ly.dollars),
        delta: Math.round(v.cur.dollars - v.ly.dollars),
      };
    })
    .filter((m) => m.ty > 0 || m.ly > 0)
    .sort((a, b) => b.delta - a.delta);
  const topMovers = [...movers.slice(0, 8), ...movers.slice(-8).filter((m) => m.delta < 0)];

  const data: ReportingData = {
    markets: [{ code: "ALL", name: gscope.active ? `All in scope — ${gscope.label}` : "All divisions (Albertsons total)" }, ...markets.map((m) => ({ code: m.code, name: m.name }))],
    ownBrands,
    mkt, brand, win,
    years,
    plan: null,
    windowLabel: `${curWeeks[0]} → ${to}`,
    weeks: curWeeks,
    seriesTY: seriesTY.map(Math.round),
    seriesLY: seriesLY.map(Math.round),
    kpis: {
      dollars: Math.round(tot.cur.dollars), dollarsYoY: pct(tot.cur.dollars, tot.ly.dollars),
      units: Math.round(tot.cur.units), unitsYoY: pct(tot.cur.units, tot.ly.units),
      price: tot.cur.units > 0 ? tot.cur.dollars / tot.cur.units : null,
      priceYoY: tot.cur.units > 0 && tot.ly.units > 0
        ? pct(tot.cur.dollars / tot.cur.units, tot.ly.dollars / tot.ly.units) : null,
      share: shareCur,
      sharePts: shareCur !== null && shareLy !== null ? shareCur - shareLy : null,
    },
    brandRows,
    groupRows,
    groupKind: mkt === "ALL" ? "division" : "category",
    topMovers,
  };

  return <ReportingView data={data} />;
}

/* Plan-year dashboard: the full-year plan base (the actual NIQ base carried
   from the matching weeks a year earlier as far as it has actualized, the
   rest projected by each division x brand's seasonality engine), read against
   prior-year actuals on the same aligned weeks, with brand and division cuts
   against the latest 52 measured weeks. */
async function renderPlanYear({
  planYear, years, markets, marketList, allWeeks, latestWeek, ownBrands, mkt, brand, gscope, items,
}: {
  planYear: number; years: number[];
  markets: { code: string; name: string }[];
  marketList: string[]; allWeeks: string[]; latestWeek: string;
  ownBrands: string[]; mkt: string; brand: string;
  gscope: { active: boolean; label: string };
  items: { upc: string; brand: string; is_own: boolean }[];
}) {
  const planWeeks = saturdaysOfYear(planYear);
  const nW = planWeeks.length;
  const last52 = allWeeks.slice(-52);
  const marketName = new Map(markets.map((m) => [m.code, m.name]));

  const series$ = Array(nW).fill(0);
  const priorSum = Array(nW).fill(0);
  const priorHas = Array(nW).fill(false);
  const byBrandP = new Map<string, { plan: number; act: number }>();
  const byDivP = new Map<string, { plan: number; act: number }>();
  const tot = { plan$: 0, planU: 0 };
  const planUByBrand = new Map<string, number>(); // for gross revenue on list price
  // headline comparison basis: the most recent complete 52 measured weeks of
  // actual sales in the brand/market scope (same basis as the cuts below)
  const act52 = { dollars: 0, units: 0 };
  const matchedIdx = new Set<number>(); // plan weeks whose prior-year week is measured

  for (const code of marketList) {
    for (const b of ownBrands) {
      const facts = await getWeeklyFacts({ market_code: code, brand: b });
      if (!facts.length) continue;
      const wB$ = new Map<string, number>(), wBU = new Map<string, number>();
      const wA$ = new Map<string, number>(), wAU = new Map<string, number>();
      for (const r of facts) {
        wB$.set(r.week_ending, (wB$.get(r.week_ending) ?? 0) + (r.base_dollars ?? r.dollars ?? 0));
        wBU.set(r.week_ending, (wBU.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
        wA$.set(r.week_ending, (wA$.get(r.week_ending) ?? 0) + (r.dollars ?? 0));
        wAU.set(r.week_ending, (wAU.get(r.week_ending) ?? 0) + (r.units ?? 0));
      }
      // seasonality engine (monthly index on base units, full history)
      const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
      let grandSum = 0;
      for (const [w, v] of wBU) {
        monthTot[+w.slice(5, 7) - 1] += v;
        monthN[+w.slice(5, 7) - 1] += 1;
        grandSum += v;
      }
      const grandAvg = grandSum / Math.max(wBU.size, 1);
      const engine = monthTot.map((t, m) => (monthN[m] > 0 && grandAvg > 0 ? t / monthN[m] / grandAvg : 1));
      const avg52$ = last52.reduce((a, w) => a + (wB$.get(w) ?? 0), 0) / Math.max(last52.length, 1);
      const avg52U = last52.reduce((a, w) => a + (wBU.get(w) ?? 0), 0) / Math.max(last52.length, 1);

      const inBrandScope = brand === "ALL" || b === brand;
      let brandPlan$ = 0, divPlan$ = 0;
      planWeeks.forEach((w, i) => {
        const src = yearAgoWeek(w);
        const m = +w.slice(5, 7) - 1;
        const carried = src <= latestWeek;
        const p$ = carried ? (wB$.get(src) ?? 0) : avg52$ * engine[m];
        const pU = carried ? (wBU.get(src) ?? 0) : avg52U * engine[m];
        brandPlan$ += p$;
        if (!inBrandScope) return;
        divPlan$ += p$;
        series$[i] += p$;
        tot.plan$ += p$; tot.planU += pU;
        planUByBrand.set(b, (planUByBrand.get(b) ?? 0) + pU);
        if (carried && wA$.has(src)) {
          priorSum[i] += wA$.get(src)!;
          priorHas[i] = true;
          matchedIdx.add(i);
        }
      });
      const act52$ = last52.reduce((a, w) => a + (wA$.get(w) ?? 0), 0);
      if (inBrandScope) {
        act52.dollars += act52$;
        act52.units += last52.reduce((a, w) => a + (wAU.get(w) ?? 0), 0);
      }
      const bb = byBrandP.get(b) ?? { plan: 0, act: 0 };
      bb.plan += brandPlan$; bb.act += act52$;
      byBrandP.set(b, bb);
      if (inBrandScope) {
        const name = marketName.get(code) ?? code;
        const dd = byDivP.get(name) ?? { plan: 0, act: 0 };
        dd.plan += divPlan$; dd.act += act52$;
        byDivP.set(name, dd);
      }
    }
  }

  const pct = (cur: number, ly: number) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);
  const planPrice = tot.planU > 0 ? tot.plan$ / tot.planU : null;
  const act52Price = act52.units > 0 ? act52.dollars / act52.units : null;

  // gross revenue on the dated list price: plan units × the brand's average
  // unit list price in force at the plan year's start
  const priceRows = await getPriceList();
  const jan1 = `${planYear}-01-01`;
  let gross: number | null = null;
  for (const [b, u] of planUByBrand) {
    const priced = items.filter((i) => i.is_own && i.brand === b)
      .map((i) => priceAsOf(priceRows, jan1, { upc: i.upc })?.unit_price ?? null)
      .filter((p): p is number => p !== null);
    if (!priced.length) continue;
    const avg = priced.reduce((a, p) => a + p, 0) / priced.length;
    gross = (gross ?? 0) + u * avg;
  }

  const data: ReportingData = {
    markets: [{ code: "ALL", name: gscope.active ? `All in scope — ${gscope.label}` : "All divisions (Albertsons total)" }, ...markets.map((m) => ({ code: m.code, name: m.name }))],
    ownBrands,
    mkt, brand, win: 52,
    years,
    plan: { year: planYear, priorYear: planYear - 1, matchedWeeks: matchedIdx.size, gross: gross === null ? null : Math.round(gross) },
    windowLabel: `Plan ${planYear} · ${nW} weeks`,
    weeks: planWeeks,
    seriesTY: series$.map(Math.round),
    seriesLY: priorSum.map((v, i) => (priorHas[i] ? Math.round(v) : null)),
    kpis: {
      dollars: Math.round(tot.plan$),
      dollarsYoY: pct(tot.plan$, act52.dollars),
      units: Math.round(tot.planU),
      unitsYoY: pct(tot.planU, act52.units),
      price: planPrice,
      priceYoY: planPrice !== null && act52Price !== null ? pct(planPrice, act52Price) : null,
      share: null, sharePts: null,
    },
    brandRows: [...byBrandP.entries()]
      .map(([name, v]) => ({ name, ty: Math.round(v.plan), ly: Math.round(v.act) }))
      .sort((a, b) => b.ty - a.ty),
    groupRows: [...byDivP.entries()]
      .map(([name, v]) => ({ name, ty: Math.round(v.plan), ly: Math.round(v.act) }))
      .sort((a, b) => b.ty - a.ty),
    groupKind: "division",
    topMovers: [],
  };

  return <ReportingView data={data} />;
}
