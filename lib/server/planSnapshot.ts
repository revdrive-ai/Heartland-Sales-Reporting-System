import { getWeeklyFacts, listItems, listWeekEndings } from "@/lib/repo";
import { getState, setState } from "@/lib/server/appstate";
import type { DistAddition, DistVerification, PlanAdjustment } from "@/lib/repo/client";

/* Plan-base snapshots — the sign-off & Latest Estimate mechanism.

   For one customer (NIQ division) × plan year, computePlanBase builds the
   plan base in UNITS per brand by month, with everything the plan view
   applies: the year-ago-carried weekly base (engine-shaped projection where
   the source week is unmeasured), distribution verification (excluded items
   out, additions on their proxy + load-in), and the planner adjustments
   (distribution / price / trend levers, item rows weighted by base share).

   Snapshot versions append to the shared doc plansnap:<mkt>:<year> —
   version 1 is the Plan of Record (the sign-off), later versions are the
   monthly Latest Estimates. Each version freezes the monthly numbers, the
   adjustment list, and the distver rollup, so change between any two
   versions is always reconstructable. */

const DAY = 86400000;
const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
const yearAgoWeek = (w: string) => new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);

function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type PlanBaseNow = {
  year: number;
  computed_at: string;
  byBrand: Record<string, { base: number[]; adjusted: number[] }>; // monthly units
  totals: { base: number; adjusted: number };
  adjustments: PlanAdjustment[];
  distver: { out: number; added: number; verifiedAt: string | null };
};

export type PlanSnapshotVersion = Omit<PlanBaseNow, "computed_at"> & {
  id: string;
  seq: number;             // 1 = Plan of Record, 2+ = Latest Estimates
  kind: "por" | "le";
  label: string;
  taken_at: string;
  note: string;
};

export async function computePlanBase(mkt: string, year: number): Promise<PlanBaseNow> {
  const items = await listItems();
  const ownBrands = [...new Set(items.filter((i) => i.is_own).map((i) => i.brand))].sort();
  const allWeeks = await listWeekEndings(mkt);
  const latest = allWeeks[allWeeks.length - 1];
  const last52 = allWeeks.slice(-52);
  const weeks = saturdaysOfYear(year);

  const dvRaw = (await getState(`distver:${mkt}:${year}`).catch(() => undefined)) as DistVerification | undefined;
  const out = new Set(Object.entries(dvRaw?.decisions ?? {}).filter(([, d]) => d === "out").map(([u]) => u));
  const additions: DistAddition[] = dvRaw?.additions ?? [];
  const adjs = ((await getState(`adj:${mkt}:${year}`).catch(() => undefined)) as PlanAdjustment[] | undefined) ?? [];

  const byBrand: PlanBaseNow["byBrand"] = {};
  let totBase = 0, totAdj = 0;

  for (const brand of ownBrands) {
    const facts = await getWeeklyFacts({ market_code: mkt, brand });
    if (!facts.length) continue;
    const adds = additions.filter((a) => a.brand === brand);

    const mB = new Map<string, number>();   // weekly base units, all items
    const mBx = new Map<string, number>();  // …the excluded items' slice
    const mProxy = new Map<string, Map<string, number>>();
    const shareTot = new Map<string, number>();
    let shareSum = 0;
    const last52Set = new Set(last52);
    for (const r of facts) {
      const v = r.base_units ?? r.units ?? 0;
      mB.set(r.week_ending, (mB.get(r.week_ending) ?? 0) + v);
      if (out.has(r.upc)) mBx.set(r.week_ending, (mBx.get(r.week_ending) ?? 0) + v);
      if (adds.some((a) => a.proxy_upc === r.upc)) {
        const pm = mProxy.get(r.upc) ?? mProxy.set(r.upc, new Map()).get(r.upc)!;
        pm.set(r.week_ending, (pm.get(r.week_ending) ?? 0) + v);
      }
      if (last52Set.has(r.week_ending) && v > 0) {
        shareTot.set(r.upc, (shareTot.get(r.upc) ?? 0) + v);
        shareSum += v;
      }
    }
    const share = (u: string) => (shareSum > 0 ? (shareTot.get(u) ?? 0) / shareSum : 0);

    // monthly seasonality index over full history + latest-52 run rates
    const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
    let gTot = 0, gN = 0;
    for (const [w, v] of mB) {
      const mo = +w.slice(5, 7) - 1;
      monthTot[mo] += v; monthN[mo] += 1; gTot += v; gN += 1;
    }
    const grand = gN > 0 ? gTot / gN : 0;
    const eng = monthTot.map((t, i) => (monthN[i] > 0 && grand > 0 ? t / monthN[i] / grand : 1));
    const avg = (m: Map<string, number>) => last52.reduce((a, w) => a + (m.get(w) ?? 0), 0) / Math.max(last52.length, 1);
    const avg52 = avg(mB), exclAvg52 = avg(mBx);
    const proxyAvg = new Map([...mProxy].map(([u, m]) => [u, avg(m)]));

    const brandAdjs = adjs.filter((a) => a.brand === brand);
    const base = Array(12).fill(0), adjusted = Array(12).fill(0);
    for (const w of weeks) {
      const mo = +w.slice(5, 7) - 1;
      const src = yearAgoWeek(w);
      let v = src <= latest ? (mB.get(src) ?? 0) - (mBx.get(src) ?? 0) : Math.max(0, avg52 - exclAvg52) * eng[mo];
      for (const a of adds) {
        if (w >= a.first_week) v += (proxyAvg.get(a.proxy_upc) ?? 0) * (a.proxy_pct / 100) * eng[mo];
        if (a.loadin_units > 0 && w >= a.loadin_date && utcOf(w) - utcOf(a.loadin_date.slice(0, 10)) < 7 * DAY) {
          v += a.loadin_units;
        }
      }
      v = Math.max(0, v);
      // adjustment multiplier — the same rule the Base & Lift chart applies
      let f = 1;
      const wt = utcOf(w);
      for (const a of brandAdjs) {
        if (utcOf(a.from) > wt || utcOf(a.to) < wt - 6 * DAY) continue;
        f *= 1 + (a.pct / 100) * (a.upc === "ALL" ? 1 : share(a.upc));
      }
      base[mo] += v;
      adjusted[mo] += v * f;
    }
    byBrand[brand] = { base: base.map(Math.round), adjusted: adjusted.map(Math.round) };
    totBase += base.reduce((a: number, x: number) => a + x, 0);
    totAdj += adjusted.reduce((a: number, x: number) => a + x, 0);
  }

  return {
    year,
    computed_at: new Date().toISOString(),
    byBrand,
    totals: { base: Math.round(totBase), adjusted: Math.round(totAdj) },
    adjustments: adjs,
    distver: { out: out.size, added: additions.length, verifiedAt: dvRaw?.verified_at ?? null },
  };
}

const snapKey = (mkt: string, year: number) => `plansnap:${mkt}:${year}`;

export async function getSnapshots(mkt: string, year: number): Promise<PlanSnapshotVersion[]> {
  const doc = (await getState(snapKey(mkt, year)).catch(() => undefined)) as { versions?: PlanSnapshotVersion[] } | undefined;
  return doc?.versions ?? [];
}

/** Freeze the current plan base as the next version: v1 = Plan of Record
    (the base sign-off), later versions = Latest Estimates. */
export async function takeSnapshot(mkt: string, year: number, note: string): Promise<PlanSnapshotVersion> {
  const [versions, now] = await Promise.all([getSnapshots(mkt, year), computePlanBase(mkt, year)]);
  const seq = versions.length + 1;
  const when = new Date();
  const version: PlanSnapshotVersion = {
    id: when.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    seq,
    kind: seq === 1 ? "por" : "le",
    label: seq === 1
      ? "Plan of Record"
      : `LE ${when.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`,
    taken_at: when.toISOString(),
    note,
    year: now.year,
    byBrand: now.byBrand,
    totals: now.totals,
    adjustments: now.adjustments,
    distver: now.distver,
  };
  await setState(snapKey(mkt, year), { versions: [...versions, version] });
  return version;
}
