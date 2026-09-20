import { getStates } from "@/lib/server/appstate";
import type { PlanSnapshotVersion } from "@/lib/server/planSnapshot";

/* Comparing Latest Estimates month over month.

   A customer takes its LE whenever it takes it, so raw version numbers don't
   line up across the portfolio — v3 at Jewel and v3 at Vons can be different
   months. The comparable unit is the CYCLE: the calendar month an LE was
   taken in. For a cycle, each customer contributes the latest version it had
   taken on or before the end of that month — so a customer that skipped a
   month still carries its standing number into both sides of a comparison
   and nets to zero there, which is what "what changed between the August and
   September LE" actually means. */

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cycleKey = (iso: string) => iso.slice(0, 7);
const cycleLabel = (key: string) => `LE ${MONTH_ABBR[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;

export type LeCycleMeta = {
  key: string;        // "2026-09"
  label: string;      // "LE Sep 2026"
  takenInCycle: number; // customers that took a version IN this cycle
  ofRecord: number;     // customers with any version standing as of this cycle
};

export type LeSeries = {
  key: string;
  label: string;
  months: number[];   // 12 monthly unit totals across the customers in scope
  total: number;
};

export type LeDriver = {
  upc: string;
  name: string;
  brand: string;
  latest: number;
  prior: number;
  delta: number;
  months: number[];   // per-month delta
};

export type LeCompare = {
  cycles: LeCycleMeta[];
  latest: LeSeries;
  comparisons: LeSeries[];
  drivers: LeDriver[];        // vs the first comparison — biggest absolute movers
  itemDetail: boolean;        // false when the versions predate per-item detail
  brands: string[];           // brands present in the latest cycle
  items: { upc: string; name: string; brand: string }[];
};

/** Every customer's versions for a year, newest last. */
async function versionsByCustomer(codes: string[], year: number): Promise<Map<string, PlanSnapshotVersion[]>> {
  const docs = await getStates(codes.map((c) => `plansnap:${c}:${year}`));
  const out = new Map<string, PlanSnapshotVersion[]>();
  for (const c of codes) {
    const v = (docs.get(`plansnap:${c}:${year}`) as { versions?: PlanSnapshotVersion[] } | undefined)?.versions ?? [];
    if (v.length) out.set(c, [...v].sort((a, b) => a.taken_at.localeCompare(b.taken_at)));
  }
  return out;
}

/** The version standing for a customer as of the end of a cycle month. */
function versionAsOf(versions: PlanSnapshotVersion[], key: string): PlanSnapshotVersion | null {
  let hit: PlanSnapshotVersion | null = null;
  for (const v of versions) {
    if (cycleKey(v.taken_at) <= key) hit = v; else break;
  }
  return hit;
}

const zero = () => Array(12).fill(0) as number[];

/** Sum one cycle across the customers in scope, narrowed to a brand and/or
    a single item. Falls back to the per-brand totals for versions frozen
    before per-item detail existed. */
function sumCycle(
  byCustomer: Map<string, PlanSnapshotVersion[]>,
  key: string,
  brand: string,
  item: string
): { months: number[]; byItem: Map<string, LeDriver> } {
  const months = zero();
  const byItem = new Map<string, LeDriver>();
  for (const versions of byCustomer.values()) {
    const v = versionAsOf(versions, key);
    if (!v) continue;
    const entries = Object.entries(v.byItem ?? {});
    if (entries.length) {
      for (const [upc, row] of entries) {
        if (brand !== "ALL" && row.brand !== brand) continue;
        if (item !== "ALL" && upc !== item) continue;
        const d = byItem.get(upc) ?? { upc, name: row.name, brand: row.brand, latest: 0, prior: 0, delta: 0, months: zero() };
        row.adjusted.forEach((x, i) => { d.months[i] += x; months[i] += x; });
        d.latest = d.months.reduce((a, x) => a + x, 0);
        byItem.set(upc, d);
      }
    } else if (item === "ALL") {
      // pre-item-detail version: brand totals only
      for (const [b, row] of Object.entries(v.byBrand ?? {})) {
        if (brand !== "ALL" && b !== brand) continue;
        row.adjusted.forEach((x, i) => { months[i] += x; });
      }
    }
  }
  return { months, byItem };
}

export async function getLeCompare(
  codes: string[],
  year: number,
  wanted: string[],
  brand: string,
  item: string
): Promise<LeCompare | null> {
  const byCustomer = await versionsByCustomer(codes, year);
  if (!byCustomer.size) return null;

  // every cycle any customer took a version in, newest first
  const keys = new Set<string>();
  for (const vs of byCustomer.values()) for (const v of vs) keys.add(cycleKey(v.taken_at));
  const ordered = [...keys].sort().reverse();
  const cycles: LeCycleMeta[] = ordered.map((key) => ({
    key,
    label: cycleLabel(key),
    takenInCycle: [...byCustomer.values()].filter((vs) => vs.some((v) => cycleKey(v.taken_at) === key)).length,
    ofRecord: [...byCustomer.values()].filter((vs) => versionAsOf(vs, key) !== null).length,
  }));

  const latestKey = ordered[0];
  const latestSum = sumCycle(byCustomer, latestKey, brand, item);
  const latest: LeSeries = {
    key: latestKey, label: cycleLabel(latestKey),
    months: latestSum.months.map(Math.round),
    total: Math.round(latestSum.months.reduce((a, x) => a + x, 0)),
  };

  // the chosen comparison cycles (never the latest itself), oldest last
  const picks = wanted.filter((k) => k !== latestKey && keys.has(k)).slice(0, 3);
  const sums = picks.map((k) => ({ key: k, ...sumCycle(byCustomer, k, brand, item) }));
  const comparisons: LeSeries[] = sums.map((s) => ({
    key: s.key, label: cycleLabel(s.key),
    months: s.months.map(Math.round),
    total: Math.round(s.months.reduce((a, x) => a + x, 0)),
  }));

  // item movers vs the first (primary) comparison
  const drivers: LeDriver[] = [];
  const primary = sums[0];
  if (primary) {
    const upcs = new Set([...latestSum.byItem.keys(), ...primary.byItem.keys()]);
    for (const upc of upcs) {
      const a = latestSum.byItem.get(upc);
      const b = primary.byItem.get(upc);
      const months = zero().map((_, i) => Math.round((a?.months[i] ?? 0) - (b?.months[i] ?? 0)));
      const lat = Math.round(a?.months.reduce((x, y) => x + y, 0) ?? 0);
      const pri = Math.round(b?.months.reduce((x, y) => x + y, 0) ?? 0);
      if (lat === pri) continue;
      drivers.push({
        upc,
        name: a?.name ?? b?.name ?? upc,
        brand: a?.brand ?? b?.brand ?? "",
        latest: lat, prior: pri, delta: lat - pri, months,
      });
    }
    drivers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  }

  // brand + item pickers read from the latest cycle, unfiltered
  const full = sumCycle(byCustomer, latestKey, "ALL", "ALL");
  const items = [...full.byItem.values()]
    .sort((a, b) => b.latest - a.latest)
    .map((d) => ({ upc: d.upc, name: d.name, brand: d.brand }));

  return {
    cycles,
    latest,
    comparisons,
    drivers: drivers.slice(0, 40),
    itemDetail: full.byItem.size > 0,
    brands: [...new Set(items.map((i) => i.brand))].sort(),
    items,
  };
}
