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
  ship_date: string;      // the day it ships to the customer — the pipeline fill lands in this week
  shelf_date: string;     // projected first day on shelf — what the forecast starts from
  first_week: string;     // the NIQ Saturday shelf_date falls into; ongoing volume starts here
  loadin_units: number;   // one-time pipeline fill, retail units
};

export type DistVerification = {
  decisions: Record<string, "in" | "out">; // upc → keep in plan / no volume
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
  };
}


export const DV_EMPTY: DistVerification = { decisions: {}, additions: [], no_additions: null, verified_at: null };

/** Read a stored document — or anything shaped like one, including nothing. */
export function readDistVerification(raw: unknown): DistVerification {
  const doc = (raw ?? null) as Partial<DistVerification> | null;
  if (!doc) return { ...DV_EMPTY };
  return {
    decisions: doc.decisions ?? {},
    additions: (doc.additions ?? []).map((a) => readAddition(a as StoredAddition)),
    no_additions: doc.no_additions ?? null,
    verified_at: doc.verified_at ?? null,
  };
}
