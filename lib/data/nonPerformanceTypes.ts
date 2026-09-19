/* Telus performance types that are funding vehicles, not in-store performance.
   EDLP off-invoice money funds the everyday shelf price — its volume effect is
   already inside the NIQ base by definition — and Slotting is a payment for
   placement, not a promotion. The client enters no lift for these in Telus, so
   the planner must not synthesize one:

   - excluded from the measured-lift-by-tactic overlay (their windows are
     typically year-long and would soak up the lift of every TPR/feature that
     runs inside them)
   - carried/imported/wizard events of these types pre-fill lift 0, not the
     brand average — spend still counts against the budget, incremental volume
     is zero, and the lift cell stays editable for anyone modeling a scenario */

export const NON_PERFORMANCE_TYPES = new Set(["EDLP", "Slotting"]);

export const isNonPerformance = (perf: string | null | undefined) =>
  perf != null && NON_PERFORMANCE_TYPES.has(perf);

/* Always-on programs. A window longer than 12 weeks (the Base & Lift rule
   for what draws as an event band vs a lane) is a condition the NIQ base
   already lives under — year-round signage, AMP fees, EDLP — so it carries
   no lift of its own in a plan: crediting it with the tactic average would
   add a year of "incremental" the base already contains. The lift cell
   stays editable for the cases someone knows better. */
export const EVENT_MAX_DAYS = 84;
const DAY = 86400000;
const utcOf = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export function isAlwaysOn(start: string, end: string): boolean {
  return (utcOf(end) - utcOf(start)) / DAY > EVENT_MAX_DAYS;
}
