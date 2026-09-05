import { getItemCrosswalk, getPriceList, getPromoOverlays, getWeeklyFacts, listAllPromoLines, listItems, listMarkets, listPromotions, listPromoCustomers, getPromoMeta, getPromoEnums, priceAsOf } from "@/lib/repo";
import { normBrand, promoCustomersFor } from "@/lib/data/albertsonsPromoMap";
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
    // per-division weekly base (latest 52w), brand-level and per item — events
    // score on their own customer's divisions, not the whole scope
    const divBrandWk: Record<string, Record<string, number>> = {};
    const divItemWk: Record<string, Record<string, number>> = {};
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
        // this division's latest-52w weekly base run-rate, brand and per item
        const mWeeks = [...mB.keys()].sort();
        const m52 = mWeeks.slice(-52);
        (divBrandWk[m.code] ??= {})[brand] =
          m52.reduce((a, w) => a + (mB.get(w) ?? 0), 0) / Math.max(m52.length, 1);
        const c0 = m52[0] ?? "";
        const perUpc = (divItemWk[m.code] ??= {});
        for (const r of facts) {
          if (r.week_ending < c0) continue;
          const v = r.base_units ?? r.units ?? 0;
          if (v > 0) perUpc[r.upc] = (perUpc[r.upc] ?? 0) + v / Math.max(m52.length, 1);
        }

        // measured lift per Telus window at this division, grouped by tactic
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
    // Brand and items per promo, from its Telus component lines: exactly one
    // own NIQ brand → that brand; the item crosswalk resolves line item
    // numbers to NIQ UPCs on file, so carried events score at item level.
    const ownByNorm = new Map(OWN_BRANDS.map((b) => [normBrand(b), b]));
    const xwalk = await getItemCrosswalk();
    const promoBrandSets = new Map<string, Set<string>>();
    const promoUpcs = new Map<string, Set<string>>();
    const linesByPromo = new Map<string, Awaited<ReturnType<typeof listAllPromoLines>>>();
    for (const l of await listAllPromoLines()) {
      const own = ownByNorm.get(normBrand(l.brand));
      if (own) {
        (promoBrandSets.get(l.promo_id) ?? promoBrandSets.set(l.promo_id, new Set()).get(l.promo_id)!).add(own);
      }
      for (const u of xwalk.telusUpcs[l.item_number] ?? []) {
        (promoUpcs.get(l.promo_id) ?? promoUpcs.set(l.promo_id, new Set()).get(l.promo_id)!).add(u);
      }
      (linesByPromo.get(l.promo_id) ?? linesByPromo.set(l.promo_id, []).get(l.promo_id)!).push(l);
    }
    const brandFor = (promoId: string) => {
      const s = promoBrandSets.get(promoId);
      return s && s.size === 1 ? [...s][0] : "MIXED";
    };

    // Telus customer → the scoped divisions it covers (corporate → all)
    const custMarkets: Record<string, string[]> = {};
    for (const m of markets) {
      for (const cid of promoCustomersFor(m.code)) (custMarkets[cid] ??= []).push(m.code);
    }

    // Dated list prices (UPC-resolved) + a run-rate-weighted brand list price
    // as of the plan year's start — ROI scores on manufacturer gross revenue.
    const priceRows = await getPriceList();
    const prices = priceRows
      .filter((r) => r.upc && r.unit_price !== null)
      .map((r) => ({ upc: r.upc!, unit_price: r.unit_price!, effective_from: r.effective_from }));
    const jan1 = `${year}-01-01`;
    const brandListPrice: Record<string, number | null> = {};
    for (const b of OWN_BRANDS) {
      let pw = 0, w = 0;
      for (const it of brandStats[b].items) {
        const p = priceAsOf(priceRows, jan1, { upc: it.upc })?.unit_price ?? null;
        if (p !== null) { pw += p * it.wk; w += it.wk; }
      }
      brandListPrice[b] = w > 0 ? +(pw / w).toFixed(4) : null;
    }

    /* Funding split per promo, from its Telus component lines, normalized to
       the planner's {oi, scan, fixed} model: Scan lines feed the scan rate
       and Off Invoice / Billback lines the O/I rate — "Each" rates as-is,
       "Case" rates ÷ units-per-case, "Percent" rates × the dated unit list
       price (both via the item crosswalk + price list). Lump-sum components
       (ad fees, tag fees, slotting, …) and any rate line that can't be
       normalized land in fixed by their planned dollars, so nothing drops.
       Rates are planned-dollar-weighted averages across a promo's lines. */
    const unitPriceInfo = (item_number: string): { unit: number | null; perCase: number | null } => {
      for (const u of xwalk.telusUpcs[item_number] ?? []) {
        const p = priceAsOf(priceRows, jan1, { upc: u });
        if (p?.unit_price) {
          const perCase = p.units_per_case
            ?? (p.case_price && p.unit_price ? Math.round(p.case_price / p.unit_price) : null);
          return { unit: p.unit_price, perCase: perCase && perCase >= 1 ? perCase : null };
        }
      }
      return { unit: null, perCase: null };
    };
    const promoFunding = new Map<string, { oi: number; scan: number; fixed: number }>();
    for (const [pid, ls] of linesByPromo) {
      let fixed = 0;
      const agg = { oi: { pw: 0, w: 0 }, scan: { pw: 0, w: 0 } };
      for (const l of ls) {
        const bucket = l.component_type === "Scan" ? "scan"
          : /^(Off Invoice|Billback)/.test(l.component_type) ? "oi" : null;
        if (!bucket || l.rate_uom === "Lump Sum" || !(l.rate > 0)) { fixed += l.planned_amount; continue; }
        let perUnit: number | null = null;
        if (l.rate_uom === "Each") perUnit = l.rate;
        else {
          const { unit, perCase } = unitPriceInfo(l.item_number);
          if (l.rate_uom === "Case" && perCase) perUnit = l.rate / perCase;
          else if (l.rate_uom === "Percent" && unit) perUnit = (l.rate / 100) * unit;
        }
        if (perUnit === null || !(perUnit > 0)) { fixed += l.planned_amount; continue; }
        const w = l.planned_amount > 0 ? l.planned_amount : 1;
        agg[bucket].pw += perUnit * w;
        agg[bucket].w += w;
      }
      const oi = agg.oi.w > 0 ? +(agg.oi.pw / agg.oi.w).toFixed(3) : 0;
      const scan = agg.scan.w > 0 ? +(agg.scan.pw / agg.scan.w).toFixed(3) : 0;
      fixed = Math.round(fixed);
      if (oi > 0 || scan > 0 || fixed > 0) promoFunding.set(pid, { oi, scan, fixed });
    }

    plan = {
      year,
      priorYear: bookYear,
      priorPlannedByMonth: plannedByMonth.map((v) => Math.round(v)),
      priorPlannedTotal: Math.round(scopedMeta.planned_total),
      brandStats,
      divBrandWk,
      divItemWk,
      custMarkets,
      prices,
      brandListPrice,
      customers: customers.map((c) => ({ id: c.customer_id, name: c.customer_name })),
      copySource: promos.map((p) => ({
        title: p.promo_title, customer_id: p.customer_id, customer: p.customer_name,
        brand: brandFor(p.promo_id),
        upcs: [...(promoUpcs.get(p.promo_id) ?? [])],
        perf: p.performance_type, start: p.start_date, end: p.end_date,
        planned: Math.round(p.planned_amount),
        funding: promoFunding.get(p.promo_id),
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
