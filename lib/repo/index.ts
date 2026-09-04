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
import itemXwalkJson from "@/lib/fixtures/item-crosswalk.json";
import priceListJson from "@/lib/fixtures/price-list.json";

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

/* ---------------------------------------------------------- ITEM CROSSWALK */

export type NiqItemAttrs = {
  upc_core: string; item: string; brand: string;
  category: string; sub_category: string; segment: string;
  hrt_type: string; hrt_form: string; hrt_package: string;
  base_size: string; pack_size: string; flavor: string;
};

type ItemXwalkFile = {
  telus_items: { item_number: string; upc_core: string; brand: string; business_unit: string; description: string }[];
  niq_items: NiqItemAttrs[];
};

const upcCore = (upc: string) => upc.replace(/\D/g, "").replace(/^0+/, "");

let itemXwalkCache: { telusUpcs: Record<string, string[]>; attrs: Record<string, NiqItemAttrs> } | null = null;

/** The item crosswalk, resolved to the NIQ items on file: Telus item number →
    loaded UPCs (for scoring promo lines against NIQ volume), and the NIQ/HRT
    attribute hierarchy per loaded item (for combining by brand or segment). */
export async function getItemCrosswalk(): Promise<{
  telusUpcs: Record<string, string[]>;
  attrs: Record<string, NiqItemAttrs>;
}> {
  if (!itemXwalkCache) {
    const fx = itemXwalkJson as ItemXwalkFile;
    const coreToUpc = new Map(ITEMS.map((i) => [upcCore(i.upc), i.upc]));
    const telusUpcs: Record<string, string[]> = {};
    for (const t of fx.telus_items) {
      const upc = coreToUpc.get(t.upc_core);
      if (!upc) continue; // Telus item exists but that UPC isn't in the NIQ pull
      (telusUpcs[t.item_number] ??= []).push(upc);
    }
    const attrs: Record<string, NiqItemAttrs> = {};
    for (const n of fx.niq_items) {
      const upc = coreToUpc.get(n.upc_core);
      if (upc) attrs[upc] = n;
    }
    itemXwalkCache = { telusUpcs, attrs };
  }
  return itemXwalkCache;
}

/** One row per identifier tie for the Tie List view — every Telus item number
    ↔ NIQ UPC pair, NIQ items still missing a Heartland #, and Telus SKUs seen
    on promotion lines that the crosswalk doesn't know yet, each carrying the
    FY promo dollars riding on it. */
export type TieRow = {
  item_number: string | null;   // Telus/Heartland SKU; null = NIQ item with no mapping
  upc_core: string | null;      // normalized NIQ UPC; null = unmapped Telus SKU
  upc: string | null;           // the NIQ pull's upc when the item is on file
  description: string;
  brand: string;
  business_unit: string | null;
  segment: string | null;
  niq_item: string | null;      // NIQ Static description
  status: "tied" | "static_only" | "no_niq" | "no_item_number" | "unmapped_sku";
  line_planned: number;         // FY planned $ on promo lines with this item number
  line_count: number;
};

export async function getTieList(): Promise<TieRow[]> {
  const fx = itemXwalkJson as ItemXwalkFile;
  const coreToUpc = new Map(ITEMS.map((i) => [upcCore(i.upc), i.upc]));
  const staticByCore = new Map(fx.niq_items.map((n) => [n.upc_core, n]));

  // FY promo dollars per Telus item number
  const lineAgg = new Map<string, { planned: number; n: number; desc: string; brand: string }>();
  for (const l of promoLines()) {
    const a = lineAgg.get(l.item_number) ?? { planned: 0, n: 0, desc: l.item_description ?? "", brand: l.brand };
    a.planned += l.planned_amount; a.n += 1;
    lineAgg.set(l.item_number, a);
  }

  const rows: TieRow[] = [];
  const mappedCores = new Set<string>();
  const mappedItemNumbers = new Set<string>();
  for (const t of fx.telus_items) {
    mappedCores.add(t.upc_core);
    mappedItemNumbers.add(t.item_number);
    const st = staticByCore.get(t.upc_core);
    const upc = coreToUpc.get(t.upc_core) ?? null;
    const lines = lineAgg.get(t.item_number);
    rows.push({
      item_number: t.item_number,
      upc_core: t.upc_core,
      upc,
      description: t.description,
      brand: t.brand,
      business_unit: t.business_unit,
      segment: st?.segment ?? null,
      niq_item: st?.item ?? null,
      status: !st ? "no_niq" : upc ? "tied" : "static_only",
      line_planned: Math.round(lines?.planned ?? 0),
      line_count: lines?.n ?? 0,
    });
  }
  for (const n of fx.niq_items) {
    if (mappedCores.has(n.upc_core)) continue;
    rows.push({
      item_number: null,
      upc_core: n.upc_core,
      upc: coreToUpc.get(n.upc_core) ?? null,
      description: n.item,
      brand: n.brand,
      business_unit: null,
      segment: n.segment,
      niq_item: n.item,
      status: "no_item_number",
      line_planned: 0,
      line_count: 0,
    });
  }
  for (const [item_number, a] of lineAgg) {
    if (mappedItemNumbers.has(item_number)) continue;
    rows.push({
      item_number,
      upc_core: null,
      upc: null,
      description: a.desc,
      brand: a.brand,
      business_unit: null,
      segment: null,
      niq_item: null,
      status: "unmapped_sku",
      line_planned: Math.round(a.planned),
      line_count: a.n,
    });
  }
  return rows.sort((a, b) => b.line_planned - a.line_planned);
}

/* ------------------------------------------------------------- PRICE LIST */

/** One dated price record — the price in force on a date is the record with
    the greatest effective_from ≤ that date for the item. */
export type PriceRow = {
  fg: string;
  upc_core: string;            // "" when the item has no UPC yet (TBD)
  upc: string | null;          // the NIQ pull's upc when the item is on file
  item: string;
  brand: string;
  category: string;
  form: string;
  segment: string;
  units_per_case: number | null;
  case_price: number | null;
  unit_price: number | null;
  effective_from: string;      // ISO date
  source: string;
};

let priceListCache: PriceRow[] | null = null;

/** All dated price records, sorted fg → effective_from, resolved to the NIQ
    pull's UPCs where the item is on file. */
export async function getPriceList(): Promise<PriceRow[]> {
  if (!priceListCache) {
    const coreToUpc = new Map(ITEMS.map((i) => [upcCore(i.upc), i.upc]));
    const raw = (priceListJson as { rows: Omit<PriceRow, "upc">[] }).rows;
    priceListCache = raw.map((r) => ({ ...r, upc: r.upc_core ? coreToUpc.get(r.upc_core) ?? null : null }));
  }
  return priceListCache;
}

/** The price record in force for an fg (or a upc) on a date. */
export function priceAsOf(rows: PriceRow[], onDate: string, key: { fg?: string; upc?: string }): PriceRow | null {
  let best: PriceRow | null = null;
  for (const r of rows) {
    if (key.fg ? r.fg !== key.fg : r.upc !== key.upc) continue;
    if (r.effective_from > onDate) continue;
    if (!best || r.effective_from > best.effective_from) best = r;
  }
  return best;
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

/* ------------------------------------------------------- PROMO ↔ NIELSEN JOIN
   Overlay the Telus promotion windows onto a division's Nielsen weekly trend.
   The division ←→ customer mapping lives in lib/data/albertsonsPromoMap.ts
   (mirrored by supabase/migrations/00003). */

import { ALBERTSONS_CORPORATE, normBrand, promoCustomersFor } from "@/lib/data/albertsonsPromoMap";

export type PromoOverlay = {
  promo_id: string;
  promo_title: string;
  promo_status: Promotion["promo_status"];
  performance_type: string;
  customer_name: string;
  corporate: boolean;        // from the all-divisions corporate account
  start_date: string;
  end_date: string;
  planned_amount: number;
  actual_amount: number;
  brands: string[];          // Telus line brands on the promo
};

let promoBrandsCache: Map<string, Set<string>> | null = null;
/** promo_id → normalized brand set, derived from the component lines. */
function promoBrands(): Map<string, Set<string>> {
  if (!promoBrandsCache) {
    promoBrandsCache = new Map();
    for (const l of promoLines()) {
      let s = promoBrandsCache.get(l.promo_id);
      if (!s) promoBrandsCache.set(l.promo_id, (s = new Set()));
      s.add(normBrand(l.brand));
    }
  }
  return promoBrandsCache;
}

export type PromoOverlayFilter = {
  market_code: string;
  /** NIQ brand name (e.g. "SPLENDA"); omit for all brands. */
  brand?: string;
  /** ISO dates, inclusive — keep promos whose window overlaps [from, to]. */
  from?: string;
  to?: string;
};

export async function getPromoOverlays(f: PromoOverlayFilter): Promise<PromoOverlay[]> {
  const customers = new Set(promoCustomersFor(f.market_code));
  if (customers.size === 0) return [];
  const wantBrand = f.brand ? normBrand(f.brand) : null;
  const brands = promoBrands();
  return promos()
    .filter((p) => {
      if (!customers.has(p.customer_id)) return false;
      if (f.to && p.start_date > f.to) return false;
      if (f.from && p.end_date < f.from) return false;
      if (wantBrand && !(brands.get(p.promo_id)?.has(wantBrand) ?? false)) return false;
      return true;
    })
    .map((p) => ({
      promo_id: p.promo_id,
      promo_title: p.promo_title,
      promo_status: p.promo_status,
      performance_type: p.performance_type,
      customer_name: p.customer_name,
      corporate: p.customer_id === ALBERTSONS_CORPORATE,
      start_date: p.start_date,
      end_date: p.end_date,
      planned_amount: p.planned_amount,
      actual_amount: p.actual_amount,
      brands: [...(brands.get(p.promo_id) ?? [])],
    }))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}
