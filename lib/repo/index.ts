// The data seam — SERVER SIDE. Views never touch data files or a database
// client directly; server components (and route handlers) call these
// functions and pass results down as props. Weekly facts are the real ALBSCO
// NIQ data pull (data/nielsen/*.json.gz, produced by scripts/ingest_albsco.py
// from data/raw/). When Supabase lands, each body becomes a typed query and
// nothing outside lib/repo/ changes.
//
// This module reads the filesystem, so it must only be imported from server
// code — a client-component import fails the build by design. Client-side
// stores (alignment key etc.) live in lib/repo/client.ts.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { Market, Item, NielsenWeeklyRow } from "@/lib/types/db";
import marketsJson from "@/lib/fixtures/markets.json";
import itemsJson from "@/lib/fixtures/items.json";

const MARKETS = marketsJson as Market[];
const ITEMS = itemsJson as Item[];

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

export async function getItem(upc: string): Promise<Item | undefined> {
  return ITEMS.find((i) => i.upc === upc);
}

export async function listBrands(opts?: { ownOnly?: boolean }): Promise<string[]> {
  const src = opts?.ownOnly ? ITEMS.filter((i) => i.is_own) : ITEMS;
  return [...new Set(src.map((i) => i.brand))].sort();
}

/* ------------------------------------------------------------- WEEKLY FACTS */

const factsCache = new Map<string, NielsenWeeklyRow[]>();

function loadFacts(market_code: string): NielsenWeeklyRow[] {
  const hit = factsCache.get(market_code);
  if (hit) return hit;
  if (!MARKETS.some((m) => m.code === market_code)) return [];
  const file = path.join(process.cwd(), "data", "nielsen", `${market_code}.json.gz`);
  let rows: NielsenWeeklyRow[];
  try {
    rows = JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8"));
  } catch {
    rows = []; // market exists but its division data isn't loaded yet
  }
  factsCache.set(market_code, rows);
  return rows;
}

export type WeeklyFactsFilter = {
  market_code: string;
  upc?: string;
  brand?: string;
  category?: string;
  ownOnly?: boolean;
  /** ISO dates, inclusive. Omit for all weeks on file. */
  from?: string;
  to?: string;
};

export async function getWeeklyFacts(f: WeeklyFactsFilter): Promise<NielsenWeeklyRow[]> {
  const own = f.ownOnly ? new Set(ITEMS.filter((i) => i.is_own).map((i) => i.upc)) : null;
  return loadFacts(f.market_code).filter(
    (r) =>
      (!f.upc || r.upc === f.upc) &&
      (!f.brand || r.brand === f.brand) &&
      (!f.category || r.category === f.category) &&
      (!own || own.has(r.upc)) &&
      (!f.from || r.week_ending >= f.from) &&
      (!f.to || r.week_ending <= f.to)
  );
}

/** Distinct week-endings on file for a market, ascending. */
export async function listWeekEndings(market_code: string): Promise<string[]> {
  return [...new Set(loadFacts(market_code).map((r) => r.week_ending))].sort();
}
