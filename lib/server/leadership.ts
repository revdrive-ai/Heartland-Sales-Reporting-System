import { getSalesFacts, type SalesFact } from "@/lib/server/salesFacts";
import { LEADERSHIP_REPORT, resolvePeriod, type LeadershipData, type RankRow, type Selection } from "@/lib/leadership/report";

/* Build every page of the Leadership team report for one selection. One
   pass over the facts: the period's weeks and their year-ago partners are
   summed per customer, brand and item, and the pages are cuts of those
   sums. Cheap enough to do on every request; the facts themselves are
   cached in the seam. */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function buildLeadership(sel: Selection, scopeCustomers: string[] | null, scopeLabel: string): Promise<LeadershipData> {
  const { rows, source, customers } = await getSalesFacts(scopeCustomers ?? undefined);
  const period = resolvePeriod(sel.period, source.weeks);
  const cur = new Set(period.weeks), ly = new Set(period.lyWeeks);
  const val = (r: SalesFact) => (sel.measure === "dollars" ? r.dollars : r.units);

  // the selectors offer what the scope holds
  const brands = [...new Set(rows.map((r) => r.brand))].sort();
  const itemMap = new Map<string, { upc: string; name: string; brand: string }>();
  for (const r of rows) if (!itemMap.has(r.upc) && (sel.brand === "ALL" || r.brand === sel.brand)) itemMap.set(r.upc, { upc: r.upc, name: r.item, brand: r.brand });
  const items = [...itemMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  // the selection narrows the facts; the ranking pages then cut what is left
  const inSel = (r: SalesFact) =>
    (sel.customer === "ALL" || r.customer === sel.customer) && (sel.brand === "ALL" || r.brand === sel.brand) && (sel.item === "ALL" || r.upc === sel.item);

  type Acc = { name: string; sub?: string; cur: number; ly: number };
  const by: Record<"customer" | "brand" | "item", Map<string, Acc>> = { customer: new Map(), brand: new Map(), item: new Map() };
  const bump = (m: Map<string, Acc>, key: string, name: string, sub: string | undefined, v: number, side: "cur" | "ly") => {
    const a = m.get(key) ?? { name, sub, cur: 0, ly: 0 };
    a[side] += v;
    m.set(key, a);
  };
  const kpi = { dollars: { cur: 0, ly: 0 }, units: { cur: 0, ly: 0 } };
  const monthsCur = Array(12).fill(0) as number[], monthsLy = Array(12).fill(0) as number[];
  const monthSeen = Array(12).fill(false) as boolean[], monthSeenLy = Array(12).fill(false) as boolean[];
  const matrix = new Map<string, { name: string; cells: Map<string, number> }>();
  const custSeen = new Set<string>(), itemSeen = new Set<string>();
  // the trend runs the period's whole year (the year of its first week), so
  // a month-to-date read still shows the months before it
  const trendYear = period.weeks[0]?.slice(0, 4) ?? source.edge.slice(0, 4);
  const trendYearLy = String(+trendYear - 1);

  for (const r of rows) {
    if (!inSel(r)) continue;
    const v = val(r);
    const y = r.week_ending.slice(0, 4), m = +r.week_ending.slice(5, 7) - 1;
    if (y === trendYear && r.week_ending <= source.edge) { monthsCur[m] += v; monthSeen[m] = true; }
    if (y === trendYearLy) { monthsLy[m] += v; monthSeenLy[m] = true; }
    const side = cur.has(r.week_ending) ? "cur" : ly.has(r.week_ending) ? "ly" : null;
    if (!side) continue;
    kpi.dollars[side] += r.dollars; kpi.units[side] += r.units;
    bump(by.customer, r.customer, r.customerName, undefined, v, side);
    bump(by.brand, r.brand, r.brand, undefined, v, side);
    bump(by.item, r.upc, r.item, r.brand, v, side);
    if (side === "cur") {
      custSeen.add(r.customer); itemSeen.add(r.upc);
      const row = matrix.get(r.customer) ?? { name: r.customerName, cells: new Map() };
      row.cells.set(r.brand, (row.cells.get(r.brand) ?? 0) + v);
      matrix.set(r.customer, row);
    }
  }

  const sortRows = (list: RankRow[]) => {
    if (sel.sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sel.sort === "change") return list.sort((a, b) => (b.ly ? b.cur / b.ly : -Infinity) - (a.ly ? a.cur / a.ly : -Infinity));
    return list.sort((a, b) => b.cur - a.cur);
  };
  const ranks: LeadershipData["ranks"] = {};
  for (const page of LEADERSHIP_REPORT) {
    if (page.kind !== "rank") continue;
    const m = by[page.dim];
    const total = [...m.values()].reduce((s, a) => s + a.cur, 0);
    const totalLy = [...m.values()].reduce((s, a) => s + a.ly, 0);
    let list: RankRow[] = [...m.entries()].map(([key, a]) => ({ key, name: a.name, sub: a.sub, cur: a.cur, ly: a.ly, share: total ? (a.cur / total) * 100 : 0 }));
    list = sortRows(list).filter((r) => r.cur !== 0 || r.ly !== 0);
    if (page.top) list = list.slice(0, page.top);
    ranks[page.key] = { page, rows: list, total, totalLy };
  }

  const mBrands = brands.filter((b) => sel.brand === "ALL" || b === sel.brand);
  const mRows = [...matrix.entries()]
    .map(([customer, r]) => {
      const cells = mBrands.map((b) => r.cells.get(b) ?? 0);
      return { customer, name: r.name, cells, total: cells.reduce((s, x) => s + x, 0) };
    })
    .sort((a, b) => b.total - a.total);
  const totals = mBrands.map((_, i) => mRows.reduce((s, r) => s + r.cells[i], 0));

  return {
    source: { name: source.name, note: source.note, edge: source.edge },
    period,
    selection: sel,
    options: { customers, brands, items },
    scopeLabel,
    kpis: { ...kpi, customers: custSeen.size, items: itemSeen.size },
    months: MON.map((label, i) => ({ label, cur: monthSeen[i] ? monthsCur[i] : null, ly: monthSeenLy[i] ? monthsLy[i] : null })),
    ranks,
    matrix: { brands: mBrands, rows: mRows, totals, grand: totals.reduce((s, x) => s + x, 0) },
  };
}

/** Read a selection out of URL search params, falling back to the defaults. */
export function selectionFrom(sp: Record<string, string | string[] | undefined>, defaults: Selection): Selection {
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const period = one("period"), measure = one("m"), sort = one("sort");
  return {
    period: (["mtd", "qtd", "ytd", "r13", "r52", "fy"] as const).includes(period as Selection["period"]) ? (period as Selection["period"]) : defaults.period,
    customer: one("cust") || defaults.customer,
    brand: one("brand") || defaults.brand,
    item: one("item") || defaults.item,
    measure: measure === "units" ? "units" : defaults.measure,
    sort: sort === "change" || sort === "name" ? sort : defaults.sort,
  };
}
