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

/* -------------------------------------------------------------- PROMOTIONS
   Telus promotions snapshot (data/promos/, produced by
   scripts/ingest_promos.py). Same seam rules: server-only reads, Supabase
   queries later. */

import type { Promotion, PromoLine, PromoEnums, PromoMeta } from "@/lib/types/db";
import promoEnumsJson from "@/lib/fixtures/promo-enums.json";

let promoCache: Promotion[] | null = null;
let lineCache: PromoLine[] | null = null;

function loadGz<T>(rel: string): T {
  const file = path.join(process.cwd(), "data", "promos", rel);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as T;
}

function promos(): Promotion[] {
  return (promoCache ??= loadGz<Promotion[]>("promotions.json.gz"));
}
function promoLines(): PromoLine[] {
  return (lineCache ??= loadGz<PromoLine[]>("promo-lines.json.gz"));
}

export type PromotionsFilter = {
  status?: Promotion["promo_status"];
  customer_id?: string;
  channel?: Promotion["channel"];
  market?: Promotion["market"];
  performance_type?: string;
  template_type?: string;
  /** keep promotions whose window overlaps [from, to] (ISO dates, inclusive) */
  from?: string;
  to?: string;
};

export async function listPromotions(f?: PromotionsFilter): Promise<Promotion[]> {
  let rows = promos();
  if (f) {
    rows = rows.filter(
      (p) =>
        (!f.status || p.promo_status === f.status) &&
        (!f.customer_id || p.customer_id === f.customer_id) &&
        (!f.channel || p.channel === f.channel) &&
        (!f.market || p.market === f.market) &&
        (!f.performance_type || p.performance_type === f.performance_type) &&
        (!f.template_type || p.template_type === f.template_type) &&
        (!f.to || p.start_date <= f.to) &&
        (!f.from || p.end_date >= f.from)
    );
  }
  return rows;
}

export async function getPromotion(promo_id: string): Promise<Promotion | undefined> {
  return promos().find((p) => p.promo_id === promo_id);
}

export async function getPromoLines(promo_id: string): Promise<PromoLine[]> {
  return promoLines().filter((l) => l.promo_id === promo_id);
}

export async function listAllPromoLines(): Promise<PromoLine[]> {
  return promoLines();
}

/** Distinct customers carrying promotions, with spend rollups, biggest first. */
export async function listPromoCustomers(): Promise<
  { customer_id: string; customer_name: string; channel: string; market: string; promos: number; planned: number; actual: number }[]
> {
  const by = new Map<string, { customer_id: string; customer_name: string; channel: string; market: string; promos: number; planned: number; actual: number }>();
  for (const p of promos()) {
    const c = by.get(p.customer_id) ?? {
      customer_id: p.customer_id, customer_name: p.customer_name,
      channel: p.channel, market: p.market, promos: 0, planned: 0, actual: 0,
    };
    c.promos += 1;
    c.planned += p.planned_amount;
    c.actual += p.actual_amount;
    by.set(p.customer_id, c);
  }
  return [...by.values()].sort((a, b) => b.planned - a.planned);
}

export async function getPromoEnums(): Promise<PromoEnums> {
  return promoEnumsJson as PromoEnums;
}

export async function getPromoMeta(): Promise<PromoMeta> {
  const file = path.join(process.cwd(), "data", "promos", "meta.json");
  return JSON.parse(readFileSync(file, "utf-8")) as PromoMeta;
}
