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
