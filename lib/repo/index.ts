// The data seam. Views import ONLY from this module — never from
// lib/fixtures or a database client directly. Today every function is backed
// by generated fixtures (reads) and localStorage (writes), exactly mirroring
// the reference mockup's behavior. When Supabase lands, each body becomes a
// typed query and no view changes.
//
// Conventions:
// - Every function is async and returns the snake_case row shapes from
//   lib/types/db.ts, so swapping in Supabase changes signatures nowhere.
// - Reads are safe on server and client. localStorage-backed writes/reads
//   are client-only and fall back to defaults on the server.

import type { Market, Item, NielsenWeeklyRow } from "@/lib/types/db";
import { ALIGN_DEFAULT, type AlignRow } from "@/lib/data/alignmentKey";
import marketsJson from "@/lib/fixtures/markets.json";
import itemsJson from "@/lib/fixtures/items.json";
import jewelJson from "@/lib/fixtures/nielsen-weekly.alb-jewel.json";

const MARKETS = marketsJson as Market[];
const ITEMS = itemsJson as Item[];

/* Weekly facts, keyed by market. Divisions come online one at a time —
   loading another division = generating its fixture and adding it here
   (later: loading its CSV into Supabase and deleting this map). */
const FACTS: Record<string, NielsenWeeklyRow[]> = {
  "ALB-JEWEL": jewelJson as NielsenWeeklyRow[],
};

/* ------------------------------------------------------------------ MARKETS */

export async function listMarkets(opts?: { activeOnly?: boolean }): Promise<Market[]> {
  return opts?.activeOnly ? MARKETS.filter((m) => m.active) : MARKETS;
}

export async function getMarket(code: string): Promise<Market | undefined> {
  return MARKETS.find((m) => m.code === code);
}

/* -------------------------------------------------------------------- ITEMS */

export async function listItems(opts?: { brand?: string; ownOnly?: boolean }): Promise<Item[]> {
  return ITEMS.filter(
    (i) => (!opts?.brand || i.brand === opts.brand) && (!opts?.ownOnly || i.is_own)
  );
}

export async function listBrands(): Promise<string[]> {
  return [...new Set(ITEMS.map((i) => i.brand))];
}

/* ------------------------------------------------------------- WEEKLY FACTS */

export type WeeklyFactsFilter = {
  market_code: string;
  upc?: string;
  brand?: string;
  /** ISO dates, inclusive. Omit for all 52 weeks on file. */
  from?: string;
  to?: string;
};

export async function getWeeklyFacts(f: WeeklyFactsFilter): Promise<NielsenWeeklyRow[]> {
  const rows = FACTS[f.market_code] ?? [];
  return rows.filter(
    (r) =>
      (!f.upc || r.upc === f.upc) &&
      (!f.brand || r.brand === f.brand) &&
      (!f.from || r.week_ending >= f.from) &&
      (!f.to || r.week_ending <= f.to)
  );
}

/** Distinct week-endings on file for a market, ascending. */
export async function listWeekEndings(market_code: string): Promise<string[]> {
  return [...new Set((FACTS[market_code] ?? []).map((r) => r.week_ending))].sort();
}

/** Which markets actually have facts loaded (drives "division live" states). */
export async function listLoadedMarkets(): Promise<string[]> {
  return Object.keys(FACTS);
}

/* ---------------------------------------------------------- ALIGNMENT KEY
   Same store the mockup uses (localStorage `hhAlign`), behind the seam.
   Server-side reads return the defaults. */

const ALIGN_KEY = "hhAlign";

export async function getAlignment(): Promise<{ rows: AlignRow[]; version: number }> {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(ALIGN_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as { v: number; rows: AlignRow[] };
        return { rows: stored.rows, version: stored.v };
      }
    } catch {}
  }
  return { rows: structuredClone(ALIGN_DEFAULT), version: 1 };
}

export async function saveAlignment(rows: AlignRow[], version: number): Promise<void> {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ALIGN_KEY, JSON.stringify({ v: version, rows })); } catch {}
}
