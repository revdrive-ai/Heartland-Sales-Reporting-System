import { comparableYearAgo } from "@/lib/weeks";

/* The Leadership team report — the model, shared by the page, the view and
   the Excel export.

   A report is an ordered list of PAGES. Each page is one cut of the same
   sales facts: a summary, a ranking by customer, brand or item, or the
   customer × brand matrix. A SELECTION (period, customer, brand, item,
   measure, sort) applies to every page, and travels in the URL, so a page
   the President likes is a link. "Build the report" renders every page in
   order as one printable presentation; the export writes the same pages as
   one workbook, a sheet each.

   The facts behind it come through lib/server/salesFacts — today the NIQ
   retail read, later the internal sales table loaded from Fabric — so
   nothing here knows or cares which. */

export type PeriodKey = "mtd" | "qtd" | "ytd" | "r13" | "r52" | "fy";
export const PERIODS: { key: PeriodKey; label: string; long: string }[] = [
  { key: "mtd", label: "MTD", long: "Month to date" },
  { key: "qtd", label: "QTD", long: "Quarter to date" },
  { key: "ytd", label: "YTD", long: "Year to date" },
  { key: "r13", label: "13 wks", long: "Latest 13 weeks" },
  { key: "r52", label: "52 wks", long: "Latest 52 weeks" },
  { key: "fy", label: "Last FY", long: "Last full year" },
];

export type Measure = "dollars" | "units";
export type SortKey = "value" | "change" | "name";

export type Selection = {
  period: PeriodKey;
  customer: string;   // market code or "ALL"
  brand: string;      // brand or "ALL"
  item: string;       // upc or "ALL"
  measure: Measure;
  sort: SortKey;
};

export const DEFAULT_SELECTION: Selection = { period: "ytd", customer: "ALL", brand: "ALL", item: "ALL", measure: "dollars", sort: "value" };

export type Dim = "customer" | "brand" | "item";

export type ReportPage =
  | { key: "summary"; title: string; kind: "summary" }
  | { key: string; title: string; kind: "rank"; dim: Dim; top?: number }
  | { key: "matrix"; title: string; kind: "matrix" };

/** The report as it stands: the pages, in the order they print. Editable
    definitions come once the President has said what he wants to see. */
export const LEADERSHIP_REPORT: ReportPage[] = [
  { key: "summary", title: "Where sales stand", kind: "summary" },
  { key: "customers", title: "Sales by customer", kind: "rank", dim: "customer" },
  { key: "brands", title: "Sales by brand", kind: "rank", dim: "brand" },
  { key: "items", title: "Top items", kind: "rank", dim: "item", top: 25 },
  { key: "matrix", title: "Customer × brand", kind: "matrix" },
];

/** A period resolved against the data edge: its weeks, the aligned weeks a
    year earlier, and how to say it. */
export type Period = {
  key: PeriodKey;
  label: string;        // "Year to date"
  range: string;        // "Jan 3 – Jul 25, 2026"
  weeks: string[];
  lyWeeks: string[];
  lyLabel: string;      // "FY2025"
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (w: string) => `${MON[+w.slice(5, 7) - 1]} ${+w.slice(8, 10)}`;
const rangeOf = (weeks: string[]) => {
  const a = weeks[0], b = weeks[weeks.length - 1];
  return a.slice(0, 4) === b.slice(0, 4) ? `${day(a)} – ${day(b)}, ${b.slice(0, 4)}` : `${day(a)}, ${a.slice(0, 4)} – ${day(b)}, ${b.slice(0, 4)}`;
};

export function resolvePeriod(key: PeriodKey, allWeeks: string[]): Period {
  const edge = allWeeks[allWeeks.length - 1];
  const year = edge.slice(0, 4), month = +edge.slice(5, 7);
  const q0 = Math.floor((month - 1) / 3) * 3 + 1;
  const inYear = (y: string) => allWeeks.filter((w) => w.slice(0, 4) === y);
  let weeks: string[];
  let label = PERIODS.find((p) => p.key === key)!.long;
  switch (key) {
    case "mtd": weeks = inYear(year).filter((w) => +w.slice(5, 7) === month); label = `${MON[month - 1]} ${year} to date`; break;
    case "qtd": weeks = inYear(year).filter((w) => { const m = +w.slice(5, 7); return m >= q0 && m <= q0 + 2; }); label = `Q${Math.floor((month - 1) / 3) + 1} ${year} to date`; break;
    case "ytd": weeks = inYear(year); label = `${year} year to date`; break;
    case "r13": weeks = allWeeks.slice(-13); break;
    case "r52": weeks = allWeeks.slice(-52); break;
    case "fy": {
      const prior = String(+year - 1);
      weeks = inYear(prior);
      label = `Full year ${prior}`;
      break;
    }
  }
  const lyWeeks = weeks.map(comparableYearAgo).filter((w): w is string => w !== null && allWeeks.includes(w));
  return { key, label, range: weeks.length ? rangeOf(weeks) : "—", weeks, lyWeeks, lyLabel: weeks.length ? `FY${+weeks[0].slice(0, 4) - 1}` : "" };
}

/* ---------------------------------------------------------------- results */

export type RankRow = { key: string; name: string; sub?: string; cur: number; ly: number; share: number };
export type Kpi = { cur: number; ly: number };

export type LeadershipData = {
  source: { name: string; note: string; edge: string };
  period: Period;
  selection: Selection;
  /** what the selectors offer */
  options: { customers: { code: string; name: string }[]; brands: string[]; items: { upc: string; name: string; brand: string }[] };
  scopeLabel: string;
  kpis: { dollars: Kpi; units: Kpi; customers: number; items: number };
  /** the period's year, month by month, this year and last, in the measure */
  months: { label: string; cur: number | null; ly: number | null }[];
  ranks: Record<string, { page: ReportPage & { kind: "rank" }; rows: RankRow[]; total: number; totalLy: number }>;
  matrix: { brands: string[]; rows: { customer: string; name: string; cells: number[]; total: number }[]; totals: number[]; grand: number };
};

export const fmtMoney = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1e3).toLocaleString()}K` : `$${Math.round(x).toLocaleString()}`;
  return v < 0 ? `−${t}` : t;
};
export const fmtUnits = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${Math.round(x / 1e3).toLocaleString()}K` : Math.round(x).toLocaleString();
  return v < 0 ? `−${t}` : t;
};
export const fmtFor = (m: Measure) => (m === "dollars" ? fmtMoney : fmtUnits);
export const pctChange = (cur: number, ly: number) => (ly ? (cur / ly - 1) * 100 : null);
export const fmtPct = (p: number | null) => (p === null ? "—" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`);
