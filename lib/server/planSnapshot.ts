import { getWeeklyFacts, listItems, listWeekEndings } from "@/lib/repo";
import { getState, setState } from "@/lib/server/appstate";
import { fyWeeklyByItem } from "@/lib/server/fyForecast";
import { readDistVerification, type DistAddition, type DistVerification } from "@/lib/distver";
import type { PlanAdjustment } from "@/lib/repo/client";
import { cycleFromKey, dueCycle } from "@/lib/leSchedule";

/* Plan-base snapshots — the sign-off & Latest Estimate mechanism.

   For one customer (NIQ division) × plan year, computePlanBase builds the
   plan base in UNITS per brand by month, with everything the plan view
   applies: the year-ago-carried weekly base (engine-shaped projection where
   the source week is unmeasured), distribution verification (excluded items
   out, additions on their proxy), and the planner adjustments
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
  /** the same monthly units per ITEM — what the LE comparison drills into to
      say which items moved. Each brand total is the sum of its items, so the
      drill-down always reconciles with the headline. */
  byItem: Record<string, { brand: string; name: string; adjusted: number[] }>;
  totals: { base: number; adjusted: number };
  adjustments: PlanAdjustment[];
  distver: { out: number; added: number; verifiedAt: string | null };
};

export type PlanSnapshotVersion = Omit<PlanBaseNow, "computed_at"> & {
  id: string;
  seq: number;             // 1 = Plan of Record, 2+ = Latest Estimates
  kind: "por" | "le";
  label: string;
  taken_at: string;        // when this version was actually written
  note: string;
  /** LE versions: the scheduled lock this belongs to. Every account locks on
      the same schedule — the end of the second Friday of the month — so the
      cycle, not the moment someone pressed the button, is what lines versions
      up across customers. */
  cycle?: string;          // "2026-09"
  scheduled_lock?: string; // that cycle's lock instant, ISO
  locked_late?: boolean;   // written after the scheduled instant had passed
};

export async function computePlanBase(mkt: string, year: number): Promise<PlanBaseNow> {
  const items = await listItems();
  const heartlandBrands = [...new Set(items.filter((i) => i.is_own).map((i) => i.brand))].sort();
  const allWeeks = await listWeekEndings(mkt);
  const latest = allWeeks[allWeeks.length - 1];
  const last52 = allWeeks.slice(-52);
  const weeks = saturdaysOfYear(year);

  /* The data-edge year is the in-flight year: its LE freezes measured ACTUAL
     units for landed weeks plus the forecast (year-ago base × expected Telus
     window lift) for the rest — the Total-year view's construction — rather
     than the pre-promo plan base a forward year signs off on. */
  if (year === +latest.slice(0, 4)) {
    const byBrand: PlanBaseNow["byBrand"] = {};
    const byItem: PlanBaseNow["byItem"] = {};
    const itemName = new Map(items.map((i) => [i.upc, i.name]));
    let tot = 0;
    const dvRawIY = (await getState(`distver:${mkt}:${year}`).catch(() => undefined)) as DistVerification | undefined;
    for (const brand of heartlandBrands) {
      const perItem = await fyWeeklyByItem(mkt, brand, weeks, allWeeks, latest);
      if (!perItem.size) continue;
      const bm = Array(12).fill(0);
      for (const [upc, series] of perItem) {
        const m = Array(12).fill(0);
        for (const s of series) m[+s.w.slice(5, 7) - 1] += s.tyU;
        if (m.every((v) => v <= 0)) continue;
        byItem[upc] = { brand, name: itemName.get(upc) ?? upc, adjusted: m.map(Math.round) };
        m.forEach((v, i) => { bm[i] += v; });
      }
      const monthly = bm.map(Math.round);
      byBrand[brand] = { base: monthly, adjusted: monthly }; // one number in-year: expected total
      tot += monthly.reduce((a: number, x: number) => a + x, 0);
    }
    const adjsIY = ((await getState(`adj:${mkt}:${year}`).catch(() => undefined)) as PlanAdjustment[] | undefined) ?? [];
    return {
      year,
      computed_at: new Date().toISOString(),
      byBrand,
      byItem,
      totals: { base: Math.round(tot), adjusted: Math.round(tot) },
      adjustments: adjsIY, // LE adjustments — applied to the forecast weeks inside fyWeeklySeries
      distver: {
        out: Object.values(dvRawIY?.decisions ?? {}).filter((d) => d === "out").length,
        added: (dvRawIY?.additions ?? []).length,
        verifiedAt: dvRawIY?.verified_at ?? null,
      },
    };
  }

  /* A forward plan year: the pre-promo plan base, built PER ITEM so the LE
     comparison can say which items moved. Each item carries its year-ago
     weekly base forward (engine-shaped run rate where the source week was
     never measured); items the distribution verification took out carry
     nothing, verified additions ride their proxy's shape,
     and the plan adjustments multiply the weeks they cover — in full on the
     item they name, so an item-level lever is exact rather than weighted.
     Each brand total is the sum of its items. */
  const dvRaw = (await getState(`distver:${mkt}:${year}`).catch(() => undefined)) as DistVerification | undefined;
  const out = new Set(Object.entries(dvRaw?.decisions ?? {}).filter(([, d]) => d === "out").map(([u]) => u));
  const additions: DistAddition[] = readDistVerification(dvRaw).additions;
  const adjs = ((await getState(`adj:${mkt}:${year}`).catch(() => undefined)) as PlanAdjustment[] | undefined) ?? [];
  const itemName = new Map(items.map((i) => [i.upc, i.name]));

  const byBrand: PlanBaseNow["byBrand"] = {};
  const byItem: PlanBaseNow["byItem"] = {};
  let totBase = 0, totAdj = 0;

  for (const brand of heartlandBrands) {
    const facts = await getWeeklyFacts({ market_code: mkt, brand });
    if (!facts.length) continue;
    const adds = additions.filter((a) => a.brand === brand);
    const brandAdjs = adjs.filter((a) => a.brand === brand);

    // weekly base per item, and the brand's own history for the engine
    const mI = new Map<string, Map<string, number>>();
    const mB = new Map<string, number>();
    for (const r of facts) {
      const v = r.base_units ?? r.units ?? 0;
      const im = mI.get(r.upc) ?? mI.set(r.upc, new Map()).get(r.upc)!;
      im.set(r.week_ending, (im.get(r.week_ending) ?? 0) + v);
      mB.set(r.week_ending, (mB.get(r.week_ending) ?? 0) + v);
    }

    // monthly seasonality index over the brand's full history
    const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
    let gTot = 0, gN = 0;
    for (const [w, v] of mB) {
      const mo = +w.slice(5, 7) - 1;
      monthTot[mo] += v; monthN[mo] += 1; gTot += v; gN += 1;
    }
    const grand = gN > 0 ? gTot / gN : 0;
    const eng = monthTot.map((t, i) => (monthN[i] > 0 && grand > 0 ? t / monthN[i] / grand : 1));
    const avg = (m: Map<string, number>) => last52.reduce((a, w) => a + (m.get(w) ?? 0), 0) / Math.max(last52.length, 1);

    const adjFactor = (upc: string, wISO: string) => {
      const wt = utcOf(wISO);
      let f = 1;
      for (const a of brandAdjs) {
        if (utcOf(a.from) > wt || utcOf(a.to) < wt - 6 * DAY) continue;
        if (a.upc === "ALL" || a.upc === upc) f *= 1 + a.pct / 100;
      }
      return f;
    };
    /** one item's carried weekly base, before adjustments */
    const rawOf = (im: Map<string, number>) => {
      const a52 = avg(im);
      return weeks.map((w) => {
        const src = yearAgoWeek(w);
        return Math.max(0, src <= latest ? (im.get(src) ?? 0) : a52 * eng[+w.slice(5, 7) - 1]);
      });
    };

    const bBase = Array(12).fill(0), bAdj = Array(12).fill(0);
    const addItem = (upc: string, weekly: number[]) => {
      const base = Array(12).fill(0), adjusted = Array(12).fill(0);
      weekly.forEach((v, i) => {
        const mo = +weeks[i].slice(5, 7) - 1;
        base[mo] += v;
        adjusted[mo] += v * adjFactor(upc, weeks[i]);
      });
      if (adjusted.every((v) => v <= 0)) return;
      const prev = byItem[upc];
      byItem[upc] = {
        brand,
        name: itemName.get(upc) ?? upc,
        adjusted: adjusted.map((v, i) => Math.round(v + (prev?.adjusted[i] ?? 0))),
      };
      base.forEach((v, i) => { bBase[i] += v; });
      adjusted.forEach((v, i) => { bAdj[i] += v; });
    };

    for (const [upc, im] of mI) {
      if (out.has(upc)) continue; // no volume in the plan year
      addItem(upc, rawOf(im));
    }
    for (const a of adds) {
      const pim = mI.get(a.proxy_upc);
      if (!pim) continue;
      const proxy = rawOf(pim);
      /* Consumption only: the pipeline fill ships into the warehouse, it is
         not taken off the shelf, so it is not part of the frozen base. */
      addItem(a.upc, weeks.map((w, i) => (w >= a.first_week ? proxy[i] * (a.proxy_pct / 100) : 0)));
    }

    byBrand[brand] = { base: bBase.map(Math.round), adjusted: bAdj.map(Math.round) };
    totBase += bBase.reduce((a: number, x: number) => a + x, 0);
    totAdj += bAdj.reduce((a: number, x: number) => a + x, 0);
  }

  return {
    year,
    computed_at: new Date().toISOString(),
    byBrand,
    byItem,
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
export async function takeSnapshot(mkt: string, year: number, note: string, cycleKey?: string): Promise<PlanSnapshotVersion> {
  const [versions, now] = await Promise.all([getSnapshots(mkt, year), computePlanBase(mkt, year)]);
  const seq = versions.length + 1;
  const when = new Date();
  // a forward plan year's first version is the base sign-off (Plan of Record);
  // the in-flight (data-edge) year has its plan of record in Telus, so every
  // version there is an LE — the first one labeled as the baseline
  const allWeeks = await listWeekEndings(mkt);
  const inFlight = year <= +allWeeks[allWeeks.length - 1].slice(0, 4);
  /* An LE belongs to a scheduled cycle: the one asked for, else the cycle
     whose lock has most recently passed. A forward year's sign-off is not on
     that schedule, so it carries no cycle. */
  const cyc = inFlight ? (cycleKey ? cycleFromKey(cycleKey) : dueCycle(when)) : null;
  const version: PlanSnapshotVersion = {
    id: when.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    seq,
    kind: seq === 1 && !inFlight ? "por" : "le",
    label: cyc ? cyc.label : seq === 1 ? "Plan of Record" : `LE ${when.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`,
    taken_at: when.toISOString(),
    note,
    ...(cyc ? {
      cycle: cyc.key,
      scheduled_lock: cyc.lockAt,
      // the lock instant is midnight ending the second Friday, so a job that
      // runs that same day is on time; a later day is genuinely late
      locked_late: when.toISOString().slice(0, 10) > cyc.lockAt.slice(0, 10),
    } : {}),
    year: now.year,
    byBrand: now.byBrand,
    byItem: now.byItem,
    totals: now.totals,
    adjustments: now.adjustments,
    distver: now.distver,
  };
  await setState(snapKey(mkt, year), { versions: [...versions, version] });
  return version;
}
