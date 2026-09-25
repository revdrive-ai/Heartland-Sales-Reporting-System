/* Distribution verification — the new-year gate on carried volume, per
   customer × plan year. Every item the previous year sold is confirmed In
   plan or No volume, and genuinely new items are added with an item to copy
   volume and seasonality from, a ship date and a projected on-shelf date.

   The types and the read live here rather than in lib/repo/client.ts because
   both the browser (which edits the doc) and the server (which builds the
   plan series from it) need them, and that module is "use client". */

export type DistAddition = {
  id: string;
  upc: string;            // item code — from the master, or typed in for an item that isn't in it yet
  name: string;
  brand: string;
  manual?: boolean;       // entered by hand rather than picked from the item master
  proxy_upc: string;      // the item whose weekly base AND seasonality this one copies
  proxy_pct: number;      // % of that item's base — derived from the two %ACVs
  est_acv?: number;       // the distribution this item is expected to reach
  ship_date: string;      // the day it ships to the customer — when the pipeline fill leaves the plant
  shelf_date: string;     // projected first day on shelf — what the forecast starts from
  first_week: string;     // the NIQ Saturday shelf_date falls into; ongoing volume starts here
  /* One-time pipeline fill: the stock bought to fill the shelves before the
     item ever sells. Entered in CASES (that is how it ships); loadin_units is
     the same fill in retail units — cases × the price list's units per case,
     or cases as-is when the pack is unknown — so downstream reads stay in
     units. Deliberately NOT part of the base, which is a consumption model;
     it is carried here for the shipment forecast to lay on by month once
     the plan is built. */
  loadin_units: number;
  loadin_cases?: number;
  units_per_case?: number;   // the pack the units were derived with, when known
};

export type DistVerification = {
  decisions: Record<string, "in" | "out">; // upc → keep in plan / no volume
  /** for an item set to No volume: the first day of the plan year it carries
      none. Absent = the whole year (the year's first day). Volume up to that
      day is carried as usual, so a mid-year delist keeps its first months. */
  out_from?: Record<string, string>;
  additions: DistAddition[];
  /** When someone answered the new-items question by saying there are none.
      The question counts as answered if this is set OR additions exist — a
      year with no launches is a real answer, not an unfinished step. */
  no_additions: string | null;
  verified_at: string | null;
};

/* ship_date/shelf_date replaced loadin_date, and first_week used to be typed
   straight in. Docs saved before that are read forward rather than migrated:
   the ship date was the load-in date, and the shelf date was whatever week
   the volume was set to start. */
type StoredAddition = Partial<DistAddition> & { loadin_date?: string };

function readAddition(a: StoredAddition): DistAddition {
  const shelf = a.shelf_date ?? a.first_week ?? "";
  return {
    id: a.id ?? "",
    upc: a.upc ?? "",
    name: a.name ?? "",
    brand: a.brand ?? "",
    manual: a.manual,
    proxy_upc: a.proxy_upc ?? "",
    proxy_pct: a.proxy_pct ?? 100,
    est_acv: a.est_acv,
    ship_date: a.ship_date ?? a.loadin_date ?? shelf,
    shelf_date: shelf,
    first_week: a.first_week ?? shelf,
    loadin_units: a.loadin_units ?? 0,
    ...(typeof a.loadin_cases === "number" ? { loadin_cases: a.loadin_cases } : {}),
    ...(typeof a.units_per_case === "number" ? { units_per_case: a.units_per_case } : {}),
  };
}


export const DV_EMPTY: DistVerification = { decisions: {}, additions: [], no_additions: null, verified_at: null };

/** Read a stored document — or anything shaped like one, including nothing. */
export function readDistVerification(raw: unknown): DistVerification {
  const doc = (raw ?? null) as Partial<DistVerification> | null;
  if (!doc) return { ...DV_EMPTY };
  return {
    decisions: doc.decisions ?? {},
    ...(doc.out_from && typeof doc.out_from === "object" ? { out_from: doc.out_from } : {}),
    additions: (doc.additions ?? []).map((a) => readAddition(a as StoredAddition)),
    no_additions: doc.no_additions ?? null,
    verified_at: doc.verified_at ?? null,
  };
}

/** The first day an item carries no volume in the plan year — null when it
    is in plan. A date before the year's first day reads as the whole year. */
export function outFromOf(dv: DistVerification, upc: string, year: number): string | null {
  if (dv.decisions[upc] !== "out") return null;
  const start = `${year}-01-01`;
  const d = dv.out_from?.[upc];
  return d && d > start ? d : start;
}
