/* The plan lock, per customer × plan year.

   Once a plan has been submitted from Review & submit it is the plan of
   record, and nothing in it changes by accident: the distribution answers,
   the new items, the levers on the base, the events and the two step
   submissions are read-only until someone deliberately REOPENS it. A
   reopen is a small record — when, and why — and the next submission from
   Review & submit closes the plan again by being newer than it.

   Neutral module: the browser writes the reopen through lib/repo/client,
   the server reads both in lib/server/planLock. */

export type PlanReopen = { at: string; note: string };

export function readPlanReopen(raw: unknown): PlanReopen | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<PlanReopen>;
  return typeof r.at === "string" && r.at ? { at: r.at, note: String(r.note ?? "") } : null;
}

/** Locked when a Review & submit submission stands and no reopen is newer. */
export function planLockedFrom(
  versions: { taken_at: string; submitted_from?: string }[],
  reopen: PlanReopen | null
): { locked: boolean; submittedAt: string | null } {
  const subs = versions.filter((v) => v.submitted_from === "review").map((v) => v.taken_at).sort();
  const last = subs[subs.length - 1] ?? null;
  if (!last) return { locked: false, submittedAt: null };
  return { locked: !reopen || reopen.at < last, submittedAt: last };
}
