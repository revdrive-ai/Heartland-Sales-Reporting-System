import { getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
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

type Agg = { dollars: number; units: number };

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
