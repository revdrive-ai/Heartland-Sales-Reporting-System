// The data seam — SERVER SIDE. Views never touch data files or a database
// client directly; server components (and route handlers) call these
// functions and pass results down as props.
//
// Two sources stand behind every function, chosen once per deployment by
// lib/server/supaRead's dataSource():
//   · Supabase — the tables supabase/setup.sql declares, read with the
//     service role, when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
//   · the repo fixtures — data/nielsen/*.json.gz, data/promos/, data/shipments/
//     and lib/fixtures/*.json — otherwise, or when HH_DATA_SOURCE=fixtures
// A Supabase read that fails falls back to the fixture for that dataset and
// says so in the server log, so a half-loaded database never blanks a page.
// Row shapes are identical either way (lib/types/db.ts), so nothing outside
// lib/repo/ knows which source answered.
//
// This module reads the filesystem and holds the service key, so it must
// only be imported from server code — a client-component import fails the
// build by design. Client-side stores live in lib/repo/client.ts.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { Market, Item, NielsenWeeklyRow, ShipmentWeeklyRow } from "@/lib/types/db";
import { dataSource, sbRows } from "@/lib/server/supaRead";
import * as fabric from "@/lib/server/fabric";
import marketsJson from "@/lib/fixtures/markets.json";
import itemsJson from "@/lib/fixtures/items.json";
import itemXwalkJson from "@/lib/fixtures/item-crosswalk.json";
import priceListJson from "@/lib/fixtures/price-list.json";

const MARKETS = marketsJson as Market[];
const ITEMS = itemsJson as Item[];

/** Run the Supabase read when that is the source, else the fixture; a
    failed Supabase read logs and answers from the fixture. */
async function viaDb<T>(label: string, db: () => Promise<T>, file: () => T | Promise<T>): Promise<T> {
  if (dataSource() !== "supabase") return file();
  try {
    return await db();
  } catch (e) {
    console.error(`[repo] ${label}: Supabase read failed, answering from the fixture — ${e instanceof Error ? e.message : e}`);
    return file();
  }
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/* ------------------------------------------------------------------ MARKETS */

const markets = () =>
  viaDb("markets", () => sbRows<Market>("markets", "select=code,name,ta_name,active&order=code.asc"), () => MARKETS);

export async function listMarkets(opts?: { activeOnly?: boolean }): Promise<Market[]> {
  const all = await markets();
  return opts?.activeOnly ? all.filter((m) => m.active) : all;
}

export async function getMarket(code: string): Promise<Market | undefined> {
  return (await markets()).find((m) => m.code === code);
}

/* -------------------------------------------------------------------- ITEMS */

const items = () =>
  viaDb(
    "items",
    () => sbRows<Item>("items", "select=upc,name,brand,manufacturer,super_category,category,sub_category,is_own&order=upc.asc"),
    () => ITEMS
  );

export async function listItems(opts?: { brand?: string; ownOnly?: boolean }): Promise<Item[]> {
  return (await items()).filter(
    (i) => (!opts?.brand || i.brand === opts.brand) && (!opts?.ownOnly || i.is_own)
  );
}

export async function getItem(upc: string): Promise<Item | undefined> {
  return (await items()).find((i) => i.upc === upc);
}

export async function listBrands(opts?: { ownOnly?: boolean }): Promise<string[]> {
  const all = await items();
  const src = opts?.ownOnly ? all.filter((i) => i.is_own) : all;
  return [...new Set(src.map((i) => i.brand))].sort();
}

/* ---------------------------------------------------------- ITEM CROSSWALK */

export type NiqItemAttrs = {
  upc_core: string; item: string; brand: string;
  category: string; sub_category: string; segment: string;
  hrt_type: string; hrt_form: string; hrt_package: string;
  base_size: string; pack_size: string; flavor: string;
};

type TelusItem = { item_number: string; upc_core: string; brand: string; business_unit: string; description: string };
type ItemXwalkFile = { telus_items: TelusItem[]; niq_items: NiqItemAttrs[] };

const upcCore = (upc: string) => upc.replace(/\D/g, "").replace(/^0+/, "");

/** The item crosswalk as the fixture shapes it, from either source. */
const xwalk = () =>
  viaDb<ItemXwalkFile>(
    "item crosswalk",
    async () => {
      const [telus, niq] = await Promise.all([
        sbRows<Record<string, unknown>>("item_crosswalk", "select=item_number,upc_core,brand,business_unit,description&order=item_number.asc,upc_core.asc"),
        sbRows<Record<string, unknown>>("niq_item_attributes", "select=*&order=upc_core.asc"),
      ]);
      return {
        telus_items: telus.map((t) => ({
          item_number: str(t.item_number), upc_core: str(t.upc_core), brand: str(t.brand),
          business_unit: str(t.business_unit), description: str(t.description),
        })),
        niq_items: niq.map((n) => ({
          upc_core: str(n.upc_core), item: str(n.item), brand: str(n.brand),
          category: str(n.category), sub_category: str(n.sub_category), segment: str(n.segment),
          hrt_type: str(n.hrt_type), hrt_form: str(n.hrt_form), hrt_package: str(n.hrt_package),
          base_size: str(n.base_size), pack_size: str(n.pack_size), flavor: str(n.flavor),
        })),
      };
    },
    () => itemXwalkJson as ItemXwalkFile
  );

/** The item crosswalk, resolved to the NIQ items on file: Telus item number →
    loaded UPCs (for scoring promo lines against NIQ volume), and the NIQ/HRT
    attribute hierarchy per loaded item (for combining by brand or segment). */
export async function getItemCrosswalk(): Promise<{
  telusUpcs: Record<string, string[]>;
  attrs: Record<string, NiqItemAttrs>;
}> {
  const [fx, all, lines] = await Promise.all([xwalk(), items(), promoLines()]);
  const coreToUpc = new Map(all.map((i) => [upcCore(i.upc), i.upc]));
  const telusUpcs: Record<string, string[]> = {};
  for (const t of fx.telus_items) {
    const upc = coreToUpc.get(t.upc_core);
    if (!upc) continue; // Telus item exists but that UPC isn't in the NIQ pull
    (telusUpcs[t.item_number] ??= []).push(upc);
  }
  /* Telus writes some item numbers with a prefix the crosswalk workbook
     leaves off — the Equal packets are "FGMA20015446" on a deal line and
     "20015446" in the crosswalk — so a line that finds no row under its
     own number is tied by its digits, where those digits name exactly one
     crosswalk item. The alias is added under the Telus spelling, so every
     lookup by line item number just works. */
  const byDigits = new Map<string, string[]>();
  for (const n of Object.keys(telusUpcs)) {
    const d = n.replace(/\D/g, "");
    if (d) (byDigits.get(d) ?? byDigits.set(d, []).get(d)!).push(n);
  }
  for (const l of lines) {
    if (l.item_number in telusUpcs) continue;
    const hits = byDigits.get(l.item_number.replace(/\D/g, "")) ?? [];
    if (hits.length === 1) telusUpcs[l.item_number] = telusUpcs[hits[0]];
  }
  const attrs: Record<string, NiqItemAttrs> = {};
  for (const n of fx.niq_items) {
    const upc = coreToUpc.get(n.upc_core);
    if (upc) attrs[upc] = n;
  }
  return { telusUpcs, attrs };
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
  const [fx, all, lines] = await Promise.all([xwalk(), items(), promoLines()]);
  const coreToUpc = new Map(all.map((i) => [upcCore(i.upc), i.upc]));
  const staticByCore = new Map(fx.niq_items.map((n) => [n.upc_core, n]));

  // FY promo dollars per Telus item number — a line whose number the
  // crosswalk spells without its prefix (FGMA20015446 → 20015446) lands on
  // that row, as getItemCrosswalk ties it
  const known = new Set(fx.telus_items.map((t) => t.item_number));
  const byDigits = new Map<string, string[]>();
  for (const n of known) {
    const d = n.replace(/\D/g, "");
    if (d) (byDigits.get(d) ?? byDigits.set(d, []).get(d)!).push(n);
  }
  const canon = (n: string) => {
    if (known.has(n)) return n;
    const hits = byDigits.get(n.replace(/\D/g, "")) ?? [];
    return hits.length === 1 ? hits[0] : n;
  };
  const lineAgg = new Map<string, { planned: number; n: number; desc: string; brand: string }>();
  for (const l of lines) {
    const key = canon(l.item_number);
    const a = lineAgg.get(key) ?? { planned: 0, n: 0, desc: l.item_description ?? "", brand: l.brand };
    a.planned += l.planned_amount; a.n += 1;
    lineAgg.set(key, a);
  }

  const rows: TieRow[] = [];
  const mappedCores = new Set<string>();
  const mappedItemNumbers = new Set<string>();
  for (const t of fx.telus_items) {
    mappedCores.add(t.upc_core);
    mappedItemNumbers.add(t.item_number);
    const st = staticByCore.get(t.upc_core);
    const upc = coreToUpc.get(t.upc_core) ?? null;
    const ln = lineAgg.get(t.item_number);
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
      line_planned: Math.round(ln?.planned ?? 0),
      line_count: ln?.n ?? 0,
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

type PriceRowRaw = Omit<PriceRow, "upc">;

/** The app's own price_list table — the workbook prices the ingest loaded. */
const appPriceRows = async (): Promise<PriceRowRaw[]> =>
  (await sbRows<Record<string, unknown>>(
    "price_list",
    "select=fg,effective_from,upc_core,item,brand,category,form,segment,units_per_case,case_price,unit_price,source&order=fg.asc,effective_from.asc"
  )).map((r) => ({
    fg: str(r.fg), upc_core: str(r.upc_core), item: str(r.item), brand: str(r.brand),
    category: str(r.category), form: str(r.form), segment: str(r.segment),
    units_per_case: num(r.units_per_case), case_price: num(r.case_price), unit_price: num(r.unit_price),
    effective_from: str(r.effective_from).slice(0, 10), source: str(r.source),
  }));

/** Syspro's list price from Fabric (dim_list_price, the LIST contract, dated
    by start_date) leads; the workbook price list fills in only the items
    Fabric does not price — by stock code or by UPC — so an item never
    carries two sources' prices at once. */
const priceRows = () =>
  viaDb<PriceRowRaw[]>(
    "price list",
    async () => {
      const [lp, app] = await Promise.all([
        fabric.listPrices().catch((e) => {
          console.error(`[repo] list price: Fabric read failed, workbook prices only — ${e instanceof Error ? e.message : e}`);
          return [] as fabric.ListPriceRow[];
        }),
        appPriceRows(),
      ]);
      const fromFabric: PriceRowRaw[] = lp
        .filter((r) => r.start_date && (r.case_price !== null || r.unit_price !== null))
        .map((r) => ({
          fg: r.stock_code, upc_core: fabric.productUpcKey(r), item: r.description ?? r.stock_code, brand: r.brand ?? "",
          category: r.category ?? "", form: r.subcategory ?? "", segment: r.product_class_desc ?? "",
          units_per_case: r.units_per_case, case_price: r.case_price, unit_price: r.unit_price,
          effective_from: r.start_date, source: `Fabric list price${r.contract ? ` (${r.contract})` : ""}`,
        }));
      const haveFg = new Set(fromFabric.map((r) => r.fg));
      const haveCore = new Set(fromFabric.map((r) => r.upc_core).filter(Boolean));
      const rest = app.filter((r) => !haveFg.has(r.fg) && !(r.upc_core && haveCore.has(r.upc_core)));
      return [...fromFabric, ...rest].sort((a, b) => a.fg.localeCompare(b.fg) || a.effective_from.localeCompare(b.effective_from));
    },
    () => (priceListJson as { rows: PriceRowRaw[] }).rows
  );

/** All dated price records, sorted fg → effective_from, resolved to the NIQ
    pull's UPCs where the item is on file. */
export async function getPriceList(): Promise<PriceRow[]> {
  const [raw, all] = await Promise.all([priceRows(), items()]);
  const coreToUpc = new Map(all.map((i) => [upcCore(i.upc), i.upc]));
  return raw.map((r) => ({ ...r, upc: r.upc_core ? coreToUpc.get(r.upc_core) ?? null : null }));
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

/* ------------------------------------------------------------- WEEKLY FACTS */

const factsCache = new Map<string, NielsenWeeklyRow[]>();

function loadFactsFile(market_code: string): NielsenWeeklyRow[] {
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

type FactDbRow = Omit<NielsenWeeklyRow, "market_name" | "brand" | "category">;
const FACT_COLS =
  "week_ending,upc,market_code,units,dollars,base_units,base_dollars,price_per_unit,eq_units,base_price_per_unit," +
  "incr_units,incr_dollars,acv_dist,tdp,acv_any_promo,acv_feature,acv_display,acv_feat_disp,acv_tpr,promo_units,nonpromo_units";

/** A market's weekly facts. From Supabase the measures come bare and the
    market name, brand and category are put on from the masters, so the row
    matches the fixture's shape exactly. */
const facts = (market_code: string) =>
  viaDb<NielsenWeeklyRow[]>(
    `facts ${market_code}`,
    async () => {
      const [rows, all, mk] = await Promise.all([
        sbRows<FactDbRow>("nielsen_weekly", `market_code=eq.${encodeURIComponent(market_code)}&select=${FACT_COLS}&order=week_ending.asc,upc.asc`),
        items(),
        markets(),
      ]);
      const item = new Map(all.map((i) => [i.upc, i]));
      const market_name = mk.find((m) => m.code === market_code)?.name ?? market_code;
      return rows.map((r) => {
        const it = item.get(r.upc);
        return { ...r, week_ending: String(r.week_ending).slice(0, 10), market_name, brand: it?.brand ?? "", category: it?.category ?? "" };
      });
    },
    () => loadFactsFile(market_code)
  );

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
  const [rows, all] = await Promise.all([facts(f.market_code), f.ownOnly ? items() : Promise.resolve(null)]);
  const own = all ? new Set(all.filter((i) => i.is_own).map((i) => i.upc)) : null;
  return rows.filter(
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
  return [...new Set((await facts(market_code)).map((r) => r.week_ending))].sort();
}

/* ---------------------------------------------------------------- SHIPMENTS
   Weekly sell-in per account × item from the Retail Planner export
   (data/shipments/<ACCOUNT>.json.gz, scripts/ingest_shipments.py; table
   shipments_weekly). An account here may have no NIQ market (Publix). */

export type ShipmentsMeta = {
  source_file: string;
  accounts: { account_code: string; account_name: string; workbook_year: number; years: number[]; first_week: string; last_week: string; edge: string | null; items: number; items_with_upc: number; items_without_pack: number; rows: number; overlap_dropped: number }[];
  unmatched_items: { item_code: string; item_name: string }[];
  ambiguous_items: { item_code: string; upcs: string[] }[];
  items_without_pack: { item_code: string; item_name: string }[];
};

const shipCache = new Map<string, ShipmentWeeklyRow[]>();

function loadShipmentsFile(account_code: string): ShipmentWeeklyRow[] {
  let rows = shipCache.get(account_code);
  if (!rows) {
    const file = path.join(process.cwd(), "data", "shipments", `${account_code}.json.gz`);
    try {
      rows = JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as ShipmentWeeklyRow[];
    } catch {
      rows = [];
    }
    shipCache.set(account_code, rows);
  }
  return rows;
}

/** The app's own shipments_weekly table (the Retail Planner workbook rows the
    loader put there); an account it does not hold answers from the fixture. */
async function shipmentsTable(account_code: string): Promise<ShipmentWeeklyRow[]> {
  const rows = await sbRows<Record<string, unknown>>(
    "shipments_weekly",
    `account_code=eq.${encodeURIComponent(account_code)}&select=account_code,account_name,item_code,item_name,upc,brand,week_ending,cases,units_per_case,units,pack_source,source_row,source_file&order=week_ending.asc,item_code.asc`
  );
  if (!rows.length) return loadShipmentsFile(account_code);
  return rows.map((r) => ({
    account_code: str(r.account_code), account_name: str(r.account_name), item_code: str(r.item_code), item_name: str(r.item_name),
    upc: r.upc === null || r.upc === undefined ? null : str(r.upc), brand: str(r.brand), week_ending: str(r.week_ending).slice(0, 10),
    cases: Number(r.cases ?? 0), units_per_case: num(r.units_per_case), units: num(r.units),
    pack_source: (r.pack_source as ShipmentWeeklyRow["pack_source"]) ?? null,
    source_row: (r.source_row as ShipmentWeeklyRow["source_row"]) ?? "actual", source_file: str(r.source_file),
  }));
}

/** Every shipment row for an account, every year on file; [] when none.

    With Fabric's tables on hand the shipments are Syspro's invoiced cases
    (fact_shipments_weekly) for the ship-tos behind the account — a NIQ
    market code through customer_xref (ALB-JEWEL → JWL100), or the parent
    account named like the code (PUBLIX → Publix) — summed per item × week,
    with the case pack and NIQ UPC tie from dim_product. An account no
    Syspro customer stands behind, or a deployment without Supabase, answers
    from the workbook rows (the table, then the fixture). */
export async function getShipments(account_code: string): Promise<ShipmentWeeklyRow[]> {
  return viaDb<ShipmentWeeklyRow[]>(
    `shipments ${account_code}`,
    async () => {
      const codes = await fabric.customerCodesForAccount(account_code);
      if (!codes.length) return shipmentsTable(account_code);
      const y = new Date().getUTCFullYear();
      const [sales, prod, all, mk] = await Promise.all([fabric.sales("2023-01-01", `${y + 1}-12-31`, codes), fabric.products(), items(), markets()]);
      const prodBy = new Map(prod.map((p) => [p.stock_code, p]));
      const upcByKey = new Map(all.map((i) => [upcCore(i.upc), i.upc]));
      const account_name = mk.find((m) => m.code === account_code)?.name ?? account_code;
      const agg = new Map<string, ShipmentWeeklyRow>();
      for (const s of sales) {
        if (!s.cases) continue;
        const k = `${s.stock_code}|${s.week_ending}`;
        let r = agg.get(k);
        if (!r) {
          const p = prodBy.get(s.stock_code);
          const pack = p?.units_per_case && p.units_per_case > 0 ? p.units_per_case : null;
          r = {
            account_code, account_name, item_code: s.stock_code, item_name: p?.description ?? s.stock_code,
            upc: (p ? upcByKey.get(fabric.productUpcKey(p)) : undefined) ?? null, brand: p?.brand ?? "",
            week_ending: s.week_ending, cases: 0, units_per_case: pack, units: pack ? 0 : null,
            pack_source: pack ? "dim_product" : null, source_row: "actual", source_file: "fabric:fact_shipments_weekly",
          };
          agg.set(k, r);
        }
        r.cases += s.cases;
        if (r.units !== null && r.units_per_case) r.units = r.cases * r.units_per_case;
      }
      return [...agg.values()].sort((a, b) => a.week_ending.localeCompare(b.week_ending) || a.item_code.localeCompare(b.item_code));
    },
    () => loadShipmentsFile(account_code)
  );
}

export async function getShipmentsMeta(): Promise<ShipmentsMeta | null> {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "data", "shipments", "meta.json"), "utf-8")) as ShipmentsMeta;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- PROMOTIONS
   Telus promotions snapshot: data/promos/ (scripts/ingest_promos_raw.py) or
   the promotions / promo_lines tables. Rows a later export dropped are
   flagged removed_at_source in the tables and left out here. */

import type { Promotion, PromoLine, PromoEnums, PromoMeta } from "@/lib/types/db";
import promoEnumsJson from "@/lib/fixtures/promo-enums.json";

function loadGz<T>(rel: string): T {
  const file = path.join(process.cwd(), "data", "promos", rel);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as T;
}

let promoFileCache: Promotion[] | null = null;
let lineFileCache: PromoLine[] | null = null;

const promoLines = () =>
  viaDb<PromoLine[]>(
    "promo lines",
    async () =>
      (await sbRows<Record<string, unknown>>(
        "promo_lines",
        "removed_at_source=eq.false&select=line_id,promo_id,component_type,brand,item_number,item_description,rate,rate_uom,planned_amount,actual_amount,dist_name&order=line_id.asc"
      )).map((l) => ({
        line_id: str(l.line_id), promo_id: str(l.promo_id), component_type: str(l.component_type), brand: str(l.brand),
        item_number: str(l.item_number), item_description: l.item_description === null || l.item_description === undefined ? null : str(l.item_description),
        rate: Number(l.rate ?? 0), rate_uom: str(l.rate_uom) as PromoLine["rate_uom"],
        planned_amount: Number(l.planned_amount ?? 0), actual_amount: Number(l.actual_amount ?? 0),
        dist_name: l.dist_name === null || l.dist_name === undefined ? null : str(l.dist_name),
      })),
    () => (lineFileCache ??= loadGz<PromoLine[]>("promo-lines.json.gz"))
  );

/** Promotion headers. The tables keep no rollups — line_count and the
    planned / actual amounts are summed from the lines here, as the ingest
    does for the fixture. */
const promos = () =>
  viaDb<Promotion[]>(
    "promotions",
    async () => {
      const [heads, lines] = await Promise.all([
        sbRows<Record<string, unknown>>(
          "promotions",
          "removed_at_source=eq.false&select=promo_id,promo_title,fiscal_year,promo_status,template_type,performance_type,customer_id,customer_name,customer_code,channel,market,planner_template,start_date,end_date,dist_names&order=promo_id.asc"
        ),
        promoLines(),
      ]);
      const roll = new Map<string, { n: number; planned: number; actual: number; dists: Set<string> }>();
      for (const l of lines) {
        const r = roll.get(l.promo_id) ?? { n: 0, planned: 0, actual: 0, dists: new Set<string>() };
        r.n += 1; r.planned += l.planned_amount; r.actual += l.actual_amount;
        if (l.dist_name) r.dists.add(l.dist_name);
        roll.set(l.promo_id, r);
      }
      return heads.map((p) => {
        const r = roll.get(str(p.promo_id));
        const dists = Array.isArray(p.dist_names) && p.dist_names.length ? (p.dist_names as string[]) : [...(r?.dists ?? [])].sort();
        return {
          promo_id: str(p.promo_id), promo_title: str(p.promo_title), fiscal_year: Number(p.fiscal_year ?? 0),
          promo_status: str(p.promo_status) as Promotion["promo_status"], template_type: str(p.template_type), performance_type: str(p.performance_type),
          customer_id: str(p.customer_id), customer_name: str(p.customer_name),
          customer_code: p.customer_code === null || p.customer_code === undefined ? null : str(p.customer_code),
          channel: str(p.channel) as Promotion["channel"], market: str(p.market) as Promotion["market"], planner_template: str(p.planner_template),
          start_date: str(p.start_date).slice(0, 10), end_date: str(p.end_date).slice(0, 10),
          ...(dists.length ? { dist_names: dists } : {}),
          line_count: r?.n ?? 0, planned_amount: Math.round((r?.planned ?? 0) * 100) / 100, actual_amount: Math.round((r?.actual ?? 0) * 100) / 100,
        };
      });
    },
    () => (promoFileCache ??= loadGz<Promotion[]>("promotions.json.gz"))
  );

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
  let rows = await promos();
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
  return (await promos()).find((p) => p.promo_id === promo_id);
}

export async function getPromoLines(promo_id: string): Promise<PromoLine[]> {
  return (await promoLines()).filter((l) => l.promo_id === promo_id);
}

export async function listAllPromoLines(): Promise<PromoLine[]> {
  return promoLines();
}

/** Distinct customers carrying promotions, with spend rollups, biggest first. */
export async function listPromoCustomers(): Promise<
  { customer_id: string; customer_name: string; channel: string; market: string; promos: number; planned: number; actual: number }[]
> {
  const by = new Map<string, { customer_id: string; customer_name: string; channel: string; market: string; promos: number; planned: number; actual: number }>();
  for (const p of await promos()) {
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

/** The snapshot's provenance (source file, export date) comes from the
    fixture's meta.json; the counts and totals are whatever the live source
    holds, so the Integrations screen reads the database when that is live. */
export async function getPromoMeta(): Promise<PromoMeta> {
  const file = path.join(process.cwd(), "data", "promos", "meta.json");
  const meta = JSON.parse(readFileSync(file, "utf-8")) as PromoMeta;
  if (dataSource() !== "supabase") return meta;
  const [ps, ls] = await Promise.all([promos(), promoLines()]);
  const withLines = new Set(ls.map((l) => l.promo_id));
  return {
    ...meta,
    promotions: ps.length,
    promo_lines: ls.length,
    planned_total: Math.round(ls.reduce((s, l) => s + l.planned_amount, 0) * 100) / 100,
    actual_total: Math.round(ls.reduce((s, l) => s + l.actual_amount, 0) * 100) / 100,
    promos_without_lines: ps.filter((p) => !withLines.has(p.promo_id)).length,
  };
}

/* ------------------------------------------------------- PROMO ↔ NIELSEN JOIN
   Overlay the Telus promotion windows onto a division's Nielsen weekly trend.
   The division ←→ customer mapping lives in lib/data/albertsonsPromoMap.ts
   (mirrored by supabase/migrations/00003). */

import { ALBERTSONS_CORPORATE, MARKET_DIST_SPLIT, normBrand, promoAppliesTo, promoCustomersFor } from "@/lib/data/albertsonsPromoMap";

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

/** promo_id → normalized brand set, derived from the component lines. */
function promoBrandsOf(lines: PromoLine[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of lines) {
    let s = out.get(l.promo_id);
    if (!s) out.set(l.promo_id, (s = new Set()));
    s.add(normBrand(l.brand));
  }
  return out;
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
  const [ps, lines] = await Promise.all([promos(), promoLines()]);
  const brands = promoBrandsOf(lines);
  return ps
    .filter((p) => {
      if (!customers.has(p.customer_id)) return false;
      // Dist Name splits shared planners (Safeway Mountain West → Denver/IMW)
      if (!promoAppliesTo(f.market_code, p)) return false;
      if (f.to && p.start_date > f.to) return false;
      if (f.from && p.end_date < f.from) return false;
      if (wantBrand && !(brands.get(p.promo_id)?.has(wantBrand) ?? false)) return false;
      return true;
    })
    .map((p) => {
      // a promo booked to several dists (Safeway Mountain West → Denver + IMW)
      // shows only this division's share of the money, not the double-counted total
      let planned = p.planned_amount, actual = p.actual_amount;
      const split = MARKET_DIST_SPLIT[f.market_code];
      if (split && p.customer_id === split.customer_id && (p.dist_names?.length ?? 0) > 1) {
        const own = lines.filter((l) => l.promo_id === p.promo_id && l.dist_name === split.dist_name);
        if (own.length) {
          planned = own.reduce((a, l) => a + l.planned_amount, 0);
          actual = own.reduce((a, l) => a + l.actual_amount, 0);
        }
      }
      return {
        promo_id: p.promo_id,
        promo_title: p.promo_title,
        promo_status: p.promo_status,
        performance_type: p.performance_type,
        customer_name: p.customer_name,
        corporate: p.customer_id === ALBERTSONS_CORPORATE,
        start_date: p.start_date,
        end_date: p.end_date,
        planned_amount: planned,
        actual_amount: actual,
        brands: [...(brands.get(p.promo_id) ?? [])],
      };
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}
