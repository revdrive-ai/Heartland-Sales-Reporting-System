import { dataSource, sbRows, sbRpc } from "@/lib/server/supaRead";
import type { FiscalPeriod } from "@/lib/types/db";

/* The Fabric-fed tables in the Supabase project — SERVER SIDE.

   Fabric (the Heartland data warehouse) loads the proof-of-concept project
   with Syspro's sales and masters: fact_shipments_weekly (invoiced sales by
   customer × item × week-ending Saturday), dim_customer (the hierarchy:
   ship-to → parent account, channel, region), dim_product (brand, category,
   case pack, NIQ UPC tie), dim_list_price, dim_fiscal_period, and
   customer_xref (Telus customer → Syspro codes → NIQ market codes). This
   module is the one place that knows those tables' shapes; the data seam
   (lib/repo) and the sales seam (lib/server/salesFacts) read through it and
   map to the row shapes the pages already speak. Everything here is read
   through supaRead's cache, so a page costs a handful of requests at most
   once every few minutes. */

export type FabricCustomer = {
  customer_code: string; customer_name: string;
  parent_code: string | null; parent_name: string | null;
  channel: string | null; region: string | null; sr_director_name: string | null;
  is_excluded: boolean | null;
};

export type FabricProduct = {
  stock_code: string; description: string | null; brand: string | null; category: string | null;
  subcategory: string | null; business_group: string | null; product_class_desc: string | null;
  units_per_case: number | null; nielsen_upc: string | null; upc12: string | null; discontinued_status: string | null;
};

/** One customer × item × week of invoiced sales. Dollars are net (gross less
    off-invoice allowances); the quantity is CASES as invoiced. */
export type FabricSale = {
  week_ending: string; customer_code: string; stock_code: string;
  net: number; gross: number; off_invoice: number; cases: number;
};

export type CustomerXref = {
  telus_customer_id: string | null; telus_customer_name: string | null;
  syspro_customer_code: string | null; syspro_codes: string[] | null; niq_market_codes: string[] | null; status: string | null;
};

export type ListPriceRow = {
  stock_code: string; contract: string | null; case_price: number | null; units_per_case: number | null; unit_price: number | null;
  start_date: string; expiry_date: string | null; is_current: boolean | null;
  description: string | null; brand: string | null; category: string | null; subcategory: string | null;
  product_class_desc: string | null; nielsen_upc: string | null; upc12: string | null;
};

/** Whether the deployment reads Fabric's tables at all (the same switch as
    the rest of the data seam). */
export const fabricOn = () => dataSource() === "supabase";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const day = (v: unknown) => String(v).slice(0, 10);

export const customers = () =>
  sbRows<FabricCustomer>("dim_customer", "select=customer_code,customer_name,parent_code,parent_name,channel,region,sr_director_name,is_excluded&order=customer_code.asc");

export const products = () =>
  sbRows<Record<string, unknown>>("v_sales_products", "select=*&order=stock_code.asc").then((rows) =>
    rows.map((r): FabricProduct => ({
      stock_code: String(r.stock_code), description: (r.description as string | null) ?? null, brand: (r.brand as string | null) ?? null,
      category: (r.category as string | null) ?? null, subcategory: (r.subcategory as string | null) ?? null,
      business_group: (r.business_group as string | null) ?? null, product_class_desc: (r.product_class_desc as string | null) ?? null,
      units_per_case: numOrNull(r.units_per_case), nielsen_upc: (r.nielsen_upc as string | null) ?? null,
      upc12: (r.upc12 as string | null) ?? null, discontinued_status: (r.discontinued_status as string | null) ?? null,
    }))
  );

export const fiscalPeriods = () =>
  sbRows<Record<string, unknown>>("dim_fiscal_period", "select=fiscal_year,period,start_date,end_date&order=fiscal_year.asc,period.asc").then((rows) =>
    rows.map((r): FiscalPeriod => ({ fiscal_year: Number(r.fiscal_year), period: Number(r.period), start_date: day(r.start_date), end_date: day(r.end_date) }))
  );

export const customerXref = () =>
  sbRows<CustomerXref>("customer_xref", "select=telus_customer_id,telus_customer_name,syspro_customer_code,syspro_codes,niq_market_codes,status&order=id.asc");

export const listPrices = () =>
  sbRows<Record<string, unknown>>("v_list_price", "select=*&order=stock_code.asc,start_date.asc").then((rows) =>
    rows.map((r): ListPriceRow => ({
      stock_code: String(r.stock_code), contract: (r.contract as string | null) ?? null,
      case_price: numOrNull(r.case_price), units_per_case: numOrNull(r.units_per_case), unit_price: numOrNull(r.unit_price),
      start_date: day(r.start_date), expiry_date: r.expiry_date ? day(r.expiry_date) : null, is_current: (r.is_current as boolean | null) ?? null,
      description: (r.description as string | null) ?? null, brand: (r.brand as string | null) ?? null, category: (r.category as string | null) ?? null,
      subcategory: (r.subcategory as string | null) ?? null, product_class_desc: (r.product_class_desc as string | null) ?? null,
      nielsen_upc: (r.nielsen_upc as string | null) ?? null, upc12: (r.upc12 as string | null) ?? null,
    }))
  );

/** Invoiced sales between two dates (inclusive), optionally for a set of
    customer codes. Read a calendar year per request through the
    rpt_sales_weekly function, so each year is cached on its own. */
export async function sales(from: string, to: string, customerCodes?: string[]): Promise<FabricSale[]> {
  const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
  const codes = customerCodes ? [...customerCodes].sort() : null;
  const years: Promise<FabricSale[]>[] = [];
  for (let y = y0; y <= y1; y++) {
    const a = y === y0 ? from : `${y}-01-01`, b = y === y1 ? to : `${y}-12-31`;
    years.push(
      sbRpc<unknown[][]>("rpt_sales_weekly", { p_from: a, p_to: b, p_customers: codes }).then((rows) =>
        rows.map((r) => ({ week_ending: day(r[0]), customer_code: String(r[1]), stock_code: String(r[2]), net: num(r[3]), gross: num(r[4]), off_invoice: num(r[5]), cases: num(r[6]) }))
      )
    );
  }
  return (await Promise.all(years)).flat();
}

/* ------------------------------------------------------------------- TIES */

/** The digits that identify a UPC across systems: the NIQ pull's 12-digit
    upc ("081331401817"), dim_product's 11-digit nielsen_upc ("81331401817")
    and the crosswalk's upc_core all reduce to the same key. */
export const upcKey = (upc: string | null | undefined) => (upc ? upc.replace(/\D/g, "").replace(/^0+/, "") : "");

/** A product's UPC key: the NIQ UPC Fabric carries, else the UPC-12 less its
    check digit, else "". */
export function productUpcKey(p: { nielsen_upc: string | null; upc12: string | null }): string {
  if (p.nielsen_upc) return upcKey(p.nielsen_upc);
  const d = (p.upc12 ?? "").replace(/\D/g, "");
  return d.length === 12 ? upcKey(d.slice(0, 11)) : "";
}

/** Syspro customer codes behind a set of NIQ market codes, through
    customer_xref. A code that is the PARENT of another candidate (Safeway,
    Inc. stands behind every division) is dropped, so a division reads its
    own ship-to and not the whole banner. */
export async function customerCodesForMarkets(marketCodes: string[]): Promise<string[]> {
  if (!marketCodes.length) return [];
  const [xref, cust] = await Promise.all([customerXref(), customers()]);
  const want = new Set(marketCodes);
  const codes = new Set<string>();
  for (const x of xref) {
    if (!x.niq_market_codes?.some((m) => want.has(m))) continue;
    for (const c of x.syspro_codes ?? []) codes.add(c);
    if (x.syspro_customer_code) codes.add(x.syspro_customer_code);
  }
  const parentOf = new Map(cust.map((c) => [c.customer_code, c.parent_code]));
  const parents = new Set([...codes].map((c) => parentOf.get(c)).filter((p): p is string => !!p));
  return [...codes].filter((c) => !parents.has(c) || ![...codes].some((o) => o !== c && parentOf.get(o) === c));
}

/** Syspro customer codes behind an app account code: a NIQ market code
    through the crosswalk, else the ship-tos of the parent account whose
    name starts with the code (PUBLIX → Publix). */
export async function customerCodesForAccount(account_code: string): Promise<string[]> {
  const viaMarket = await customerCodesForMarkets([account_code]);
  if (viaMarket.length) return viaMarket;
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = norm(account_code);
  if (!key) return [];
  const cust = await customers();
  const parents = new Set(cust.filter((c) => norm(c.parent_name ?? c.customer_name).startsWith(key)).map((c) => c.parent_code ?? c.customer_code));
  return cust.filter((c) => parents.has(c.parent_code ?? c.customer_code) && !c.is_excluded).map((c) => c.customer_code);
}

/* ----------------------------------------------------------------- STATUS */

export type FabricStatus = {
  loaded_at: string | null;   // when Fabric last finished a load
  tables: number;             // tables in the last load
  failed: number;             // of which not ok
  sales_edge: string | null;  // latest week-ending with invoiced sales
};

/** What the Fabric feed last did, from etl_load_log, and how far the sales
    run — for the Integrations screen and /api/health. */
export async function fabricStatus(): Promise<FabricStatus> {
  const [log, edge] = await Promise.all([
    sbRows<{ table_name: string; finished_at: string | null; status: string | null }>("etl_load_log", "select=table_name,finished_at,status&order=id.desc"),
    sbRows<{ week_ending: string }>("fact_shipments_weekly", "select=week_ending&order=week_ending.desc&limit=1"),
  ]);
  const latest = new Map<string, { finished_at: string | null; status: string | null }>();
  for (const r of log) if (!latest.has(r.table_name)) latest.set(r.table_name, r);
  const finished = [...latest.values()].map((r) => r.finished_at).filter((t): t is string => !!t).sort();
  return {
    loaded_at: finished[finished.length - 1] ?? null,
    tables: latest.size,
    failed: [...latest.values()].filter((r) => r.status !== "ok").length,
    sales_edge: edge[0] ? day(edge[0].week_ending) : null,
  };
}
