import { comparableYearAgo } from "@/lib/weeks";
import type { FiscalPeriod } from "@/lib/types/db";

/* The Leadership team report — the model, shared by the page, the view and
   the Excel export.

   A report is an ordered list of PAGES. Each page is one cut of the same
   sales facts: a summary, a ranking by customer, channel, brand or item, or
   the customer × brand matrix. A SELECTION (period, customer, brand, item,
   measure, sort) applies to every page, and travels in the URL, so a page
   the President likes is a link. "Build the report" renders every page in
   order as one printable presentation; the export writes the same pages as
   one workbook, a sheet each.

   The facts behind it come through lib/server/salesFacts — internal sales
   from Fabric, or the NIQ retail read where those are not on hand — so
   nothing here knows or cares which; the source block carries the words
   (net sales or retail sales, cases or units). */

export type PeriodKey = "mtd" | "ptd" | "qtd" | "ytd" | "r13" | "r52" | "fy";
export const PERIODS: { key: PeriodKey; label: string; long: string }[] = [
  { key: "mtd", label: "MTD", long: "Month to date" },
  { key: "ptd", label: "PTD", long: "Fiscal period to date" },
  { key: "qtd", label: "QTD", long: "Quarter to date" },
  { key: "ytd", label: "YTD", long: "Year to date" },
  { key: "r13", label: "13 wks", long: "Latest 13 weeks" },
  { key: "r52", label: "52 wks", long: "Latest 52 weeks" },
  { key: "fy", label: "Last FY", long: "Last full year" },
];
export const PERIOD_KEYS = PERIODS.map((p) => p.key);

export type Measure = "dollars" | "units";
export type SortKey = "value" | "change" | "name";

export type Selection = {
  period: PeriodKey;
  customer: string;   // account key or "ALL"
  brand: string;      // brand or "ALL"
  item: string;       // item key or "ALL"
  measure: Measure;
  sort: SortKey;
};

export const DEFAULT_SELECTION: Selection = { period: "ytd", customer: "ALL", brand: "ALL", item: "ALL", measure: "dollars", sort: "value" };

export type Dim = "customer" | "channel" | "brand" | "item";
export const DIM_LABEL: Record<Dim, string> = { customer: "Customer", channel: "Channel", brand: "Brand", item: "Item" };

export type ReportPage =
  | { key: "summary"; title: string; kind: "summary" }
  | { key: string; title: string; kind: "rank"; dim: Dim; top?: number }
  | { key: "matrix"; title: string; kind: "matrix" };

/** The report as it stands: the pages, in the order they print. Editable
    definitions come once the President has said what he wants to see. */
export const LEADERSHIP_REPORT: ReportPage[] = [
  { key: "summary", title: "Where sales stand", kind: "summary" },
  { key: "customers", title: "Sales by customer", kind: "rank", dim: "customer" },
  { key: "channels", title: "Sales by channel", kind: "rank", dim: "channel" },
  { key: "brands", title: "Sales by brand", kind: "rank", dim: "brand" },
  { key: "items", title: "Top items", kind: "rank", dim: "item", top: 25 },
  { key: "matrix", title: "Customer × brand", kind: "matrix" },
];

/** What the source calls the measure — "Net sales" / "Cases" for internal
    sales, "Retail sales" / "Units" for the NIQ read. */
export type SourceWords = { money: string; qty: "Cases" | "Units" };
export const measureName = (src: SourceWords, m: Measure) => (m === "dollars" ? src.money : src.qty);
export const measureWord = (src: SourceWords, m: Measure) => measureName(src, m).toLowerCase();
export const eachOf = (src: SourceWords) => (src.qty === "Cases" ? "case" : "unit");

/** A period resolved against the data edge: its weeks, the aligned weeks a
    year earlier, and how to say it. */
export type Period = {
  key: PeriodKey;
  label: string;        // "Year to date"
  range: string;        // "Jan 3 – Jul 25, 2026"
  weeks: string[];
  lyWeeks: string[];
  lyLabel: string;      // "FY2025"
  fiscal: boolean;      // the bounds came from the close calendar
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (w: string) => `${MON[+w.slice(5, 7) - 1]} ${+w.slice(8, 10)}`;
const rangeOf = (weeks: string[]) => {
  const a = weeks[0], b = weeks[weeks.length - 1];
  return a.slice(0, 4) === b.slice(0, 4) ? `${day(a)} – ${day(b)}, ${b.slice(0, 4)}` : `${day(a)}, ${a.slice(0, 4)} – ${day(b)}, ${b.slice(0, 4)}`;
};

/** Resolve a period against the weeks on file. With the close calendar
    (dim_fiscal_period) the period, quarter, year and last-full-year bounds
    are fiscal; without it they are calendar, and PTD reads as MTD. */
export function resolvePeriod(key: PeriodKey, allWeeks: string[], fiscal: FiscalPeriod[] = []): Period {
  const edge = allWeeks[allWeeks.length - 1];
  const year = edge.slice(0, 4), month = +edge.slice(5, 7);
  const q0 = Math.floor((month - 1) / 3) * 3 + 1;
  const inYear = (y: string) => allWeeks.filter((w) => w.slice(0, 4) === y);
  const between = (a: string, b: string) => allWeeks.filter((w) => w >= a && w <= b);
  const fp = fiscal.find((p) => p.start_date <= edge && edge <= p.end_date) ?? null;
  const fyOf = (fy: number) => fiscal.filter((p) => p.fiscal_year === fy).sort((a, b) => a.period - b.period);
  const span = (ps: FiscalPeriod[]) => (ps.length ? between(ps[0].start_date, ps[ps.length - 1].end_date) : []);
  const mtd = () => inYear(year).filter((w) => +w.slice(5, 7) === month);

  let weeks: string[];
  let label = PERIODS.find((p) => p.key === key)!.long;
  let isFiscal = false;
  switch (key) {
    case "mtd": weeks = mtd(); label = `${MON[month - 1]} ${year} to date`; break;
    case "ptd":
      if (fp) { weeks = between(fp.start_date, fp.end_date); label = `P${fp.period} FY${fp.fiscal_year} to date`; isFiscal = true; }
      else { weeks = mtd(); label = `${MON[month - 1]} ${year} to date`; }
      break;
    case "qtd":
      if (fp) {
        const q = Math.ceil(fp.period / 3);
        weeks = span(fyOf(fp.fiscal_year).filter((p) => Math.ceil(p.period / 3) === q));
        label = `Q${q} FY${fp.fiscal_year} to date`; isFiscal = true;
      } else {
        weeks = inYear(year).filter((w) => { const m = +w.slice(5, 7); return m >= q0 && m <= q0 + 2; });
        label = `Q${Math.floor((month - 1) / 3) + 1} ${year} to date`;
      }
      break;
    case "ytd":
      if (fp) { weeks = span(fyOf(fp.fiscal_year)); label = `FY${fp.fiscal_year} to date`; isFiscal = true; }
      else { weeks = inYear(year); label = `${year} year to date`; }
      break;
    case "r13": weeks = allWeeks.slice(-13); break;
    case "r52": weeks = allWeeks.slice(-52); break;
    case "fy": {
      const ps = fp ? fyOf(fp.fiscal_year - 1) : [];
      if (ps.length) { weeks = span(ps); label = `Full year FY${fp!.fiscal_year - 1}`; isFiscal = true; }
      else { const prior = String(+year - 1); weeks = inYear(prior); label = `Full year ${prior}`; }
      break;
    }
  }
  const lyWeeks = weeks.map(comparableYearAgo).filter((w): w is string => w !== null && allWeeks.includes(w));
  return { key, label, range: weeks.length ? rangeOf(weeks) : "—", weeks, lyWeeks, lyLabel: weeks.length ? `FY${+weeks[0].slice(0, 4) - 1}` : "", fiscal: isFiscal };
}

/* ---------------------------------------------------------------- results */

export type RankRow = { key: string; name: string; sub?: string; cur: number; ly: number; share: number };
export type Kpi = { cur: number; ly: number };

export type LeadershipData = {
  source: { name: string; note: string; edge: string; partialWeek: boolean } & SourceWords;
  period: Period;
  selection: Selection;
  /** what the selectors offer */
  options: { customers: { code: string; name: string }[]; brands: string[]; items: { key: string; name: string; brand: string }[] };
  scopeLabel: string;
  kpis: { dollars: Kpi; gross: Kpi; offInvoice: Kpi; units: Kpi; customers: number; items: number };
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
