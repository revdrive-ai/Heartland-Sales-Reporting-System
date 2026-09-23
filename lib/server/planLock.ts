import { getStates } from "@/lib/server/appstate";
import { planLockedFrom, readPlanReopen } from "@/lib/planlock";
import type { PlanSnapshotVersion } from "@/lib/server/planSnapshot";

/* Is this customer's plan year locked? See lib/planlock. Read by the state
   endpoint before it writes a plan-year document, and by modeStatus for the
   rail. */

/** The per-account documents a plan year is built from — the ones the lock
    guards. The events doc is shared by every account in a year, so it is
    guarded in the planner rather than here. */
export const PLAN_DOC_PREFIXES = ["distver:", "adj:", "basereview:", "planbuilt:"] as const;

/** Parse "distver:ALB-JEWEL:2027" into its account and year, or null. */
export function planDocKey(key: string): { mkt: string; year: number } | null {
  for (const p of PLAN_DOC_PREFIXES) {
    if (!key.startsWith(p)) continue;
    const rest = key.slice(p.length);
    const i = rest.lastIndexOf(":");
    if (i <= 0) return null;
    const year = +rest.slice(i + 1);
    return Number.isInteger(year) ? { mkt: rest.slice(0, i), year } : null;
  }
  return null;
}

export async function planLocked(mkt: string, year: number): Promise<boolean> {
  const docs = await getStates([`plansnap:${mkt}:${year}`, `planreopen:${mkt}:${year}`]);
  const versions = ((docs.get(`plansnap:${mkt}:${year}`) as { versions?: PlanSnapshotVersion[] } | undefined)?.versions ?? []);
  return planLockedFrom(versions, readPlanReopen(docs.get(`planreopen:${mkt}:${year}`))).locked;
}
