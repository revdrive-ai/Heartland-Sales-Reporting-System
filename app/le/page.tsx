import { listItems } from "@/lib/repo";
import { getMode } from "@/lib/server/mode";
import { getScope } from "@/lib/server/scope";
import { getModeStatus } from "@/lib/server/modeStatus";
import { computePlanBase, type PlanSnapshotVersion } from "@/lib/server/planSnapshot";
import { lastCronRun } from "@/lib/server/leCron";
import { getState } from "@/lib/server/appstate";
import { getPromoOverlays } from "@/lib/repo";
import { fy, leRollup } from "@/lib/server/leRollup";
import { readLeOverlay } from "@/lib/leovl";
import LeView, { type LeData, type LeRow, type VersionLite } from "@/components/le/LeView";
import type { LockReadbackData } from "@/components/le/LockReadback";

/* Latest Estimate (LE) — the home of the monthly LE cycle and, in Plan mode,
   of the plan sign-off: every customer's versions side by side, the live
   working number against the last frozen one, and the take-LE / sign-off
   actions in one place. The same plansnap documents Base Business Review writes per
   customer; this view is the cross-customer read of them. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Page() {
  const mode = await getMode();
  // Analyze mode has no year of its own — show the in-flight LE cycle with a hint
  const effective = mode.kind === "analyze" ? { ...mode, kind: "le" as const } : mode;
  const scope = await getScope();
  const [status, items] = await Promise.all([getModeStatus(effective, scope.marketCodes), listItems()]);
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
      lockedForOpen: c.lockedForOpen,
      lockedCycle: c.lockedCycle,
      signedOff: c.signedOff,
      hasVersions: c.versions.length > 0,
    };
  });

  /* The estimate's last step reads ONE account back before it locks: the
     four numbers against the plan, last year and the last LE, and what this
     cycle changed. With one account in scope and a schedule to lock against,
     that read-back sits above the portfolio table. */
  let readback: LockReadbackData | null = null;
  if (effective.kind === "le" && status.customers.length === 1 && status.schedule) {
    const c = status.customers[0];
    const open = status.schedule.open;
    const [roll, promos, ovlRaw] = await Promise.all([
      leRollup(c.code, status.year),
      getPromoOverlays({ market_code: c.code, from: `${status.year}-01-01`, to: `${status.year}-12-31` }),
      getState(`leovl:${c.code}:${status.year}`).catch(() => undefined),
    ]);
    const ovl = readLeOverlay(ovlRaw);
    const t = fy(roll.totals);
    const titleOf = new Map(promos.map((p) => [p.promo_id, p.promo_title]));
    const thisCycle = c.versions.filter((v) => (v.cycle ?? v.taken_at.slice(0, 7)) === open.key).at(-1) ?? null;
    // the last LE to read against: the latest version from an earlier cycle, else the latest at all
    const earlier = c.versions.filter((v) => (v.cycle ?? v.taken_at.slice(0, 7)) !== open.key).at(-1) ?? c.versions.at(-1) ?? null;
    const lastMoney = earlier?.money ?? null;
    const nameOf = new Map(items.map((i) => [i.upc, i.name]));
    readback = {
      code: c.code,
      name: c.name,
      year: status.year,
      priorYear: roll.priorYear,
      edge: roll.edge,
      cycle: { key: open.key, label: open.label, lockDate: open.lockDate, daysToLock: status.schedule.daysToLock },
      kpis: {
        units: { fy: t.units, plan: t.planUnits, ly: t.lyUnits, lastLE: earlier?.totals.adjusted ?? null },
        gross: { fy: t.gross, plan: t.planGross, ly: t.lyGross, lastLE: lastMoney?.gross ?? null },
        trade: { fy: roll.trade.estTotal, plan: roll.trade.bookTotal, ly: null, lastLE: lastMoney?.trade ?? null },
        margin: { fy: t.gross - roll.trade.estTotal, plan: t.planGross - roll.trade.bookTotal, ly: null, lastLE: lastMoney ? lastMoney.gross - lastMoney.trade : null },
      },
      lastLE: earlier ? { label: earlier.label, seq: earlier.seq, takenAt: earlier.taken_at, cycle: earlier.cycle ?? null } : null,
      lockedThisCycle: thisCycle ? { seq: thisCycle.seq, takenAt: thisCycle.taken_at } : null,
      answer: c.leAnswer,
      adjustments: (lives[0]?.adjustments ?? []).map((a) => ({
        brand: a.brand, item: a.upc === "ALL" ? null : (nameOf.get(a.upc) ?? a.upc), kind: a.kind, pct: a.pct, from: a.from, to: a.to,
      })),
      promos: [
        ...Object.keys(ovl.cancelled).map((id) => ({ kind: "cancelled" as const, title: titleOf.get(id) ?? id, detail: "will not run — no lift, no spend from the edge on" })),
        ...Object.entries(ovl.changes).map(([id, ch]) => ({
          kind: "changed" as const, title: titleOf.get(id) ?? id,
          detail: [ch.start || ch.end ? `window ${ch.start ?? "…"} → ${ch.end ?? "…"}` : "", ch.lift_pct != null ? `lift ${ch.lift_pct}%` : "", ch.spend !== undefined ? `spend $${Math.round(ch.spend).toLocaleString()}` : "", ch.note ?? ""].filter(Boolean).join(" · ") || "changed",
        })),
        ...ovl.added.map((a) => ({ kind: "added" as const, title: a.title, detail: `${a.brand} · ${a.perf} · ${a.start} → ${a.end} · $${Math.round(a.spend).toLocaleString()}${a.lift_pct != null ? ` · lift ${a.lift_pct}%` : ""}` })),
      ],
    };
  }

  const data: LeData = {
    kind: status.kind,
    schedule: status.schedule,
    lastLockRun: await lastCronRun(status.year),
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
  return <LeView data={data} readback={readback} />;
}
