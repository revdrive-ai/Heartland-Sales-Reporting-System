import { getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";

/* The sales facts the Leadership team report reads — ONE seam.

   Today: the NIQ retail read (consumer dollars and units at the register)
   for Heartland's own items, per Albertsons division × item × week. It is
   the richest sales-shaped data on file and stands in for internal sales
   until the Fabric link lands. Then this module reads the internal sales
   table (customer × item × week, net dollars and units) and nothing above
   it changes: the report, the export and the selectors all speak in these
   rows. */

export type SalesFact = {
  week_ending: string;
  customer: string;       // account code (today the NIQ market code)
  customerName: string;
  upc: string;
  item: string;
  brand: string;
  dollars: number;
  units: number;
};

export type SalesSource = {
  name: string;           // "NIQ retail sales"
  note: string;           // what the numbers are, in a sentence
  edge: string;           // latest week on file
  weeks: string[];        // every week on file, oldest first
};

const cache = new Map<string, Promise<SalesFact[]>>();

async function factsFor(code: string, name: string, meta: Map<string, { item: string; brand: string }>): Promise<SalesFact[]> {
  const rows = await getWeeklyFacts({ market_code: code, ownOnly: true });
  const out: SalesFact[] = [];
  for (const r of rows) {
    const m = meta.get(r.upc);
    if (!m) continue;
    const dollars = r.dollars ?? 0, units = r.units ?? 0;
    if (!dollars && !units) continue;
    out.push({ week_ending: r.week_ending, customer: code, customerName: name, upc: r.upc, item: m.item, brand: m.brand, dollars, units });
  }
  return out;
}

/** Sales facts for the customers given (every one on file when omitted). */
export async function getSalesFacts(customers?: string[]): Promise<{ rows: SalesFact[]; source: SalesSource; customers: { code: string; name: string }[] }> {
  const [markets, items] = await Promise.all([listMarkets(), listItems({ ownOnly: true })]);
  const wanted = customers ? markets.filter((m) => customers.includes(m.code)) : markets;
  const meta = new Map(items.map((i) => [i.upc, { item: i.name, brand: i.brand }]));
  const weeks = await listWeekEndings((wanted[0] ?? markets[0]).code);
  const parts = await Promise.all(wanted.map((m) => {
    let p = cache.get(m.code);
    if (!p) { p = factsFor(m.code, m.name, meta); cache.set(m.code, p); }
    return p;
  }));
  return {
    rows: parts.flat(),
    source: {
      name: "NIQ retail sales",
      note: "Consumer sales at the register for Heartland items, by Albertsons division — standing in for internal sales until the Fabric link lands.",
      edge: weeks[weeks.length - 1],
      weeks,
    },
    customers: wanted.map((m) => ({ code: m.code, name: m.name })),
  };
}
