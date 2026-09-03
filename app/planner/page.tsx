import { getPromoOverlays, getWeeklyFacts, listItems, listMarkets, listPromotions, listPromoCustomers, getPromoMeta, getPromoEnums } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import PlannerView, { type PromoRow, type PlannerData } from "@/components/planner/PlannerView";

/* Promotion Planner — the first rebuilt view, running on the real Telus
   FY2026 promotions snapshot. All data flows through lib/repo (the seam);
   this server component computes the rollups and hands plain props to the
   client view. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FY_START = Date.UTC(2026, 0, 1);
const FY_END = Date.UTC(2026, 11, 31);
const DAY = 86400000;

/** Spread an amount evenly across a window's days, clipped to FY2026,
    summed per month. A timing approximation, stated on the card. */
function allocateByMonth(totalByMonth: number[], amount: number, startISO: string, endISO: string, capISO?: string) {
  if (!amount) return;
  let s = Date.UTC(+startISO.slice(0, 4), +startISO.slice(5, 7) - 1, +startISO.slice(8, 10));
  let e = Date.UTC(+endISO.slice(0, 4), +endISO.slice(5, 7) - 1, +endISO.slice(8, 10));
  if (capISO) e = Math.min(e, Date.UTC(+capISO.slice(0, 4), +capISO.slice(5, 7) - 1, +capISO.slice(8, 10)));
  s = Math.max(s, FY_START);
  e = Math.min(e, FY_END);
  if (e < s) return;
  const perDay = amount / ((e - s) / DAY + 1);
  for (let t = s; t <= e; t += DAY) {
    totalByMonth[new Date(t).getUTCMonth()] += perDay;
  }
}

const OWN_BRANDS = ["SPLENDA", "SLIMFAST", "JAVA HOUSE"];

export default async function Page({ searchParams }: { searchParams: Promise<{ yr?: string }> }) {
  const sp = await searchParams;
  const [allPromos, allCustomers, meta, enums, gscope] = await Promise.all([
    listPromotions(), listPromoCustomers(), getPromoMeta(), getPromoEnums(), getScope(),
  ]);

  // Year: the Telus book year monitors actuals; future years open the plan builder.
  const bookYear = meta.fiscal_year;
  const years: number[] = [];
  for (let y = bookYear; y <= Math.max(bookYear, new Date().getUTCFullYear()) + 2; y++) years.push(y);
  const year = /^\d{4}$/.test(sp.yr ?? "") && years.includes(+sp.yr!) ? +sp.yr! : bookYear;
  const inScope = new Set(gscope.telusCustomerIds);
  const promos = gscope.active ? allPromos.filter((p) => inScope.has(p.customer_id)) : allPromos;
  const customers = gscope.active ? allCustomers.filter((c) => inScope.has(c.customer_id)) : allCustomers;
  // scoped headline totals — the snapshot meta keeps only its identity fields
  const scopedMeta = gscope.active
    ? {
        ...meta,
        promotions: promos.length,
        promo_lines: promos.reduce((a, p) => a + p.line_count, 0),
        planned_total: promos.reduce((a, p) => a + p.planned_amount, 0),
        actual_total: promos.reduce((a, p) => a + p.actual_amount, 0),
      }
    : meta;

  const plannedByMonth = Array(12).fill(0);
  const actualByMonth = Array(12).fill(0);
  for (const p of promos) {
    allocateByMonth(plannedByMonth, p.planned_amount, p.start_date, p.end_date);
    // actual spend is lifetime-to-date; pace it across the elapsed window
    allocateByMonth(actualByMonth, p.actual_amount, p.start_date, p.end_date, meta.snapshot_date);
  }

  const byStatus: Record<string, number> = {};
  for (const p of promos) byStatus[p.promo_status] = (byStatus[p.promo_status] ?? 0) + 1;

  const rows: PromoRow[] = promos.map((p) => ({
    id: p.promo_id,
    title: p.promo_title,
    status: p.promo_status,
    perf: p.performance_type,
    template: p.template_type,
    customer: p.customer_name,
    channel: p.channel,
    market: p.market,
    start: p.start_date,
    end: p.end_date,
    lines: p.line_count,
    planned: p.planned_amount,
    actual: p.actual_amount,
  }));

  /* Plan-builder payload for a future year: per-brand base stats from the
     NIQ history across the scoped divisions (weekly base run-rate, average
     price, average promoted-week lift), the prior-year book for reference,
     and that book's rows to carry forward. */
  let plan: PlannerData["plan"];
  if (year > bookYear) {
    const [allMarkets, allItems] = await Promise.all([listMarkets(), listItems()]);
    const markets = gscope.active ? allMarkets.filter((m) => gscope.marketCodes.includes(m.code)) : allMarkets;
    const itemName = new Map(allItems.map((i) => [i.upc, i.name]));
    const brandStats: Record<string, {
      weeklyBaseUnits: number; price: number; avgLift: number;
      tactics: Record<string, { lift: number; reads: number }>;
      items: { upc: string; name: string; wk: number }[];
    }> = {};
    const DAY = 86400000;
    const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
    for (const brand of OWN_BRANDS) {
      // week → sums across the scoped divisions, plus per-item base totals and
      // per-tactic lift sums measured from the Telus windows on each division
      const wk = new Map<string, { bu: number; bd: number; au: number; promo: boolean }>();
      const perItem = new Map<string, number>(); // upc → base units over the latest 52w
      const tacticAgg = new Map<string, { a: number; b: number; n: number }>(); // perf type → actual/base sums, windows read
      for (const m of markets) {
        const facts = await getWeeklyFacts({ market_code: m.code, brand });
        const mA = new Map<string, number>(); // this division's weekly actual units
        const mB = new Map<string, number>(); // …and NIQ base units
        for (const r of facts) {
          const w = wk.get(r.week_ending) ?? { bu: 0, bd: 0, au: 0, promo: false };
          w.bu += r.base_units ?? r.units ?? 0;
          w.bd += r.base_dollars ?? r.dollars ?? 0;
          w.au += r.units ?? 0;
          if ((r.acv_any_promo ?? 0) >= 10) w.promo = true;
          wk.set(r.week_ending, w);
          mA.set(r.week_ending, (mA.get(r.week_ending) ?? 0) + (r.units ?? 0));
          mB.set(r.week_ending, (mB.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
        }
        // measured lift per Telus window at this division, grouped by tactic
        const mWeeks = [...mB.keys()].sort();
        const latest = mWeeks[mWeeks.length - 1] ?? "";
        for (const o of await getPromoOverlays({ market_code: m.code, brand })) {
          if (o.start_date > latest) continue; // window entirely in the future — nothing measured
          const s = utcOf(o.start_date), e = utcOf(o.end_date);
          let a = 0, b = 0;
          for (const w of mWeeks) {
            const wt = utcOf(w);
            if (s <= wt && e >= wt - 6 * DAY) { a += mA.get(w) ?? 0; b += mB.get(w) ?? 0; }
          }
          if (b <= 0) continue;
          const t = tacticAgg.get(o.performance_type) ?? { a: 0, b: 0, n: 0 };
          t.a += a; t.b += b; t.n += 1;
          tacticAgg.set(o.performance_type, t);
        }
      }
      const weeks = [...wk.keys()].sort().slice(-52);
      const cutoff = weeks[0] ?? "";
      for (const m of markets) {
        const facts = await getWeeklyFacts({ market_code: m.code, brand });
        for (const r of facts) {
          if (r.week_ending < cutoff) continue;
          const v = r.base_units ?? r.units ?? 0;
          if (v <= 0) continue;
          perItem.set(r.upc, (perItem.get(r.upc) ?? 0) + v);
        }
      }
      let bu = 0, bd = 0, pAu = 0, pBu = 0;
      for (const w of weeks) {
        const v = wk.get(w)!;
        bu += v.bu; bd += v.bd;
        if (v.promo) { pAu += v.au; pBu += v.bu; }
      }
      const tactics: Record<string, { lift: number; reads: number }> = {};
      for (const [perf, t] of tacticAgg) {
        tactics[perf] = { lift: +(((t.a - t.b) / t.b) * 100).toFixed(1), reads: t.n };
      }
      brandStats[brand] = {
        weeklyBaseUnits: weeks.length ? bu / weeks.length : 0,
        price: bu > 0 ? bd / bu : 0,
        avgLift: pBu > 0 ? +(((pAu - pBu) / pBu) * 100).toFixed(1) : 0,
        tactics,
        items: [...perItem.entries()]
          .map(([upc, tot]) => ({ upc, name: itemName.get(upc) ?? upc, wk: +(tot / Math.max(weeks.length, 1)).toFixed(1) }))
          .sort((a, b) => b.wk - a.wk),
      };
    }
    plan = {
      year,
      priorYear: bookYear,
      priorPlannedByMonth: plannedByMonth.map((v) => Math.round(v)),
      priorPlannedTotal: Math.round(scopedMeta.planned_total),
      brandStats,
      customers: customers.map((c) => ({ id: c.customer_id, name: c.customer_name })),
      copySource: promos.map((p) => ({
        title: p.promo_title, customer_id: p.customer_id, customer: p.customer_name,
        perf: p.performance_type, start: p.start_date, end: p.end_date,
        planned: Math.round(p.planned_amount),
      })),
      scopeActive: gscope.active,
    };
  }

  const data: PlannerData = {
    meta: scopedMeta,
    scopeLabel: gscope.active ? gscope.label : undefined,
    years,
    year,
    plan,
    byStatus,
    months: MONTHS,
    plannedByMonth: plannedByMonth.map((v) => Math.round(v)),
    actualByMonth: actualByMonth.map((v) => Math.round(v)),
    topCustomers: customers.slice(0, 10).map((c) => ({
      name: c.customer_name, planned: Math.round(c.planned), actual: Math.round(c.actual), promos: c.promos,
    })),
    statuses: enums.promo_status,
    perfTypes: enums.performance_type,
    channels: enums.channel,
    markets: enums.market,
    rows,
  };

  return <PlannerView data={data} />;
}
