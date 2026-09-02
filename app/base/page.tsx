import { getPromoOverlays, getWeeklyFacts, listMarkets, listWeekEndings } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import ScopeEmpty from "@/components/ScopeEmpty";
import BaseView, { type BaseData, type WeekPoint } from "@/components/base/BaseView";

/* Base & Lift Lab, draft 1 — the Nielsen weekly trend (actual vs NIQ base)
   for one division × brand, with the Telus promotion windows overlaid.
   Controls travel in the URL so any cut is shareable. */

const OWN_BRANDS = ["SPLENDA", "SLIMFAST", "JAVA HOUSE"]; // NIQ brands with own-side data

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mkt?: string; brand?: string; metric?: string; win?: string }>;
}) {
  const sp = await searchParams;
  const [allMarkets, gscope] = await Promise.all([listMarkets(), getScope()]);
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

  const allWeeks = await listWeekEndings(mkt);
  const weeks = win === "all" ? allWeeks : allWeeks.slice(-52);
  const from = weeks[0];
  const to = weeks[weeks.length - 1];

  const facts = await getWeeklyFacts({ market_code: mkt, brand, from, to });

  // aggregate the brand's items per week
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

  const overlays = await getPromoOverlays({ market_code: mkt, brand, from, to });

  const totActual = points.reduce((a, p) => a + p.actual, 0);
  const totBase = points.reduce((a, p) => a + p.base, 0);

  const data: BaseData = {
    markets: markets.map((m) => ({ code: m.code, name: m.name })),
    brands: OWN_BRANDS,
    mkt,
    brand,
    metric,
    win,
    points,
    overlays,
    totals: {
      actual: totActual,
      base: totBase,
      incremental: totActual - totBase,
      niqPromoWeeks: points.filter((p) => p.promoAcv >= 10).length,
    },
  };

  return <BaseView data={data} />;
}
