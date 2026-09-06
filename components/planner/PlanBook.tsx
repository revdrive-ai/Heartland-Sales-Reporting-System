"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "react-chartjs-2";
import WorkflowStrip from "@/components/WorkflowStrip";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";
import {
  getPlanBudget, getPlanEvents, replacePlanEvents, setPlanBudget, type PlanEvent,
} from "@/lib/repo/client";
import { getPriceEdits } from "@/lib/repo/client";
import EventWizard from "./EventWizard";
import { usePromoLines } from "./lines";
import { eventUnitPrice, eventWeeklyBase, itemWeeklyBase, type DatedPrice, type PlanPayload } from "./planMath";
import type { PlannerData } from "./PlannerView";
import type { PromoLine } from "@/lib/types/db";

/* The forward Promotion Planner — a future year (2027+) selected on the
   planner opens this builder, modeled on the reference mockup's planner page:
   trade-spend-vs-plan bar, ROI guardrails, an editable event table with
   predicted lift, a CSV year-plan template + import, carry-forward from the
   prior year's Telus book, and a month-by-month read against that book. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;
const ROI_GUARDRAIL = 1.5;
const BRAND_CHOICES = ["SPLENDA", "SLIMFAST", "JAVA HOUSE", "MIXED"];

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const weeksOf = (e: PlanEvent) => Math.max(1, Math.round((utc(e.end) - utc(e.start)) / DAY / 7));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtK = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1e3).toLocaleString() + "K");
const fmtExact = (v: number) => "$" + Math.round(v).toLocaleString(); // spend reads in real dollars, not $1K roundings

/** Spread an amount evenly across a window's days inside the plan year, per month. */
function byMonth(total: number[], amount: number, start: string, end: string, year: number) {
  if (!amount) return;
  const s = Math.max(utc(start), Date.UTC(year, 0, 1));
  const e = Math.min(utc(end), Date.UTC(year, 11, 31));
  if (e < s) return;
  const perDay = amount / ((e - s) / DAY + 1);
  for (let t = s; t <= e; t += DAY) total[new Date(t).getUTCMonth()] += perDay;
}

/** Minimal CSV splitter with quote support (mirrors the reference mockup). */
function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

type EventCalc = { weeks: number; base: number | null; incr: number | null; roi: number | null };

export default function PlanBook({ data }: { data: PlannerData }) {
  const tick = useThemeTick();
  const plan = data.plan!;
  const year = plan.year;
  const shift = (year - plan.priorYear) * 364; // days; keeps weekdays aligned

  const [events, setEvents] = useState<PlanEvent[]>([]);
  const [brandChip, setBrandChip] = useState("All brands");
  const [custSel, setCustSel] = useState("");   // "" = all customers
  const [itemSel, setItemSel] = useState("");   // "" = all items; else a UPC
  const [limit, setLimit] = useState(100);
  const [budget, setBudget] = useState<number>(plan.priorPlannedTotal);
  const [budgetEdit, setBudgetEdit] = useState(false);
  const budgetKey = `${year}|${data.scopeLabel ?? "all"}`;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardEdit, setWizardEdit] = useState<PlanEvent | null>(null);
  // row expansion — carried events drill into their FY promo's Telus lines
  const [openId, setOpenId] = useState<string | null>(null);
  const { lines, load: loadLines } = usePromoLines();
  const toggleRow = (e: PlanEvent) => {
    const next = openId === e.id ? null : e.id;
    setOpenId(next);
    if (next && e.source_promo_id) void loadLines(e.source_promo_id);
  };
  // browser-local manual price changes, layered over the ingested price list
  const [priceEdits, setPriceEdits] = useState<DatedPrice[]>([]);
  useEffect(() => {
    getPriceEdits().then((es) => setPriceEdits(
      es.filter((e) => e.upc && e.unit_price !== null)
        .map((e) => ({ upc: e.upc!, unit_price: e.unit_price!, effective_from: e.effective_from }))
    ));
  }, []);

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [impMsg, setImpMsg] = useState<string | null>(null);

  useEffect(() => {
    getPlanEvents(year).then((es) => { latestEvents.current = es; setEvents(es); });
    getPlanBudget(budgetKey).then((b) => setBudget(b ?? plan.priorPlannedTotal));
  }, [year, budgetKey, plan.priorPlannedTotal]);

  /* Mutations are LOCAL-FIRST: state updates synchronously (so the lift
     inputs never lag or snap back behind a server round-trip) and the whole
     year document persists through one serialized queue — writes land in
     order, last state wins. Lift typing debounces its persist; everything
     else writes immediately. */
  const latestEvents = useRef<PlanEvent[]>([]);
  const persistQueue = useRef<Promise<unknown>>(Promise.resolve());
  const liftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enqueue = (snap: PlanEvent[]) => {
    persistQueue.current = persistQueue.current.then(() => replacePlanEvents(year, snap)).catch(() => {});
  };
  const persistNow = (next: PlanEvent[]) => {
    latestEvents.current = next;
    setEvents(next);
    if (liftTimer.current) { clearTimeout(liftTimer.current); liftTimer.current = null; }
    enqueue(next);
  };
  const persistSoon = (next: PlanEvent[]) => {
    latestEvents.current = next;
    setEvents(next);
    if (liftTimer.current) clearTimeout(liftTimer.current);
    liftTimer.current = setTimeout(() => { liftTimer.current = null; enqueue(latestEvents.current); }, 400);
  };
  useEffect(() => () => {
    // navigating away with a lift edit still pending → flush it
    if (liftTimer.current) { clearTimeout(liftTimer.current); enqueue(latestEvents.current); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the item catalog behind the item selector: every own-brand item with NIQ
  // volume in scope, grouped by brand, plus name/brand lookups by UPC
  const itemCatalog = useMemo(
    () => Object.entries(plan.brandStats)
      .map(([brand, st]) => ({ brand, items: st.items }))
      .filter((g) => g.items.length > 0),
    [plan.brandStats]
  );
  const itemMeta = useMemo(() => {
    const m = new Map<string, { name: string; brand: string; wk: number }>();
    for (const g of itemCatalog) for (const i of g.items) m.set(i.upc, { name: i.name, brand: g.brand, wk: i.wk });
    return m;
  }, [itemCatalog]);
  const itemLabel = (u: string) => itemMeta.get(u)?.name ?? u;

  const pickBrandChip = (b: string) => {
    setBrandChip(b);
    // an item from another brand can't survive a brand narrowing
    if (itemSel && b !== "All brands" && b !== "MIXED" && itemMeta.get(itemSel)?.brand !== b) setItemSel("");
  };

  // events visible under the global scope + the customer / brand / item selectors
  const scopeIds = useMemo(() => new Set(plan.customers.map((c) => c.id)), [plan.customers]);
  const preItem = useMemo(() => events.filter((e) =>
    (!plan.scopeActive || !e.customer_id || scopeIds.has(e.customer_id)) &&
    (brandChip === "All brands" || e.brand === brandChip) &&
    (!custSel || e.customer_id === custSel)
  ), [events, plan.scopeActive, scopeIds, brandChip, custSel]);
  const visible = useMemo(() => preItem.filter((e) =>
    !itemSel || (e.upcs ?? []).includes(itemSel)
  ).sort((a, b) => a.start.localeCompare(b.start)), [preItem, itemSel]);
  // brand-level events (no item detail) an item selection can't match
  const noDetailHidden = itemSel ? preItem.filter((e) => !(e.upcs ?? []).length).length : 0;

  /* Base / incremental / ROI per event: window base = weekly base run-rate ×
     weeks, scored at THIS EVENT'S customer's divisions — its items when the
     crosswalk knows them, else the brand run-rate there. A customer with no
     NIQ divisions in scope (Ahold, Amazon etc.) scores "—". Incremental =
     base × lift; ROI = incremental retail $ ÷ trade spend. */
  const calc = (e: PlanEvent): EventCalc => {
    const weeks = weeksOf(e);
    const st = plan.brandStats[e.brand];
    if (!st || st.weeklyBaseUnits <= 0) return { weeks, base: null, incr: null, roi: null };
    const wkBase = eventWeeklyBase(plan, e.customer_id, e.brand, e.upcs);
    if (wkBase <= 0) return { weeks, base: null, incr: null, roi: null };
    const base = wkBase * weeks;
    if (e.lift_pct === null) return { weeks, base, incr: null, roi: null };
    const incr = base * (e.lift_pct / 100);
    // gross revenue on the LIST price in force at the event's start (dated
    // price list + local edits); retail price only where nothing is priced
    const price = eventUnitPrice(plan, priceEdits, e) ?? st.price;
    const roi = e.spend > 0 ? (incr * price) / e.spend : null;
    return { weeks, base, incr, roi };
  };

  const carriedCount = events.filter((e) => e.origin === "carry").length;
  const committed = visible.reduce((a, e) => a + e.spend, 0);
  const over = budget > 0 && committed > budget;
  const overBy = Math.max(0, committed - budget);
  const avail = Math.max(0, budget - committed);
  const pct = budget > 0 ? Math.min(100, (committed / budget) * 100) : 0;
  const inPct = over ? (budget / committed) * 100 : 0;

  const guards = visible.reduce(
    (g, e) => {
      const c = calc(e);
      if (c.roi === null) g.low++;
      else if (c.roi < ROI_GUARDRAIL) g.below++;
      else g.clear++;
      return g;
    },
    { below: 0, low: 0, clear: 0 }
  );

  /* month-by-month: this plan's spend vs the prior-year book (scoped) */
  const planByMonth = useMemo(() => {
    const t = Array(12).fill(0);
    for (const e of visible) byMonth(t, e.spend, e.start, e.end, year);
    return t.map(Math.round);
  }, [visible, year]);

  const saveBudget = (v: number) => {
    setBudget(v);
    setBudgetEdit(false);
    void setPlanBudget(budgetKey, v);
  };

  const addFromWizard = (e: Omit<PlanEvent, "id" | "created_at">) => {
    persistNow(
      wizardEdit
        ? latestEvents.current.map((x) => (x.id === wizardEdit.id ? { ...x, ...e } : x))
        : [...latestEvents.current, { ...e, id: newId(), created_at: new Date().toISOString() }]
    );
    setWizardOpen(false);
    setWizardEdit(null);
  };

  const carryForward = async () => {
    const shiftIso = (iso: string) => new Date(utc(iso) + shift * DAY).toISOString().slice(0, 10);
    const rows: PlanEvent[] = plan.copySource.map((p) => ({
      id: newId(), plan_year: year,
      customer_id: p.customer_id, customer: p.customer,
      brand: p.brand, title: p.title, perf: p.perf,
      upcs: p.upcs.length ? p.upcs : undefined, // items via the crosswalk, when known
      funding: p.funding, // O/I + scan rates and fixed fees, normalized from the Telus lines
      item_rates: p.item_rates, // per-deal-line $/unit rates — editable in the drill-down
      source_promo_id: p.promo_id, // click the row to drill into the FY book's component lines
      start: shiftIso(p.start), end: shiftIso(p.end), spend: p.planned,
      // scored like an import: the tactic's measured lift, else the brand average
      lift_pct: plan.brandStats[p.brand]?.tactics?.[p.perf]?.lift ?? plan.brandStats[p.brand]?.avgLift ?? null,
      note: `carried from FY${plan.priorYear}`,
      origin: "carry", created_at: new Date().toISOString(),
    }));
    if (!rows.length) return;
    persistNow([...latestEvents.current, ...rows]);
    setImpMsg(`✓ Carried ${rows.length} events forward from the FY${plan.priorYear} book (windows shifted ${shift} days to keep weekdays).`);
  };

  const tmplDl = () => {
    const rows = [
      ["title", "customer", "brand", "performance_type", "start", "end", "spend_usd", "lift_pct", "note"],
      ["Spring Baking Feature", plan.customers[0]?.name ?? "Jewel (JWL100)", "SPLENDA", data.perfTypes[0] ?? "TPR", `${year}-03-06`, `${year}-04-02`, "12000", "25", "pre-Easter window"],
      ["Summer Endcap", plan.customers[0]?.name ?? "Jewel (JWL100)", "SLIMFAST", data.perfTypes[0] ?? "TPR", `${year}-06-12`, `${year}-07-09`, "8000", "", "lift blank = brand average"],
    ];
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(rows.map((r) => r.join(",")).join("\n"));
    a.download = `heartland_year_plan_${year}.csv`;
    a.click();
  };

  const importCsv = (file: File) => {
    const rd = new FileReader();
    rd.onload = async () => {
      const lines = String(rd.result).split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length) { setImpMsg("⚠ Empty file."); return; }
      const hdr = csvSplit(lines[0]).map((h) => h.toLowerCase());
      const col = (n: string) => hdr.indexOf(n);
      if (col("title") < 0 || col("customer") < 0 || col("spend_usd") < 0) {
        setImpMsg("⚠ Header row not recognized — download the template and keep its column names.");
        return;
      }
      const byName = new Map(plan.customers.map((c) => [c.name.toLowerCase(), c]));
      const rows: PlanEvent[] = [];
      const errs: string[] = [];
      lines.slice(1).forEach((ln, ix) => {
        const c = csvSplit(ln);
        const g = (n: string) => c[col(n)] ?? "";
        const rowN = ix + 2;
        const cust = byName.get(g("customer").toLowerCase());
        if (!cust) { errs.push(`Row ${rowN}: unknown customer “${g("customer")}”`); return; }
        const spend = parseFloat(g("spend_usd"));
        if (!spend || spend <= 0) { errs.push(`Row ${rowN}: spend_usd missing`); return; }
        const start = g("start"), end = g("end");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) {
          errs.push(`Row ${rowN}: bad start/end dates (YYYY-MM-DD)`); return;
        }
        const brand = BRAND_CHOICES.includes(g("brand").toUpperCase()) ? g("brand").toUpperCase() : "MIXED";
        const lift = parseFloat(g("lift_pct"));
        const perf = g("performance_type") || data.perfTypes[0] || "TPR";
        const bs = plan.brandStats[brand];
        rows.push({
          id: newId(), plan_year: year,
          customer_id: cust.id, customer: cust.name, brand,
          title: g("title") || "Imported event", perf,
          start, end, spend: Math.round(spend),
          // blank lift → the measured lift for that tactic, else the brand average
          lift_pct: isNaN(lift) ? (bs?.tactics?.[perf]?.lift ?? bs?.avgLift ?? null) : lift,
          note: g("note"), origin: "import", created_at: new Date().toISOString(),
        });
      });
      if (rows.length) persistNow([...latestEvents.current, ...rows]);
      setImpMsg(
        `${rows.length ? `✓ Imported ${rows.length} events.` : "No valid rows imported."}` +
        (errs.length ? ` ⚠ ${errs.length} skipped: ${errs.slice(0, 3).join(" · ")}${errs.length > 3 ? " · …" : ""}` : "")
      );
    };
    rd.readAsText(file);
  };

  /* Rate-funded spend: per-unit funding pays on the units moved, so lift and
     rate edits move trade dollars. Events with per-item rates score each deal
     line on its own item's base at the event's customer; events with only a
     blended rate score on the whole event base. A fixed commitment, or an
     event whose base can't be scored (no NIQ divisions), keeps its spend —
     a zero base must not collapse it to just the fixed fees. */
  const recomputeSpend = (e: PlanEvent, lift: number | null): number | undefined => {
    const mult = weeksOf(e) * (1 + (lift ?? 0) / 100);
    if (e.item_rates?.length) {
      let spend = e.funding?.fixed ?? 0;
      let anyBase = false;
      for (const r of e.item_rates) {
        const wk = (plan.telusUpcs[r.item_number] ?? [])
          .reduce((a, u) => a + itemWeeklyBase(plan, e.customer_id, u, 0), 0);
        if (wk > 0) anyBase = true;
        spend += wk * mult * r.rate;
      }
      return anyBase ? Math.round(spend) : undefined;
    }
    if (e.funding && (e.funding.oi > 0 || e.funding.scan > 0)) {
      const wkBase = eventWeeklyBase(plan, e.customer_id, e.brand, e.upcs);
      if (wkBase > 0) return Math.round(wkBase * mult * (e.funding.oi + e.funding.scan) + e.funding.fixed);
    }
    return undefined;
  };

  const setLift = (e: PlanEvent, raw: string) => {
    const v = parseFloat(raw);
    const lift = isNaN(v) ? null : v;
    const spend = recomputeSpend(e, lift);
    persistSoon(latestEvents.current.map((x) =>
      x.id === e.id ? { ...x, lift_pct: lift, ...(spend !== undefined ? { spend } : {}) } : x));
  };

  /** Edit one deal line's $/unit rate in the drill-down — spend follows. */
  const setItemRate = (e: PlanEvent, line_id: string, raw: string) => {
    const v = parseFloat(raw);
    const rate = isNaN(v) ? 0 : Math.max(0, v);
    const item_rates = (e.item_rates ?? []).map((r) => (r.line_id === line_id ? { ...r, rate } : r));
    const next = { ...e, item_rates };
    const spend = recomputeSpend(next, next.lift_pct);
    persistSoon(latestEvents.current.map((x) =>
      x.id === e.id ? { ...next, ...(spend !== undefined ? { spend } : {}) } : x));
  };

  /** The O/I and Scan columns: per-item rates show a single value when the
      deal's lines agree and "various" when they differ — open the row to
      edit each line. Blended-only events show the blend. */
  const rateCell = (e: PlanEvent, kind: "oi" | "scan") => {
    const rs = (e.item_rates ?? []).filter((r) => r.kind === kind);
    if (rs.length) {
      const vals = [...new Set(rs.map((r) => r.rate.toFixed(2)))];
      return vals.length === 1
        ? `$${vals[0]}`
        : <span style={{ fontStyle: "italic", color: "var(--ink-2)" }} title={`${rs.length} deal lines at different rates ($${Math.min(...rs.map((r) => r.rate)).toFixed(2)}–$${Math.max(...rs.map((r) => r.rate)).toFixed(2)}) — open the row to edit each item`}>various</span>;
    }
    return e.funding && e.funding[kind] > 0 ? `$${e.funding[kind].toFixed(2)}` : "—";
  };

  const roiCell = (roi: number | null) =>
    roi === null
      ? <span style={{ color: "var(--warn)", fontWeight: 700 }} title="Not scored: no lift set, no spend, or this customer has no NIQ divisions in scope to score a base from">n/a</span>
      : <span style={{ fontWeight: 800, color: roi >= ROI_GUARDRAIL ? "var(--good)" : "var(--bad)" }}
          title={roi >= ROI_GUARDRAIL ? `Clears the ${ROI_GUARDRAIL}× guardrail` : `Below the ${ROI_GUARDRAIL}× guardrail`}>
          {roi.toFixed(1)}×
        </span>;

  return (
    <div className="view active">
      <WorkflowStrip current="planner" />

      <div className="pagehead">
        <div>
          <div className="crumb">Trade Workflow · Step 2 · Plan year</div>
          <h1>Promotion Planner — {year} plan</h1>
          <p>
            Build the {year} book before it exists in Telus: enter events, import a year plan, or carry the FY
            {plan.priorYear} book forward. Base, predicted lift, incremental volume and ROI score live from the
            NIQ history in scope; the {ROI_GUARDRAIL}× guardrail flags weak events as you type.
          </p>
        </div>
        <div className="actions">
          {data.scopeLabel && <span className="pill" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Scope: {data.scopeLabel}</span>}
          <select style={selStyle} value={String(year)} onChange={(e) => { window.location.href = `/planner?yr=${e.target.value}`; }}>
            {data.years.map((y) => (
              <option key={y} value={String(y)}>{y === data.meta.fiscal_year ? `FY${y} (Telus book)` : `Plan ${y}`}</option>
            ))}
          </select>
          <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={tmplDl} title="Download the year-plan CSV template — fill it out and bring it back through Import">
            ⬇ CSV template
          </button>
          <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={() => fileRef.current?.click()} title="Import a filled year-plan CSV — rows preview as events in the table">
            ⬆ Import year plan
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
          <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={carryForward} title={`Copy the ${plan.copySource.length} FY${plan.priorYear} promotions in scope into ${year}, windows shifted to keep weekdays aligned`}>
            ⇄ Carry FY{plan.priorYear} forward
          </button>
          {carriedCount > 0 && (
            <button
              className="btn"
              style={{ ...selStyle, cursor: "pointer" }}
              title={`Remove the ${carriedCount} carried-forward events and keep everything entered by hand or imported`}
              onClick={() => {
                persistNow(latestEvents.current.filter((e) => e.origin !== "carry"));
                setImpMsg(`↺ Removed ${carriedCount} carried events — manual and imported events kept.`);
              }}
            >
              ↺ Undo carry ({carriedCount})
            </button>
          )}
          {events.length > 0 && (
            <button
              className="btn"
              style={{ ...selStyle, cursor: "pointer", color: "var(--bad)" }}
              title={`Clear every ${year} event — carried, imported and manual`}
              onClick={() => {
                if (!window.confirm(`Clear all ${events.length} events from the ${year} plan? This removes carried, imported and manual events.`)) return;
                persistNow([]);
                setImpMsg(`✕ Cleared the ${year} plan.`);
              }}
            >
              ✕ Clear plan
            </button>
          )}
          <button className="btn primary" style={{ ...selStyle, cursor: "pointer", background: "var(--brand)", color: "var(--brand-ink)", borderColor: "var(--brand)" }} onClick={() => setWizardOpen(true)}>
            + New event
          </button>
        </div>
      </div>

      {impMsg && (
        <div className="note" style={{ marginBottom: 12 }}>
          ◇ {impMsg} <span className="minichip" style={{ cursor: "pointer", marginLeft: 8 }} onClick={() => setImpMsg(null)}>dismiss</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--ink-3)", textTransform: "uppercase" }}>Plan level</span>
          {["All brands", ...BRAND_CHOICES].map((b) => (
            <span key={b} className={"minichip" + (brandChip === b ? " on" : "")} onClick={() => pickBrandChip(b)} style={{ cursor: "pointer" }}>
              {b === "MIXED" ? "Mixed / carried" : b}
            </span>
          ))}
          <span style={{ color: "var(--line)", margin: "0 6px" }}>|</span>
          <select
            style={selStyle}
            value={custSel}
            onChange={(e) => setCustSel(e.target.value)}
            title="Narrow the plan to one customer — spend, guardrails and the monthly read all follow"
          >
            <option value="">All customers</option>
            {plan.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            style={{ ...selStyle, maxWidth: 340 }}
            value={itemSel}
            onChange={(e) => setItemSel(e.target.value)}
            title="Narrow the plan to one item — shows every event carrying that UPC (via the item crosswalk on carried events)"
          >
            <option value="">All items</option>
            {(brandChip === "All brands" || brandChip === "MIXED"
              ? itemCatalog
              : itemCatalog.filter((g) => g.brand === brandChip)
            ).map((g) => (
              <optgroup key={g.brand} label={g.brand}>
                {g.items.map((i) => (
                  <option key={i.upc} value={i.upc}>{i.name.length > 52 ? i.name.slice(0, 51) + "…" : i.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="pill">{visible.length} events in scope · {year}</span>
          {itemSel && (() => {
            const wk = itemWeeklyBase(plan, custSel, itemSel, itemMeta.get(itemSel)?.wk ?? 0);
            return (
              <span className="pill" title={`NIQ weekly base run-rate over the latest 52 weeks — ${custSel ? "at this customer's divisions" : "across the divisions in scope"}`}>
                {wk > 0
                  ? `base ${Math.round(wk).toLocaleString()} u/wk${custSel ? " at this customer" : " in scope"}`
                  : `no NIQ base ${custSel ? "at this customer" : "in scope"}`}
              </span>
            );
          })()}
          {noDetailHidden > 0 && (
            <span className="pill" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}
              title="Brand-level events carry no item list, so an item selection can't match them — clear the item to see them again">
              {noDetailHidden} brand-level event{noDetailHidden === 1 ? "" : "s"} without item detail hidden
            </span>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="c-head">
            <h3>Trade spend vs plan</h3>
            <span className="sub">follows the customer, brand &amp; item selectors</span>
          </div>
          <div style={{ display: "flex", height: 30, borderRadius: 8, overflow: "hidden", fontSize: 11, fontWeight: 800, color: "#fff" }}
            title={over ? `Over-committed by ${fmtMoney(overBy)} of the ${fmtMoney(budget)} fund` : `${fmtMoney(avail)} still available of the ${fmtMoney(budget)} fund`}>
            {over ? (<>
              <span style={{ width: `${inPct.toFixed(0)}%`, background: "var(--bad)", display: "flex", alignItems: "center", paddingLeft: 8 }}>{inPct >= 25 ? `Committed to fund ${fmtMoney(budget)}` : ""}</span>
              <span style={{ width: `${(100 - inPct).toFixed(0)}%`, background: "#8f1d16", display: "flex", alignItems: "center", paddingLeft: 8 }}>{100 - inPct >= 16 ? `Over ${fmtMoney(overBy)}` : ""}</span>
            </>) : (<>
              <span style={{ width: `${pct.toFixed(1)}%`, background: "var(--accent)", display: "flex", alignItems: "center", paddingLeft: 8 }}>{pct >= 20 ? `Committed ${fmtMoney(committed)}` : ""}</span>
              <span style={{ width: `${(100 - pct).toFixed(1)}%`, background: "var(--good)", display: "flex", alignItems: "center", paddingLeft: 8 }}>{pct <= 80 ? `Available ${fmtMoney(avail)}` : ""}</span>
            </>)}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "var(--ink-2)", fontWeight: 600, alignItems: "center" }}>
            <span>Committed {fmtMoney(committed)}</span>
            {over ? <b style={{ color: "var(--bad)" }}>Over-committed {fmtMoney(overBy)}</b> : <span>Available {fmtMoney(avail)}</span>}
            <span>
              Budget{" "}
              {budgetEdit ? (
                <input
                  style={{ ...selStyle, width: 130, padding: "3px 8px" }}
                  type="number"
                  defaultValue={budget}
                  autoFocus
                  onBlur={(e) => saveBudget(Math.max(0, parseFloat(e.target.value) || 0))}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                />
              ) : (
                <span className="minichip" style={{ cursor: "pointer" }} onClick={() => setBudgetEdit(true)} title={`Edit the ${year} trade fund for this scope — defaults to the FY${plan.priorYear} booked total`}>
                  {fmtMoney(budget)} ✎
                </span>
              )}
              <span style={{ color: "var(--ink-3)" }}> (defaults to FY{plan.priorYear} book)</span>
            </span>
          </div>
        </div>
        <div className="card">
          <div className="c-head">
            <h3>Guardrails</h3>
            <span className="sub">recalculate as you edit · ROI = incremental gross $ (dated list price) ÷ trade $</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, textAlign: "center", padding: 10, background: "var(--bad-soft, rgba(220,38,38,.08))", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--bad)" }}>{guards.below}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Below ROI {ROI_GUARDRAIL}×</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: 10, background: "var(--warn-soft, rgba(217,119,6,.10))", borderRadius: 10 }}
              title="Events with no lift set, or whose customer has no NIQ divisions in scope to score a base from">
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--warn)" }}>{guards.low}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Not scored</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: 10, background: "var(--good-soft, rgba(22,163,74,.10))", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--good)" }}>{guards.clear}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Cleared</div>
            </div>
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            ◇ Lift pre-fills from <b>measured lift by tactic</b> — each FY{plan.priorYear} window of that type in
            scope, actual vs NIQ base — falling back to the brand average
            ({BRAND_CHOICES.slice(0, 3).map((b) => `${b} +${plan.brandStats[b]?.avgLift ?? 0}%`).join(" · ")}) for
            tactics with no reads yet. Override any cell where you know better.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <b>{year} events</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {visible.length} events · {fmtExact(committed)} committed · click a lift cell to override
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Brand / Event</th><th>Customer</th><th>Window</th>
                <th style={{ textAlign: "right" }} title="Weeks in the window">Wks</th>
                <th style={{ textAlign: "right" }} title="Brand weekly base run-rate in scope × weeks (NIQ, latest 52 weeks)">Base units</th>
                <th style={{ textAlign: "right" }} title="Expected % lift over base — click to override">Pred. lift</th>
                <th style={{ textAlign: "right" }} title="Base × lift">Incr. vol</th>
                <th style={{ textAlign: "right" }} title="Off-invoice rate ($/unit) — paid on every unit moved in the window">O/I</th>
                <th style={{ textAlign: "right" }} title="Scan rate ($/unit) — paid per unit scanned at the promo price">Scan</th>
                <th style={{ textAlign: "right" }} title="Fixed fees ($) — display, ad, or slotting">Fixed</th>
                <th style={{ textAlign: "right" }}>Spend</th>
                <th style={{ textAlign: "right" }} title={`Incremental retail $ ÷ trade spend — guardrail ${ROI_GUARDRAIL}×`}>ROI</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, limit).map((e) => {
                const c = calc(e);
                return (
                  <React.Fragment key={e.id}>
                  <tr
                    onClick={() => toggleRow(e)}
                    style={{ cursor: "pointer", background: openId === e.id ? "var(--surface-2)" : undefined }}
                    title={e.source_promo_id ? `Click to see the FY${plan.priorYear} component lines behind this event` : "Click to see the items on this event"}
                  >
                    <td style={{ padding: "9px 14px", minWidth: 200 }}>
                      <b>{e.title}</b>
                      <div
                        style={{ fontSize: 11, color: "var(--ink-3)" }}
                        title={e.upcs?.length ? "Items on the deal:\n" + e.upcs.map((u) => "• " + itemLabel(u)).join("\n") : undefined}
                      >
                        {e.brand}
                        {e.upcs?.length
                          ? e.upcs.length === 1
                            ? ` · ${itemLabel(e.upcs[0]).length > 34 ? itemLabel(e.upcs[0]).slice(0, 33) + "…" : itemLabel(e.upcs[0])}`
                            : ` · ${e.upcs.length} items`
                          : " · brand level"}
                        {e.origin !== "manual" ? ` · ${e.origin === "carry" ? `carried FY${plan.priorYear}` : "imported"}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "9px 14px" }}>{e.customer}<div style={{ fontSize: 11, color: "var(--ink-3)" }}>{e.perf}</div></td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{e.start} → {e.end}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.weeks}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.base === null ? "—" : fmtK(c.base)}</td>
                    <td style={{ padding: "6px 14px", textAlign: "right" }} onClick={(ev) => ev.stopPropagation()}>
                      <input
                        style={{ ...selStyle, width: 74, padding: "4px 7px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        type="number"
                        step="1"
                        value={e.lift_pct ?? ""}
                        placeholder="—"
                        title="Expected % lift over base — edit to override"
                        onChange={(ev) => setLift(e, ev.target.value)}
                      />
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.incr === null ? "—" : Math.round(c.incr).toLocaleString()}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {rateCell(e, "oi")}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {rateCell(e, "scan")}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {e.funding && e.funding.fixed > 0 ? fmtExact(e.funding.fixed) : "—"}
                    </td>
                    <td
                      style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
                      title={e.funding && (e.funding.oi > 0 || e.funding.scan > 0)
                        ? "Rate-funded — spend recomputes when the lift changes (per-unit funding pays on units moved)"
                        : "Fixed commitment — lift changes don't move this spend"}
                    >
                      {fmtExact(e.spend)}
                      {e.funding && (e.funding.oi > 0 || e.funding.scan > 0) ? (
                        <span style={{ color: "var(--ink-3)", fontSize: 10, marginLeft: 3 }}>⚙</span>
                      ) : (
                        <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontWeight: 600 }}>committed total</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>{roiCell(c.roi)}</td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                      <span className="minichip" style={{ cursor: "pointer", marginRight: 4 }} title="Edit this event in the wizard"
                        onClick={() => { setWizardEdit(e); setWizardOpen(true); }}>✎</span>
                      <span className="minichip" style={{ cursor: "pointer" }} title="Remove this event from the plan"
                        onClick={() => persistNow(latestEvents.current.filter((x) => x.id !== e.id))}>✕</span>
                    </td>
                  </tr>
                  {openId === e.id && (
                    <tr>
                      <td colSpan={13} style={{ padding: 0, borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
                        {e.source_promo_id ? (
                          <>
                            <div style={{ padding: "10px 16px 2px", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                              FY{plan.priorYear} deal lines behind this carried event — with their NIQ tie
                            </div>
                            <CarriedLines
                              rows={lines[e.source_promo_id]}
                              plan={plan}
                              customer_id={e.customer_id}
                              customer={e.customer}
                              itemLabel={itemLabel}
                              scopeWk={(u) => itemMeta.get(u)?.wk ?? 0}
                              rates={new Map((e.item_rates ?? []).map((r) => [r.line_id, r.rate]))}
                              onRate={(line_id, raw) => setItemRate(e, line_id, raw)}
                            />
                          </>
                        ) : e.upcs?.length ? (
                          <div style={{ padding: "4px 0 8px" }}>
                            <div style={{ padding: "10px 16px 2px", fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                              Items on this deal
                            </div>
                            <table style={{ fontSize: 12.5 }}>
                              <thead><tr><th>Item</th><th>UPC</th><th style={{ textAlign: "right" }}>NIQ base at {e.customer}</th></tr></thead>
                              <tbody>
                                {e.upcs.map((u) => {
                                  const wk = itemWeeklyBase(plan, e.customer_id, u, itemMeta.get(u)?.wk ?? 0);
                                  return (
                                    <tr key={u}>
                                      <td style={{ padding: "7px 14px" }}>{itemLabel(u)}</td>
                                      <td style={{ padding: "7px 14px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "var(--ink-3)" }}>{u}</td>
                                      <td style={{ padding: "7px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                                        {wk > 0 ? `${Math.round(wk).toLocaleString()} u/wk` : "no volume here"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--ink-3)" }}>
                            Brand-level event — no item detail on file. Edit it in the wizard (✎) to put items on the deal.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={13} style={{ padding: "18px 16px", color: "var(--ink-3)", fontSize: 12.5 }}>
                  The {year} book is empty
                  {itemSel ? ` for ${itemLabel(itemSel)}` : brandChip !== "All brands" ? ` for ${brandChip}` : ""}
                  {custSel ? ` at ${plan.customers.find((c) => c.id === custSel)?.name ?? custSel}` : ""}. Start with
                  <b> ⇄ Carry FY{plan.priorYear} forward</b> to seed it from this scope&apos;s {plan.copySource.length} booked
                  promotions, <b>⬆ Import year plan</b> from the CSV template, or <b>+ New event</b>.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visible.length > limit && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
            <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={() => setLimit((l) => l + 300)}>
              Show more — {visible.length - limit} remaining
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="c-head">
          <h3>Monthly spend — {year} plan vs FY{plan.priorYear} plan &amp; billed</h3>
          <span className="sub">plan bars green where the month is funded at least as hard as the FY{plan.priorYear} plan · plan bars follow the filters</span>
        </div>
        <div className="chartbox" style={{ height: 240 }}>
          <Chart
            type="bar"
            key={"yoy" + tick + brandChip + custSel + itemSel + visible.length + committed}
            data={{
              labels: MONTHS,
              datasets: [
                {
                  type: "bar" as const,
                  label: `${year} plan`,
                  data: planByMonth,
                  backgroundColor: planByMonth.map((v, m) => v >= plan.priorPlannedByMonth[m] ? cssToken("--good") : cssToken("--bad")),
                  borderRadius: 5,
                },
                {
                  type: "bar" as const,
                  label: `FY${plan.priorYear} plan`,
                  data: plan.priorPlannedByMonth,
                  backgroundColor: cssToken("--accent"),
                  borderRadius: 5,
                },
                {
                  type: "bar" as const,
                  label: `FY${plan.priorYear} billed to date (deductions lag)`,
                  data: data.actualByMonth,
                  backgroundColor: cssToken("--ink-3"),
                  borderRadius: 5,
                },
              ],
            }}
            options={gridOptions()}
          />
        </div>
        <div className="note">
          ◇ A red plan bar funds a month lighter than the same month of the FY{plan.priorYear} <b>plan</b> — room for
          an event, or a deliberate cut. Gray bars are what Telus shows <b>billed</b> to the {data.meta.snapshot_date}{" "}
          snapshot, paced across each promotion&apos;s elapsed window — deductions land months behind the spend (fully
          expired windows have billed ~76% of plan; the year-long programs only ~18% so far), so billed reads well
          under plan and empties after the snapshot. It&apos;s the deduction pace, not a spend comparison. Prior-year
          series cover the whole scope; the plan bars follow the customer, brand and item selectors.
        </div>
      </div>

      {wizardOpen && (
        <EventWizard
          key={wizardEdit?.id ?? "new"}
          data={data}
          year={year}
          initial={wizardEdit}
          preset={{
            customer_id: custSel || undefined,
            brand: itemSel ? itemMeta.get(itemSel)?.brand
              : brandChip !== "All brands" && brandChip !== "MIXED" ? brandChip : undefined,
            upcs: itemSel ? [itemSel] : undefined,
          }}
          priceEdits={priceEdits}
          onClose={() => { setWizardOpen(false); setWizardEdit(null); }}
          onSubmit={addFromWizard}
        />
      )}
    </div>
  );
}

/** A carried event's drill-down: the FY book's component lines joined to
    their NIQ tie — per-line rate and planned dollars from Telus, plus the
    crosswalked NIQ item and its weekly base at the event's customer. Lines
    the carry normalized to a $/unit rate are editable here; edits move the
    event's spend through the per-item math. */
function CarriedLines({
  rows, plan, customer_id, customer, itemLabel, scopeWk, rates, onRate,
}: {
  rows: PromoLine[] | "loading" | undefined;
  plan: PlanPayload;
  customer_id: string;
  customer: string;
  itemLabel: (u: string) => string;
  scopeWk: (u: string) => number;
  rates: Map<string, number>;
  onRate: (line_id: string, raw: string) => void;
}) {
  if (rows === "loading" || rows === undefined) {
    return <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--ink-3)" }}>Loading lines…</div>;
  }
  const td: React.CSSProperties = { padding: "7px 14px" };
  const right: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  return (
    <table style={{ fontSize: 12.5 }}>
      <thead>
        <tr>
          <th>Component</th><th>Item (Telus)</th>
          <th style={{ textAlign: "right" }}>FY rate</th>
          <th style={{ textAlign: "right" }} title="The rate this plan pays per unit moved — edit it and the event's spend follows">Plan $/unit</th>
          <th style={{ textAlign: "right" }}>Planned</th>
          <th>NIQ tie</th>
          <th style={{ textAlign: "right" }} title="NIQ weekly base run-rate, latest 52 weeks, at this event's customer">Base at {customer}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => {
          const upcs = plan.telusUpcs[l.item_number] ?? [];
          const wk = upcs.reduce((a, u) => a + itemWeeklyBase(plan, customer_id, u, scopeWk(u)), 0);
          const rate = rates.get(l.line_id);
          return (
            <tr key={l.line_id}>
              <td style={td}>{l.component_type}</td>
              <td style={td}>
                {l.item_description ?? "—"}
                <span style={{ color: "var(--ink-3)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}> {l.item_number}</span>
              </td>
              <td style={right}>{l.rate_uom === "Lump Sum" && l.rate === 0 ? "lump sum" : `${l.rate} / ${l.rate_uom}`}</td>
              <td style={right} onClick={(ev) => ev.stopPropagation()}>
                {rate !== undefined ? (
                  <input
                    style={{ ...selStyle, width: 78, padding: "3px 7px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    type="number" step="0.05" min={0}
                    value={rate}
                    title="This line's rate in $ per unit — edits recompute the event's spend"
                    onChange={(ev) => onRate(l.line_id, ev.target.value)}
                  />
                ) : (
                  <span title="No per-unit rate on this line — its planned dollars sit in the event's fixed fees">—</span>
                )}
              </td>
              <td style={right}>{fmtMoney(l.planned_amount)}</td>
              <td style={td}>
                {upcs.length ? (
                  <span title={upcs.map((u) => `${itemLabel(u)}  (${u})`).join("\n")}>
                    {(() => { const n = itemLabel(upcs[0]); return n.length > 38 ? n.slice(0, 37) + "…" : n; })()}
                    {upcs.length > 1 ? <span style={{ color: "var(--ink-3)" }}> +{upcs.length - 1}</span> : null}
                  </span>
                ) : (
                  <span style={{ color: "var(--warn)", fontWeight: 600 }} title="This Telus SKU isn't in the item crosswalk yet — extend Crosswalk_items_V1.xlsx to tie it">no tie</span>
                )}
              </td>
              <td style={right}>{wk > 0 ? `${Math.round(wk).toLocaleString()} u/wk` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
