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
