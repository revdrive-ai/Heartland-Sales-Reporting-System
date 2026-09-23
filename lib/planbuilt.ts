/* Build the plan's own completion record, per customer × plan year.

   Building the plan leaves events behind but had no finish line, so the
   step could never tick. Now it is submitted from the events card — the
   button at the end of the row with + New event — which records when, and
   how many events the plan held at the time, and moves on to Review &
   submit. Submitting again just restamps it.

   Neutral module: the browser writes it through lib/repo/client, the server
   reads it in lib/server/modeStatus and the review page. */

export type PlanBuilt = {
  built_at: string | null;
  events?: number;      // events on this account's plan when it was submitted
};

export const PLAN_BUILT_EMPTY: PlanBuilt = { built_at: null };

export function readPlanBuilt(raw: unknown): PlanBuilt {
  if (!raw || typeof raw !== "object") return PLAN_BUILT_EMPTY;
  const r = raw as Partial<PlanBuilt>;
  return {
    built_at: typeof r.built_at === "string" ? r.built_at : null,
    ...(r.events != null ? { events: +r.events || 0 } : {}),
  };
}
