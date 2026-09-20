import { listItems } from "@/lib/repo";
import { getMode } from "@/lib/server/mode";
import { getModeStatus } from "@/lib/server/modeStatus";
import { computePlanBase, type PlanSnapshotVersion } from "@/lib/server/planSnapshot";
import LeView, { type LeData, type LeRow, type VersionLite } from "@/components/le/LeView";

/* Latest Estimate (LE) — the home of the monthly LE cycle and, in Plan mode,
   of the plan sign-off: every customer's versions side by side, the live
   working number against the last frozen one, and the take-LE / sign-off
   actions in one place. The same plansnap documents Base & Lift writes per
   customer; this view is the cross-customer read of them. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Page() {
  const mode = await getMode();
  // Analyze mode has no year of its own — show the in-flight LE cycle with a hint
  const effective = mode.kind === "analyze" ? { ...mode, kind: "le" as const } : mode;
  const [status, items] = await Promise.all([getModeStatus(effective), listItems()]);
  if (!status) throw new Error("mode status unavailable");
  const brands = [...new Set(items.filter((i) => i.is_own).map((i) => i.brand))].sort();

  const lives = await Promise.all(status.customers.map((c) => computePlanBase(c.code, status.year).catch(() => null)));

  const lite = (v: PlanSnapshotVersion): VersionLite => ({
    id: v.id, seq: v.seq, kind: v.kind, label: v.label, taken_at: v.taken_at, note: v.note,
    cycle: v.cycle, scheduled_lock: v.scheduled_lock, locked_late: v.locked_late,
    total: v.totals.adjusted, adjustments: v.adjustments.length, distver: v.distver,
  });

  const zero = () => Array(12).fill(0) as number[];
  const latestM: Record<string, number[]> = {}, prevM: Record<string, number[]> = {}, liveM: Record<string, number[]> = {};
  for (const b of brands) { latestM[b] = zero(); prevM[b] = zero(); liveM[b] = zero(); }
  const add = (into: Record<string, number[]>, byBrand: Record<string, { adjusted: number[] }>) => {
    for (const [b, v] of Object.entries(byBrand)) {
      if (!into[b]) into[b] = zero();
      v.adjusted.forEach((x, i) => { into[b][i] += x; });
    }
  };

  const rows: LeRow[] = status.customers.map((c, i) => {
    const live = lives[i];
    const latest = c.latest;
    const prev = c.versions.length > 1 ? c.versions[c.versions.length - 2] : null;
    if (latest) add(latestM, latest.byBrand);
    if (prev) add(prevM, prev.byBrand); else if (latest) add(prevM, latest.byBrand);
    if (live) add(liveM, live.byBrand);
    return {
      code: c.code,
      name: c.name,
      versions: c.versions.map(lite),
      live: live ? { total: live.totals.adjusted, adjustments: live.adjustments.length, distver: live.distver } : null,
      lockedForDue: c.lockedForDue,
      lockedCycle: c.lockedCycle,
      signedOff: c.signedOff,
      hasVersions: c.versions.length > 0,
    };
  });

  const data: LeData = {
    kind: status.kind,
    schedule: status.schedule,
    hint: mode.kind === "analyze" ? `Working on: Analyze — showing the in-flight FY${status.year} LE cycle. Switch to LE or Plan in the top bar to act here.` : null,
    year: status.year,
    month: status.month,
    dataEdge: status.dataEdge,
    telusSnapshot: status.telusSnapshot,
    brands: [...new Set([...brands, ...Object.keys(latestM), ...Object.keys(liveM)])].sort(),
    rows,
    totals: status.totals,
    portfolio: { months: MONTHS, latest: latestM, previous: prevM, live: liveM },
  };
  return <LeView data={data} />;
}
