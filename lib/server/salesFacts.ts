import { getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
import * as fabric from "@/lib/server/fabric";
import type { FiscalPeriod } from "@/lib/types/db";
import { DAY, iso, utcOf } from "@/lib/weeks";

/* The sales facts the Leadership team report reads — ONE seam.

   First choice: INTERNAL SALES — Syspro's invoiced sales by way of Fabric
   (fact_shipments_weekly with dim_customer and dim_product), per ship-to ×
   item × week-ending Saturday, rolled to the parent account. Dollars are net
   of off-invoice allowances; the quantity is cases as invoiced. The read
   covers the last three calendar years so every period and its year-ago
   partner is on hand, and is cached a few minutes for every user.

   Fallback: the NIQ retail read (consumer dollars and units at the register)
   for Heartland's own items by Albertsons division — what the report showed
   before the Fabric link, and what a deployment without Supabase still shows.
   Everything above this seam speaks in SalesFact rows and never knows which
   source answered; the source block says so on the page. */

export type SalesFact = {
  week_ending: string;
  customer: string;       // account key — the Syspro parent account (internal) or the NIQ market code (retail)
  customerName: string;
  channel: string;        // Retail, Club, Foodservice, E-commerce … ("Retail" for every NIQ division)
  item: string;           // item key — the Syspro stock code (internal) or the NIQ UPC (retail)
  itemName: string;
  brand: string;
  dollars: number;        // net sales (internal) / retail dollars (NIQ)
  gross: number;          // gross before off-invoice (internal); equals dollars for NIQ
  offInvoice: number;     // off-invoice allowances (internal); 0 for NIQ
  qty: number;            // cases (internal) / units (NIQ)
};

export type SalesSource = {
  name: string;           // "Internal sales (Fabric)" | "NIQ retail sales"
  note: string;           // what the numbers are, in a sentence
  edge: string;           // latest week on file
  weeks: string[];        // every week on file, oldest first
  money: string;          // "Net sales" | "Retail sales"
  qty: "Cases" | "Units";
  partialWeek: boolean;   // the edge week is still being invoiced
  fiscal: FiscalPeriod[]; // the close calendar, when the source carries one
};

export type SalesRead = { rows: SalesFact[]; source: SalesSource; customers: { code: string; name: string }[] };

/** Sales facts for the NIQ market codes given (every customer on file when
    omitted). Internal sales when the deployment reads Fabric's tables, else
    the retail read; a failed internal read falls back to retail and logs. */
export async function getSalesFacts(marketCodes?: string[]): Promise<SalesRead> {
  if (fabric.fabricOn()) {
    try {
      return await fromFabric(marketCodes);
    } catch (e) {
      console.error(`[sales] internal sales read failed, answering from the NIQ retail read — ${e instanceof Error ? e.message : e}`);
    }
  }
  return fromNiq(marketCodes);
}

/* ------------------------------------------------------- INTERNAL SALES */

const today = () => new Date().toISOString().slice(0, 10);

/** Every Saturday from the first to the last week on file, so a quiet week
    still has its place in the period arithmetic. */
function saturdaysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let t = utcOf(a); t <= utcOf(b); t += 7 * DAY) out.push(iso(t));
  return out;
}

async function fromFabric(marketCodes?: string[]): Promise<SalesRead> {
  const y = +today().slice(0, 4);
  const [sales, cust, prod, fiscal, scopeCodes] = await Promise.all([
    fabric.sales(`${y - 2}-01-01`, `${y}-12-31`),
    fabric.customers(),
    fabric.products(),
    fabric.fiscalPeriods(),
    marketCodes ? fabric.customerCodesForMarkets(marketCodes) : Promise.resolve(null),
  ]);
  const inScope = scopeCodes ? new Set(scopeCodes) : null;
  // the whole company rolls to parent accounts; a scope (one division, one
  // banner) is read at the ship-to it names, so Jewel shows as Jewel
  const atShipTo = inScope !== null;
  const custBy = new Map(cust.map((c) => [c.customer_code, c]));
  const prodBy = new Map(prod.map((p) => [p.stock_code, p]));
  const rows: SalesFact[] = [];
  let first = "", edge = "";
  for (const s of sales) {
    if (s.week_ending > edge) edge = s.week_ending;
    if (!first || s.week_ending < first) first = s.week_ending;
    if (inScope && !inScope.has(s.customer_code)) continue;
    if (!s.net && !s.cases) continue;
    const c = custBy.get(s.customer_code), p = prodBy.get(s.stock_code);
    rows.push({
      week_ending: s.week_ending,
      customer: atShipTo ? s.customer_code : c?.parent_code || s.customer_code,
      customerName: atShipTo ? c?.customer_name || s.customer_code : c?.parent_name || c?.customer_name || s.customer_code,
      channel: c?.channel || "Other",
      item: s.stock_code,
      itemName: p?.description || s.stock_code,
      brand: p?.brand || "Other",
      dollars: s.net, gross: s.gross, offInvoice: s.off_invoice, qty: s.cases,
    });
  }
  if (!edge) throw new Error("no invoiced sales on file");
  const customers = new Map<string, string>();
  for (const r of rows) if (!customers.has(r.customer)) customers.set(r.customer, r.customerName);
  const t = today();
  return {
    rows,
    source: {
      name: "Internal sales (Fabric)",
      note: "Invoiced sales from Syspro by way of Fabric: net dollars after off-invoice allowances and cases as invoiced, by customer and item, every week-ending Saturday through the latest week loaded.",
      edge,
      weeks: saturdaysBetween(first, edge),
      money: "Net sales",
      qty: "Cases",
      partialWeek: edge > t,
      fiscal,
    },
    customers: [...customers.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ----------------------------------------------------------- NIQ RETAIL */

const niqCache = new Map<string, Promise<SalesFact[]>>();

async function niqFor(code: string, name: string, meta: Map<string, { item: string; brand: string }>): Promise<SalesFact[]> {
  const rows = await getWeeklyFacts({ market_code: code, ownOnly: true });
  const out: SalesFact[] = [];
  for (const r of rows) {
    const m = meta.get(r.upc);
    if (!m) continue;
    const dollars = r.dollars ?? 0, units = r.units ?? 0;
    if (!dollars && !units) continue;
    out.push({ week_ending: r.week_ending, customer: code, customerName: name, channel: "Retail", item: r.upc, itemName: m.item, brand: m.brand, dollars, gross: dollars, offInvoice: 0, qty: units });
  }
  return out;
}

async function fromNiq(marketCodes?: string[]): Promise<SalesRead> {
  const [markets, items] = await Promise.all([listMarkets(), listItems({ ownOnly: true })]);
  const wanted = marketCodes ? markets.filter((m) => marketCodes.includes(m.code)) : markets;
  const meta = new Map(items.map((i) => [i.upc, { item: i.name, brand: i.brand }]));
  const weeks = await listWeekEndings((wanted[0] ?? markets[0]).code);
  const parts = await Promise.all(wanted.map((m) => {
    let p = niqCache.get(m.code);
    if (!p) { p = niqFor(m.code, m.name, meta); niqCache.set(m.code, p); }
    return p;
  }));
  return {
    rows: parts.flat(),
    source: {
      name: "NIQ retail sales",
      note: "Consumer sales at the register for Heartland items, by Albertsons division — the retail read, shown when internal sales are not on hand.",
      edge: weeks[weeks.length - 1],
      weeks,
      money: "Retail sales",
      qty: "Units",
      partialWeek: false,
      fiscal: [],
    },
    customers: wanted.map((m) => ({ code: m.code, name: m.name })),
  };
}
