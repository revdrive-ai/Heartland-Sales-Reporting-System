import { getPromoMeta, listMarkets, listWeekEndings } from "@/lib/repo";
import { getStates } from "@/lib/server/appstate";
import type { PlanSnapshotVersion } from "@/lib/server/planSnapshot";
import type { DistVerification, PlanAdjustment } from "@/lib/repo/client";
import type { WorkMode } from "@/lib/mode";
import { daysUntilLock, dueCycle, openCycle, type LeCycle } from "@/lib/leSchedule";

/* Where the work stands for the mode year, across every customer — the
   rollup behind the strip under the top bar and the Latest Estimate view.
   One batched app_state read: plansnap / adj / distver per customer. */

export type CustomerStatus = {
  code: string;
  name: string;
  versions: PlanSnapshotVersion[];
  latest: PlanSnapshotVersion | null;
  lockedForDue: boolean;         // locked for the cycle whose scheduled lock has passed
  lockedCycle: string | null;    // the cycle its newest version belongs to
  signedOff: boolean;            // plan years: a Plan of Record exists
  adjustments: number;
  distver: {
    out: number;
    added: number;
    verifiedAt: string | null;
    /** the new-items question has an answer — items added, or "none this year" */
    newItemsAnswered: boolean;
  };
};

export type ModeStatus = {
  kind: "le" | "plan";
  year: number;
  month: string;                 // the due cycle's month name
  /** the LE lock schedule: every account freezes at the end of the second
      Friday, so "which cycle" is a date, not whenever someone got to it */
  schedule: { due: LeCycle; open: LeCycle; daysToLock: number } | null;
  dataEdge: string;              // latest NIQ week on file
  telusSnapshot: string;
  customers: CustomerStatus[];
  totals: {
    customers: number;
    taken: number;               // LE: customers locked for the due cycle; Plan: customers with any version
    signed: number;              // Plan of Record count (plan years)
    verified: number;            // distribution verified
    newItems: number;            // the new-items question answered either way
    adjustments: number;
    events: number;              // plan events in the year document
  };
};

export function cycleMonth(d = new Date()): string {
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export async function getModeStatus(mode: WorkMode): Promise<ModeStatus | null> {
  if (mode.kind === "analyze") return null;
  const year = mode.kind === "le" ? mode.leYear : mode.planYear;
  const [markets, meta] = await Promise.all([listMarkets(), getPromoMeta()]);
  let dataEdge = "";
  for (const m of markets) {
    const w = await listWeekEndings(m.code);
    const last = w[w.length - 1];
    if (last && last > dataEdge) dataEdge = last;
  }
  const keys = markets.flatMap((m) => [`plansnap:${m.code}:${year}`, `adj:${m.code}:${year}`, `distver:${m.code}:${year}`]);
  keys.push(`events:${year}`);
  const docs = await getStates(keys);

  const now = new Date();
  const due = dueCycle(now), open = openCycle(now);
  const customers: CustomerStatus[] = markets.map((m) => {
    const versions = ((docs.get(`plansnap:${m.code}:${year}`) as { versions?: PlanSnapshotVersion[] } | undefined)?.versions ?? []);
    const latest = versions[versions.length - 1] ?? null;
    const adjs = (docs.get(`adj:${m.code}:${year}`) as PlanAdjustment[] | undefined) ?? [];
    const dv = docs.get(`distver:${m.code}:${year}`) as DistVerification | undefined;
    return {
      code: m.code,
      name: m.name,
      versions,
      latest,
      lockedForDue: versions.some((v) => (v.cycle ?? v.taken_at.slice(0, 7)) === due.key),
      lockedCycle: versions.length ? (versions[versions.length - 1].cycle ?? versions[versions.length - 1].taken_at.slice(0, 7)) : null,
      signedOff: versions.some((v) => v.kind === "por"),
      adjustments: adjs.length,
      distver: {
        out: Object.values(dv?.decisions ?? {}).filter((d) => d === "out").length,
        added: (dv?.additions ?? []).length,
        verifiedAt: dv?.verified_at ?? null,
        newItemsAnswered: !!dv?.no_additions || (dv?.additions ?? []).length > 0,
      },
    };
  });
  const events = docs.get(`events:${year}`);
  return {
    kind: mode.kind,
    year,
    month: due.monthName,
    schedule: mode.kind === "le" ? { due, open, daysToLock: daysUntilLock(open, now) } : null,
    dataEdge,
    telusSnapshot: meta.snapshot_date,
    customers,
    totals: {
      customers: customers.length,
      taken: mode.kind === "le" ? customers.filter((c) => c.lockedForDue).length : customers.filter((c) => c.versions.length > 0).length,
      signed: customers.filter((c) => c.signedOff).length,
      verified: customers.filter((c) => c.distver.verifiedAt).length,
      newItems: customers.filter((c) => c.distver.newItemsAnswered).length,
      adjustments: customers.reduce((a, c) => a + c.adjustments, 0),
      events: Array.isArray(events) ? events.length : 0,
    },
  };
}
