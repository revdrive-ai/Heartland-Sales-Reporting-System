import { getItemCrosswalk, getPriceList, getPromoOverlays, getWeeklyFacts, listAllPromoLines, listItems, listMarkets, listPromotions, listPromoCustomers, getPromoMeta, getPromoEnums, listWeekEndings, priceAsOf } from "@/lib/repo";
import { fyWeeklyByItem } from "@/lib/server/fyForecast";
import { itemRatio, projectItemWeek, trendOf } from "@/lib/server/projection";
import { normBrand, promoCustomersFor } from "@/lib/data/albertsonsPromoMap";
import { isAlwaysOn, isNonPerformance } from "@/lib/data/nonPerformanceTypes";
import { getScope } from "@/lib/server/scope";
import { getMode } from "@/lib/server/mode";
import { planLocked } from "@/lib/server/planLock";
import { getState } from "@/lib/server/appstate";
import { readDistVerification, type DistAddition, type DistVerification } from "@/lib/distver";
import type { PlanAdjustment } from "@/lib/repo/client";
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

import { HEARTLAND_BRANDS } from "@/lib/data/heartlandBrands";

export default async function Page() {
  const [allPromos, allCustomers, meta, enums, gscope, mode] = await Promise.all([
    listPromotions(), listPromoCustomers(), getPromoMeta(), getPromoEnums(), getScope(), getMode(),
  ]);

  // Year: the working mode (top bar) decides — Plan mode opens the plan
  // builder on its forward year; Analyze and LE monitor the Telus book year.
  const bookYear = meta.fiscal_year;
  const years: number[] = [];
  for (let y = bookYear; y <= Math.max(bookYear, new Date().getUTCFullYear()) + 2; y++) years.push(y);
  const year = mode.kind === "plan" && years.includes(mode.planYear) ? mode.planYear : bookYear;
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
    // plan-year monthly BASE per division × brand, built the same way as the
    // Base Business Review plan view: year-ago weekly base carried where measured,
    // projected for the rest: last year's shape at this year's run-rate (lib/server/projection)
    const divBrandBaseM: Record<string, Record<string, number[]>> = {};

    // Dated list prices, hoisted ahead of the facts loop: they price the
    // prior-year monthly gross series (and later, planner ROI). Per-UPC sorted
    // effective dates make the per-row lookup cheap.
    const priceRows = await getPriceList();
    const upcPrices = new Map<string, { from: string; p: number }[]>();
    for (const r of priceRows) {
      if (!r.upc || r.unit_price === null) continue;
      (upcPrices.get(r.upc) ?? upcPrices.set(r.upc, []).get(r.upc)!).push({ from: r.effective_from, p: r.unit_price });
    }
    for (const l of upcPrices.values()) l.sort((a, b) => b.from.localeCompare(a.from));
    const listAt = (upc: string, date: string) => upcPrices.get(upc)?.find((x) => x.from <= date)?.p ?? null;

    /* Prior-year (book year) NIQ volume by month, per division × brand, for
       the plan builder's units/dollars chart: total units, gross $ at the
       dated list price, and the promoted-week (acv_any_promo ≥ 10) slices —
       the like-for-like read against plan volume on deal. */
    const zeros = () => Array(12).fill(0) as number[];
    const priorMonthly: Record<string, Record<string, { u: number[]; g: number[]; pu: number[]; pg: number[] }>> = {};
    // the same, per division × ITEM — so an item selection compares the item
    // with its own prior year, not with the whole brand
    const priorItemMonthly: Record<string, Record<string, { u: number[]; g: number[]; pu: number[]; pg: number[] }>> = {};
    let dataEdge = "";

    /* Distribution verification (per customer division × plan year, shared
       docs from the Base Business Review verify flow): items marked "no volume" drop
       out of the plan bases — the engine chart, the brand run-rate events
       score on, and the per-item bases — and verified additions ride in on
       their proxy's run-rate (× %) from their first week. */
    const dvByMkt: Record<string, { out: Set<string>; adds: DistAddition[] }> = {};
    let dvVerified = 0, dvOut = 0, dvAdded = 0;
    /* Plan adjustments (per division × plan year, the Base Business Review levers):
       distribution / price / trend % on an item or the whole brand over a
       window. They multiply the plan-year weekly series below, so events —
       and their rate-funded O/I dollars — score on the adjusted base. */
    const adjByMkt: Record<string, PlanAdjustment[]> = {};
    let adjCount = 0;
    // the plan year's Saturdays — the axis every weekly series below is on
    const planWeeks: string[] = [];
    {
      let t = Date.UTC(year, 0, 1);
      while (new Date(t).getUTCDay() !== 6) t += DAY;
      for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) planWeeks.push(new Date(t).toISOString().slice(0, 10));
    }
    const divBrandWkly: Record<string, Record<string, number[]>> = {};
    const divItemWkly: Record<string, Record<string, number[]>> = {};
    for (const m of markets) {
      const adjs = (await getState(`adj:${m.code}:${year}`).catch(() => undefined)) as PlanAdjustment[] | undefined;
      if (adjs?.length) { adjByMkt[m.code] = adjs; adjCount += adjs.length; }
      const d = (await getState(`distver:${m.code}:${year}`).catch(() => undefined)) as DistVerification | undefined;
      if (!d) continue;
      const out = new Set(Object.entries(d.decisions ?? {}).filter(([, x]) => x === "out").map(([u]) => u));
      if (!out.size && !(d.additions ?? []).length && !d.verified_at) continue;
      dvByMkt[m.code] = { out, adds: readDistVerification(d).additions };
      if (d.verified_at) dvVerified++;
      dvOut += out.size;
      dvAdded += (d.additions ?? []).length;
    }
    const priorPrefix = `${bookYear}-`;
    for (const brand of HEARTLAND_BRANDS) {
      // week → sums across the scoped divisions, plus per-item base totals and
      // per-tactic lift sums measured from the Telus windows on each division
      const wk = new Map<string, { bu: number; bd: number; au: number; promo: boolean }>();
      const perItem = new Map<string, number>(); // upc → base units over the latest 52w
      const tacticAgg = new Map<string, { a: number; b: number; n: number }>(); // perf type → actual/base sums, windows read
      for (const m of markets) {
        const facts = await getWeeklyFacts({ market_code: m.code, brand });
        const dv = dvByMkt[m.code];
        const addsHere = dv?.adds.filter((a) => a.brand === brand) ?? [];
        const mA = new Map<string, number>(); // this division's weekly actual units
        const mB = new Map<string, number>(); // …and NIQ base units
        const mBx = new Map<string, number>(); // …the slice from "no volume" items
        const mProxy = new Map<string, Map<string, number>>(); // addition proxies' weekly base
        const mI = new Map<string, Map<string, number>>(); // per item → weekly NIQ base
        for (const r of facts) {
          {
            const im = mI.get(r.upc) ?? mI.set(r.upc, new Map()).get(r.upc)!;
            im.set(r.week_ending, (im.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
          }
          const w = wk.get(r.week_ending) ?? { bu: 0, bd: 0, au: 0, promo: false };
          w.bu += r.base_units ?? r.units ?? 0;
          w.bd += r.base_dollars ?? r.dollars ?? 0;
          w.au += r.units ?? 0;
          if ((r.acv_any_promo ?? 0) >= 10) w.promo = true;
          wk.set(r.week_ending, w);
          mA.set(r.week_ending, (mA.get(r.week_ending) ?? 0) + (r.units ?? 0));
          mB.set(r.week_ending, (mB.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
          if (dv?.out.has(r.upc)) {
            mBx.set(r.week_ending, (mBx.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
          }
          if (addsHere.some((a) => a.proxy_upc === r.upc)) {
            const pm = mProxy.get(r.upc) ?? mProxy.set(r.upc, new Map()).get(r.upc)!;
            pm.set(r.week_ending, (pm.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
          }
          if (r.week_ending > dataEdge) dataEdge = r.week_ending;
          if (r.week_ending.startsWith(priorPrefix)) {
            const mm = ((priorMonthly[m.code] ??= {})[brand] ??= { u: zeros(), g: zeros(), pu: zeros(), pg: zeros() });
            const mo = +r.week_ending.slice(5, 7) - 1;
            const un = r.units ?? 0;
            const p = listAt(r.upc, r.week_ending) ?? 0;
            mm.u[mo] += un;
            mm.g[mo] += un * p;
            if ((r.acv_any_promo ?? 0) >= 10) { mm.pu[mo] += un; mm.pg[mo] += un * p; }
            const mi = ((priorItemMonthly[m.code] ??= {})[r.upc] ??= { u: zeros(), g: zeros(), pu: zeros(), pg: zeros() });
            mi.u[mo] += un;
            mi.g[mo] += un * p;
            if ((r.acv_any_promo ?? 0) >= 10) { mi.pu[mo] += un; mi.pg[mo] += un * p; }
          }
        }
        // this division's latest-52w weekly base run-rate, brand and per item
        const mWeeks = [...mB.keys()].sort();
        const m52 = mWeeks.slice(-52);
        (divBrandWk[m.code] ??= {})[brand] =
          m52.reduce((a, w) => a + (mB.get(w) ?? 0), 0) / Math.max(m52.length, 1);

        /* Plan-year WEEKLY base per item through the seasonality engine — the
           construction the Base Business Review plan view uses, at this division: each
           plan-year Saturday carries the item's year-ago measured base (364
           days back keeps Saturdays aligned); weeks whose source hasn't been
           measured yet project as the item's latest-52w average shaped by the
           division × brand's monthly index over its full history. Items the
           distribution verification marked "no volume" are left out; verified
           additions ride in on their proxy's series (× %) from their first
           week. The plan adjustments multiply each week.
           The brand series is the sum of its items, so an item-level lever is
           weighted exactly by that item's volume. */
        {
          /* The engine's shape comes from the items that still sell — volume
             in the latest 52 weeks — never from delisted items' history (see
             the Base Business Review, which builds it the same way). */
          const live = new Set(facts.filter((r) => r.week_ending >= (m52[0] ?? "") && (r.units ?? 0) > 0).map((r) => r.upc));
          const mBlive = new Map<string, number>();
          for (const [u, im] of mI) {
            if (!live.has(u)) continue;
            for (const [w, v] of im) mBlive.set(w, (mBlive.get(w) ?? 0) + v);
          }
          const mTot = Array(12).fill(0), mN = Array(12).fill(0);
          let gTot = 0, gN = 0;
          for (const [w, v] of mBlive) {
            const mo = +w.slice(5, 7) - 1;
            mTot[mo] += v; mN[mo] += 1; gTot += v; gN += 1;
          }
          const grand = gN > 0 ? gTot / gN : 0;
          const eng = mTot.map((t, i) => (mN[i] > 0 && grand > 0 ? t / mN[i] / grand : 1));
          // this year against last for the brand at this division — the level the projection runs at
          const brandTrend = trendOf(mBlive, mWeeks);
          const firstOf = new Map<string, string>();
          for (const [u, im] of mI) firstOf.set(u, [...im.keys()].sort()[0]);
          const avg52 = divBrandWk[m.code][brand];
          const latest = mWeeks[mWeeks.length - 1];
          const exclAvg52 = m52.reduce((a, w) => a + (mBx.get(w) ?? 0), 0) / Math.max(m52.length, 1);
          const proxyAvg52 = new Map<string, number>();
          for (const [u, pm] of mProxy) {
            proxyAvg52.set(u, m52.reduce((a, w) => a + (pm.get(w) ?? 0), 0) / Math.max(m52.length, 1));
          }
          const adjsHere = (adjByMkt[m.code] ?? []).filter((a) => a.brand === brand);
          const adjFactor = (upc: string, wt: number) => {
            let f = 1;
            for (const a of adjsHere) {
              if (utcOf(a.from) > wt || utcOf(a.to) < wt - 6 * DAY) continue;
              if (a.upc === "ALL" || a.upc === upc) f *= 1 + a.pct / 100;
            }
            return f;
          };
          // one item's raw (unadjusted) plan-year series: year-ago carried where
          // measured, then last year's shape at this year's run-rate (lib/server/projection)
          const rawSeries = (im: Map<string, number>, upc: string) => {
            const a52 = m52.reduce((a, w) => a + (im.get(w) ?? 0), 0) / Math.max(m52.length, 1);
            return planWeeks.map((w) => {
              const src = new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);
              if (latest && src <= latest) return im.get(src) ?? 0;
              return live.has(upc)
                ? projectItemWeek({ im, w, firstWeek: firstOf.get(upc), ratio: itemRatio(im, mWeeks, brandTrend), a52, engine: eng, measuredWeeks: mWeeks })
                : 0;
            });
          };
          const itemWkly = (divItemWkly[m.code] ??= {});
          const brandWkly = planWeeks.map(() => 0);
          if (latest) {
            for (const [u, im] of mI) {
              if (dv?.out.has(u)) continue; // no volume in the plan year
              const ser = rawSeries(im, u).map((v, i) => Math.max(0, v) * adjFactor(u, utcOf(planWeeks[i])));
              if (ser.every((v) => v <= 0)) continue;
              itemWkly[u] = ser.map((v) => +v.toFixed(1));
              ser.forEach((v, i) => { brandWkly[i] += v; });
            }
            for (const a of addsHere) {
              const pim = mI.get(a.proxy_upc);
              if (!pim) continue;
              const proxy = rawSeries(pim, a.proxy_upc);
              const ser = planWeeks.map((w, i) => {
                /* Consumption only — the pipeline fill is a shipment, not a
                   sale, so it is not in the base the events score against. */
                const v = w >= a.first_week ? proxy[i] * (a.proxy_pct / 100) : 0;
                return Math.max(0, v) * adjFactor(a.upc, utcOf(w));
              });
              itemWkly[a.upc] = ser.map((v, i) => +(v + (itemWkly[a.upc]?.[i] ?? 0)).toFixed(1));
              ser.forEach((v, i) => { brandWkly[i] += v; });
            }
          }
          (divBrandWkly[m.code] ??= {})[brand] = brandWkly.map((v) => +v.toFixed(1));
          const baseM = Array(12).fill(0);
          brandWkly.forEach((v, i) => { baseM[+planWeeks[i].slice(5, 7) - 1] += v; });
          (divBrandBaseM[m.code] ??= {})[brand] = baseM.map(Math.round);
          // events at this division score on the verified run rate
          divBrandWk[m.code][brand] = Math.max(0, avg52 - exclAvg52)
            + addsHere.reduce((a, x) => a + (proxyAvg52.get(x.proxy_upc) ?? 0) * (x.proxy_pct / 100), 0);
        }
        const c0 = m52[0] ?? "";
        const perUpc = (divItemWk[m.code] ??= {});
        for (const r of facts) {
          if (r.week_ending < c0) continue;
          const v = r.base_units ?? r.units ?? 0;
          if (v > 0) perUpc[r.upc] = (perUpc[r.upc] ?? 0) + v / Math.max(m52.length, 1);
        }
        if (dv) {
          for (const u of dv.out) delete perUpc[u]; // no volume → events can't score on it here
          for (const a of addsHere) {
            const pw = (perUpc[a.proxy_upc] ?? 0) * (a.proxy_pct / 100);
            if (pw > 0) perUpc[a.upc] = Math.max(perUpc[a.upc] ?? 0, pw); // launch item scores on its proxy
          }
        }

        // measured lift per Telus window at this division, grouped by tactic
        const latest = mWeeks[mWeeks.length - 1] ?? "";
        for (const o of await getPromoOverlays({ market_code: m.code, brand })) {
          if (o.start_date > latest) continue; // window entirely in the future — nothing measured
          // funding vehicles and always-on programs, not performance: their
          // year-long windows would credit EDLP / signage / AMP fees with the
          // lift of everything inside them
          if (isNonPerformance(o.performance_type) || isAlwaysOn(o.start_date, o.end_date)) continue;
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
    const ownByNorm = new Map(HEARTLAND_BRANDS.map((b) => [normBrand(b), b]));
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
    // Telus item number → NIQ UPCs, for just the SKUs in the book — lets the
    // client join a carried event's FY lines to their NIQ items on drill-down
    const telusUpcs: Record<string, string[]> = {};
    for (const ls of linesByPromo.values()) {
      for (const l of ls) {
        if (!(l.item_number in telusUpcs)) telusUpcs[l.item_number] = xwalk.telusUpcs[l.item_number] ?? [];
      }
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

    // UPC-resolved dated prices for the client + a run-rate-weighted brand
    // list price as of the plan year's start — ROI scores on gross revenue.
    const prices = priceRows
      .filter((r) => r.upc && r.unit_price !== null)
      .map((r) => ({ upc: r.upc!, unit_price: r.unit_price!, effective_from: r.effective_from }));
    const jan1 = `${year}-01-01`;
    const brandListPrice: Record<string, number | null> = {};
    for (const b of HEARTLAND_BRANDS) {
      let pw = 0, w = 0;
      for (const it of brandStats[b].items) {
        const p = priceAsOf(priceRows, jan1, { upc: it.upc })?.unit_price ?? null;
        if (p !== null) { pw += p * it.wk; w += it.wk; }
      }
      brandListPrice[b] = w > 0 ? +(pw / w).toFixed(4) : null;
    }

    /* The source year's GROSS SALES — the base the plan's gross target is set
       on. It is the in-flight year as the LE sees it: measured units through
       the NIQ edge, then the LE forecast to year-end (last year's shape at this
       year's run-rate, × each open Telus window's expected lift), every unit
       priced at the list price in force that week. Per division × brand by
       month, plus per item, so a brand or item selection can read its slice. */
    const fyYear = year - 1;
    const fyWeeks: string[] = [];
    {
      let t = Date.UTC(fyYear, 0, 1);
      while (new Date(t).getUTCDay() !== 6) t += DAY;
      for (; new Date(t).getUTCFullYear() === fyYear; t += 7 * DAY) fyWeeks.push(new Date(t).toISOString().slice(0, 10));
    }
    const fyGross: Record<string, Record<string, number[]>> = {};
    const fyGrossItem: Record<string, Record<string, number>> = {};
    let fyMeasured = 0, fyForecast = 0, fyEdge = "";
    for (const m of markets) {
      const allW = await listWeekEndings(m.code);
      const latestW = allW[allW.length - 1];
      if (!latestW) continue;
      if (latestW > fyEdge) fyEdge = latestW;
      for (const b of HEARTLAND_BRANDS) {
        const byItem = await fyWeeklyByItem(m.code, b, fyWeeks, allW, latestW);
        const mon = Array(12).fill(0);
        for (const [upc, series] of byItem) {
          let itemTot = 0;
          for (const x of series) {
            const g = x.tyU * (listAt(upc, x.w) ?? 0);
            mon[+x.w.slice(5, 7) - 1] += g;
            itemTot += g;
            if (x.measured) fyMeasured += g; else fyForecast += g;
          }
          if (itemTot > 0) (fyGrossItem[m.code] ??= {})[upc] = Math.round((fyGrossItem[m.code]?.[upc] ?? 0) + itemTot);
        }
        if (mon.some((v) => v > 0)) (fyGross[m.code] ??= {})[b] = mon.map(Math.round);
      }
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
    type ItemRate = { line_id: string; item_number: string; kind: "oi" | "scan"; rate: number };
    const promoItemRates = new Map<string, ItemRate[]>();
    for (const [pid, ls] of linesByPromo) {
      let fixed = 0;
      const agg = { oi: { pw: 0, w: 0 }, scan: { pw: 0, w: 0 } };
      const rates: ItemRate[] = [];
      for (const l of ls) {
        const bucket = l.component_type === "Scan" ? ("scan" as const)
          : /^(Off Invoice|Billback)/.test(l.component_type) ? ("oi" as const) : null;
        if (!bucket || l.rate_uom === "Lump Sum" || !(l.rate > 0)) { fixed += l.planned_amount; continue; }
        let perUnit: number | null = null;
        if (l.rate_uom === "Each") perUnit = l.rate;
        else {
          const { unit, perCase } = unitPriceInfo(l.item_number);
          if (l.rate_uom === "Case" && perCase) perUnit = l.rate / perCase;
          else if (l.rate_uom === "Percent" && unit) perUnit = (l.rate / 100) * unit;
        }
        if (perUnit === null || !(perUnit > 0)) { fixed += l.planned_amount; continue; }
        rates.push({ line_id: l.line_id, item_number: l.item_number, kind: bucket, rate: +perUnit.toFixed(3) });
        const w = l.planned_amount > 0 ? l.planned_amount : 1;
        agg[bucket].pw += perUnit * w;
        agg[bucket].w += w;
      }
      const oi = agg.oi.w > 0 ? +(agg.oi.pw / agg.oi.w).toFixed(3) : 0;
      const scan = agg.scan.w > 0 ? +(agg.scan.pw / agg.scan.w).toFixed(3) : 0;
      fixed = Math.round(fixed);
      if (oi > 0 || scan > 0 || fixed > 0) promoFunding.set(pid, { oi, scan, fixed });
      if (rates.length) promoItemRates.set(pid, rates);
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
      marketCodes: markets.map((m) => m.code),
      // a submitted plan is read-only until reopened (lib/planlock) — the
      // rail holds the page; this keeps the opening pop-up from offering to write
      locked: markets.length === 1 ? await planLocked(markets[0].code, year) : false,
      prices,
      brandListPrice,
      fyGross: { year: fyYear, edge: fyEdge, measured: Math.round(fyMeasured), forecast: Math.round(fyForecast), byMkt: fyGross, byItem: fyGrossItem },
      telusUpcs,
      divBrandBaseM,
      planWeeks,
      divBrandWkly,
      divItemWkly,
      adjustments: adjCount,
      priorItemMonthly: Object.fromEntries(Object.entries(priorItemMonthly).map(([mc, byItem]) => [
        mc,
        Object.fromEntries(Object.entries(byItem)
          .filter(([, s]) => s.u.some((v) => v > 0))
          .map(([u, s]) => [u, { u: s.u.map(Math.round), g: s.g.map(Math.round), pu: s.pu.map(Math.round), pg: s.pg.map(Math.round) }])),
      ])),
      priorMonthly: Object.fromEntries(Object.entries(priorMonthly).map(([mc, byBrand]) => [
        mc,
        Object.fromEntries(Object.entries(byBrand).map(([b, s]) => [
          b,
          { u: s.u.map(Math.round), g: s.g.map(Math.round), pu: s.pu.map(Math.round), pg: s.pg.map(Math.round) },
        ])),
      ])),
      dataEdge,
      distVer: { verified: dvVerified, customers: markets.length, excluded: dvOut, added: dvAdded },
      customers: customers.map((c) => ({ id: c.customer_id, name: c.customer_name })),
      copySource: promos.map((p) => ({
        promo_id: p.promo_id,
        title: p.promo_title, customer_id: p.customer_id, customer: p.customer_name,
        brand: brandFor(p.promo_id),
        upcs: [...(promoUpcs.get(p.promo_id) ?? [])],
        perf: p.performance_type, start: p.start_date, end: p.end_date,
        planned: Math.round(p.planned_amount),
        actual: Math.round(p.actual_amount),
        funding: promoFunding.get(p.promo_id),
        item_rates: promoItemRates.get(p.promo_id),
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
