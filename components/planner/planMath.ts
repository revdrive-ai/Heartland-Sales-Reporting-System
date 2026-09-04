import type { PlannerData } from "./PlannerView";

/* Shared plan-event scoring math — one rule for the events table, the inline
   lift edit, and the wizard rail, so they never disagree. */

export type PlanPayload = NonNullable<PlannerData["plan"]>;

/** Weekly base units an event plans against: the deal's items at the event's
    customer's divisions when the crosswalk knows them (falling back to the
    brand run-rate there when those items carry no NIQ volume at that
    customer), else the brand run-rate. 0 = not scorable — the customer has no
    NIQ divisions in scope. */
export function eventWeeklyBase(plan: PlanPayload, customer_id: string, brand: string, upcs?: string[]): number {
  const mkts = plan.custMarkets[customer_id];
  if (!mkts?.length) return 0;
  if (upcs?.length) {
    const w = mkts.reduce((a, m) => a + upcs.reduce((b, u) => b + (plan.divItemWk[m]?.[u] ?? 0), 0), 0);
    if (w > 0) return w;
  }
  return mkts.reduce((a, m) => a + (plan.divBrandWk[m]?.[brand] ?? 0), 0);
}

/** One item's weekly base at a customer's divisions (for the wizard's item
    picker); falls back to the scope-level run-rate when no customer chosen. */
export function itemWeeklyBase(plan: PlanPayload, customer_id: string, upc: string, scopeWk: number): number {
  const mkts = plan.custMarkets[customer_id];
  if (!mkts?.length) return customer_id ? 0 : scopeWk;
  return mkts.reduce((a, m) => a + (plan.divItemWk[m]?.[upc] ?? 0), 0);
}

/* ---- dated list prices ---- */

export type DatedPrice = { upc: string; unit_price: number; effective_from: string };

/** The list price in force for a UPC on a date (greatest effective_from ≤ date). */
export function listPriceAsOf(rows: DatedPrice[], upc: string, onDate: string): number | null {
  let best: DatedPrice | null = null;
  for (const r of rows) {
    if (r.upc !== upc || r.effective_from > onDate) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best?.unit_price ?? null;
}

/** The unit list price an event's gross revenue scores on, as of its start
    date: the deal's items weighted by their run-rate at the event's customer,
    else the brand's weighted list price. `extra` carries browser-local manual
    price edits, layered over the ingested list. null = no list price known. */
export function eventUnitPrice(
  plan: PlanPayload,
  extra: DatedPrice[],
  e: { upcs?: string[]; brand: string; start: string; customer_id: string },
): number | null {
  const rows = extra.length ? [...plan.prices, ...extra] : plan.prices;
  if (e.upcs?.length) {
    const mkts = plan.custMarkets[e.customer_id] ?? [];
    let pw = 0, w = 0;
    for (const u of e.upcs) {
      const p = listPriceAsOf(rows, u, e.start);
      if (p === null) continue;
      const wk = mkts.reduce((a, m) => a + (plan.divItemWk[m]?.[u] ?? 0), 0) || 1;
      pw += p * wk; w += wk;
    }
    if (w > 0) return pw / w;
  }
  return plan.brandListPrice[e.brand] ?? null;
}
