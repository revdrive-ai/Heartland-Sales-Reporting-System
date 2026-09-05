import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";

/* Base-units export — the Base & Lift selection as a brand-by-item table,
   weekly or monthly columns, CSV or Excel. Works for every timeframe the Lab
   offers, plan years included: measured weeks carry the NIQ base; a plan
   year's weeks carry the year-ago base as far as it has actualized and the
   seasonality-shaped projection after (marked * in the column header).
   Planner adjustments are browser-local and are NOT applied here. */

const OWN_BRANDS = ["SPLENDA", "SLIMFAST", "JAVA HOUSE"];
const ROLLING: Record<string, number> = { "4w": 4, "13w": 13, "26w": 26, "52w": 52 };
const DAY = 86400000;

const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
const yearAgoWeek = (w: string) => new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);

function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const csvEsc = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const [markets, allItems, gscope] = await Promise.all([listMarkets(), listItems(), getScope()]);
  const allowed = gscope.active ? markets.filter((m) => gscope.marketCodes.includes(m.code)) : markets;

  const mkt = sp.get("mkt") ?? "";
  const market = allowed.find((m) => m.code === mkt);
  if (!market) return NextResponse.json({ error: "unknown or out-of-scope market" }, { status: 400 });
  const brand = OWN_BRANDS.includes(sp.get("brand") ?? "") ? sp.get("brand")! : "SPLENDA";
  const gran = sp.get("gran") === "month" ? "month" : "week";
  const fmt = sp.get("fmt") === "xlsx" ? "xlsx" : "csv";

  const allWeeks = await listWeekEndings(mkt);
  const latestWeek = allWeeks[allWeeks.length - 1];
  const latestDataYear = +latestWeek.slice(0, 4);
  const maxYear = Math.max(latestDataYear, new Date().getUTCFullYear()) + 2;

  // timeframe — same grammar as the Lab
  const rawWin = sp.get("win") ?? "52w";
  const win = ROLLING[rawWin] || rawWin === "ytd" || (/^\d{4}$/.test(rawWin) && +rawWin >= 2024 && +rawWin <= maxYear)
    ? rawWin : "52w";
  let weeks: string[];
  let winLabel: string;
  let planningYear = false;
  if (ROLLING[win]) {
    weeks = allWeeks.slice(-ROLLING[win]);
    winLabel = `Latest ${ROLLING[win]} weeks`;
  } else if (win === "ytd") {
    weeks = allWeeks.filter((w) => w.startsWith(String(latestDataYear)));
    winLabel = `Year to date (${latestDataYear})`;
  } else {
    weeks = allWeeks.filter((w) => w.startsWith(win));
    winLabel = `Total year ${win}`;
    if (weeks.length === 0) {
      weeks = saturdaysOfYear(+win);
      planningYear = true;
      winLabel = `Plan year ${win}`;
    }
  }

  const factsAll = await getWeeklyFacts({ market_code: mkt, brand });
  const recentFrom = allWeeks[Math.max(allWeeks.length - 52, 0)];
  const withVolume = new Set(factsAll.filter((r) => r.week_ending >= recentFrom && (r.units ?? 0) > 0).map((r) => r.upc));
  const itemParam = sp.get("item") ?? "ALL";
  const items = allItems
    .filter((i) => i.brand === brand && withVolume.has(i.upc) && (itemParam === "ALL" || i.upc === itemParam))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (items.length === 0) return NextResponse.json({ error: "no items in this selection" }, { status: 400 });
  const itemSet = new Set(items.map((i) => i.upc));

  // per-item weekly base units, full history
  const base = new Map<string, Map<string, number>>();
  for (const r of factsAll) {
    if (!itemSet.has(r.upc)) continue;
    const m = base.get(r.upc) ?? base.set(r.upc, new Map()).get(r.upc)!;
    m.set(r.week_ending, (m.get(r.week_ending) ?? 0) + (r.base_units ?? r.units ?? 0));
  }

  // plan-year machinery: the selection's seasonality engine + per-item 52w run-rate
  let engine: number[] = [];
  const avg52 = new Map<string, number>();
  if (planningYear) {
    const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
    let grand = 0, grandN = 0;
    const wkTot = new Map<string, number>();
    for (const [u, m] of base) {
      let s52 = 0;
      for (const [w, v] of m) {
        wkTot.set(w, (wkTot.get(w) ?? 0) + v);
        if (w >= recentFrom) s52 += v;
      }
      avg52.set(u, s52 / 52);
    }
    for (const [w, v] of wkTot) {
      const mo = +w.slice(5, 7) - 1;
      monthTot[mo] += v; monthN[mo] += 1; grand += v; grandN += 1;
    }
    const grandAvg = grandN ? grand / grandN : 0;
    engine = monthTot.map((t, m) => (monthN[m] > 0 && grandAvg > 0 ? t / monthN[m] / grandAvg : 1));
  }

  // value per item per week (measured, carried, or projected) + projection flag
  const valueAt = (u: string, w: string): { v: number; proj: boolean } => {
    if (!planningYear) return { v: base.get(u)?.get(w) ?? 0, proj: false };
    const src = yearAgoWeek(w);
    if (src <= latestWeek) return { v: base.get(u)?.get(src) ?? 0, proj: false };
    return { v: (avg52.get(u) ?? 0) * engine[+w.slice(5, 7) - 1], proj: true };
  };

  // periods: weeks, or months of those weeks (a week belongs to its Saturday's month)
  const periods: { label: string; weeks: string[] }[] = [];
  if (gran === "week") {
    for (const w of weeks) periods.push({ label: w, weeks: [w] });
  } else {
    const byMonth = new Map<string, string[]>();
    for (const w of weeks) {
      const k = w.slice(0, 7);
      (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(w);
    }
    for (const [k, ws] of byMonth) periods.push({ label: k, weeks: ws });
  }
  const periodProj = periods.map((p) => planningYear && p.weeks.some((w) => yearAgoWeek(w) > latestWeek));

  // table
  const header = ["Brand", "UPC", "Item", ...periods.map((p, i) => p.label + (periodProj[i] ? " *" : "")), "Total"];
  const rows: (string | number)[][] = [];
  const colTot = Array(periods.length).fill(0);
  for (const it of items) {
    const vals = periods.map((p, i) => {
      let s = 0;
      for (const w of p.weeks) s += valueAt(it.upc, w).v;
      colTot[i] += s;
      return Math.round(s);
    });
    rows.push([brand, it.upc, it.name, ...vals, vals.reduce((a, v) => a + v, 0)]);
  }
  rows.push([brand, "", `TOTAL ${brand}`, ...colTot.map(Math.round), Math.round(colTot.reduce((a, v) => a + v, 0))]);

  const meta = [
    ["Heartland — base units export"],
    ["Division", market.name],
    ["Brand", brand + (itemParam !== "ALL" ? ` · single item` : ` · ${items.length} items`)],
    ["Timeframe", `${winLabel} · ${weeks[0]} → ${weeks[weeks.length - 1]}`],
    ["Granularity", gran === "week" ? "Weekly (NIQ week-ending Saturdays)" : "Monthly (weeks grouped by their Saturday's month)"],
    ["Basis", planningYear
      ? "Plan year: year-ago NIQ base carried in as far as actualized; * periods are seasonality-shaped projection. Planner adjustments are not applied."
      : "Measured NIQ base units."],
    ["Exported", new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"],
    [],
  ];

  const fname = `base-units_${mkt}_${brand.replace(/\s+/g, "")}_${win}_${gran}ly`;
  if (fmt === "csv") {
    const csv = [...meta, header, ...rows].map((r) => r.map(csvEsc).join(",")).join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fname}.csv"`,
      },
    });
  }
  const ws = XLSX.utils.aoa_to_sheet([...meta, header, ...rows]);
  ws["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 46 }, ...periods.map(() => ({ wch: gran === "week" ? 11 : 10 })), { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Base units");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}.xlsx"`,
    },
  });
}
