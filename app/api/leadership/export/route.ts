import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getScope } from "@/lib/server/scope";
import { buildLeadership, selectionFrom } from "@/lib/server/leadership";
import { DEFAULT_SELECTION, LEADERSHIP_REPORT, PERIODS } from "@/lib/leadership/report";

/* The Leadership team report as one Excel workbook: a Selection sheet, then
   every page of the report as a sheet of its own, in the order it prints.
   Same selection parameters as the page, so the Excel button on any page
   writes exactly what is on screen. */

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const scope = await getScope();
  const sel = selectionFrom(sp, DEFAULT_SELECTION);
  const data = await buildLeadership(sel, scope.active ? scope.marketCodes : null, scope.active ? scope.label : "All customers");
  const measure = sel.measure === "dollars" ? "Sales $" : "Units";
  const chg = (cur: number, ly: number) => (ly ? Math.round((cur / ly - 1) * 1000) / 10 : null);

  const wb = XLSX.utils.book_new();
  const customerName = sel.customer === "ALL" ? data.scopeLabel : data.options.customers.find((c) => c.code === sel.customer)?.name ?? sel.customer;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Leadership team report"],
    ["Period", `${PERIODS.find((p) => p.key === sel.period)?.long ?? sel.period} — ${data.period.range}`],
    ["Against", data.period.lyLabel],
    ["Customer", customerName],
    ["Brand", sel.brand === "ALL" ? "All brands" : sel.brand],
    ["Item", sel.item === "ALL" ? "All items" : data.options.items.find((i) => i.upc === sel.item)?.name ?? sel.item],
    ["Measure", measure],
    ["Source", `${data.source.name} through ${data.source.edge}`],
    ["Note", data.source.note],
    ["Exported", new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"],
  ]), "Selection");

  for (const page of LEADERSHIP_REPORT) {
    if (page.kind === "summary") {
      const k = data.kpis;
      const rows: (string | number | null)[][] = [
        [page.title, data.period.label, data.period.range],
        [],
        ["Measure", "This period", data.period.lyLabel, "Change %"],
        ["Sales $", Math.round(k.dollars.cur), Math.round(k.dollars.ly), chg(k.dollars.cur, k.dollars.ly)],
        ["Units", Math.round(k.units.cur), Math.round(k.units.ly), chg(k.units.cur, k.units.ly)],
        ["Price per unit", k.units.cur ? Math.round((k.dollars.cur / k.units.cur) * 100) / 100 : null, k.units.ly ? Math.round((k.dollars.ly / k.units.ly) * 100) / 100 : null, null],
        ["Customers selling", k.customers, null, null],
        ["Items selling", k.items, null, null],
        [],
        ["Month", `FY${data.period.weeks[0]?.slice(0, 4) ?? ""} ${measure}`, `Prior year ${measure}`, "Change %"],
        ...data.months.map((m) => [m.label, m.cur === null ? null : Math.round(m.cur), m.ly === null ? null : Math.round(m.ly), m.cur !== null && m.ly ? chg(m.cur, m.ly) : null]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Summary");
    } else if (page.kind === "rank") {
      const r = data.ranks[page.key];
      const head = page.dim === "customer" ? "Customer" : page.dim === "brand" ? "Brand" : "Item";
      const rows: (string | number | null)[][] = [
        [page.title, data.period.label, data.period.range],
        [],
        ["#", head, ...(page.dim === "item" ? ["Brand", "UPC"] : []), measure, `${data.period.lyLabel} ${measure}`, "Change %", "Share %"],
        ...r.rows.map((x, i) => [i + 1, x.name, ...(page.dim === "item" ? [x.sub ?? "", x.key] : []), Math.round(x.cur), Math.round(x.ly), chg(x.cur, x.ly), Math.round(x.share * 10) / 10]),
        ["", "Total", ...(page.dim === "item" ? ["", ""] : []), Math.round(r.total), Math.round(r.totalLy), chg(r.total, r.totalLy), 100],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), page.title.slice(0, 31));
    } else {
      const m = data.matrix;
      const rows: (string | number | null)[][] = [
        [page.title, data.period.label, measure],
        [],
        ["Customer", ...m.brands, "Total"],
        ...m.rows.map((x) => [x.name, ...x.cells.map(Math.round), Math.round(x.total)]),
        ["Total", ...m.totals.map(Math.round), Math.round(m.grand)],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Customer x brand");
    }
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const name = `Leadership-report-${sel.period}-${data.source.edge}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
