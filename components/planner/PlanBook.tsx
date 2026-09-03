"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "react-chartjs-2";
import WorkflowStrip from "@/components/WorkflowStrip";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";
import {
  addPlanEvents, deletePlanEvent, getPlanBudget, getPlanEvents, setPlanBudget,
  updatePlanEvent, type PlanEvent,
} from "@/lib/repo/client";
import type { PlannerData } from "./PlannerView";

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
  const [limit, setLimit] = useState(100);
  const [budget, setBudget] = useState<number>(plan.priorPlannedTotal);
  const [budgetEdit, setBudgetEdit] = useState(false);
  const budgetKey = `${year}|${data.scopeLabel ?? "all"}`;

  // new-event form
  const [fCust, setFCust] = useState("");
  const [fBrand, setFBrand] = useState("SPLENDA");
  const [fTitle, setFTitle] = useState("");
  const [fPerf, setFPerf] = useState("");
  const [fStart, setFStart] = useState(`${year}-01-01`);
  const [fEnd, setFEnd] = useState(`${year}-01-28`);
  const [fSpend, setFSpend] = useState("");
  const [fLift, setFLift] = useState("");
  const [showForm, setShowForm] = useState(false);

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [impMsg, setImpMsg] = useState<string | null>(null);

  useEffect(() => {
    getPlanEvents(year).then(setEvents);
    getPlanBudget(budgetKey).then((b) => setBudget(b ?? plan.priorPlannedTotal));
  }, [year, budgetKey, plan.priorPlannedTotal]);

  // events visible under the global scope + brand chip
  const scopeIds = useMemo(() => new Set(plan.customers.map((c) => c.id)), [plan.customers]);
  const visible = useMemo(() => events.filter((e) =>
    (!plan.scopeActive || !e.customer_id || scopeIds.has(e.customer_id)) &&
    (brandChip === "All brands" || e.brand === brandChip)
  ).sort((a, b) => a.start.localeCompare(b.start)), [events, plan.scopeActive, scopeIds, brandChip]);

  /* Base / incremental / ROI per event, from the scoped NIQ brand stats:
     window base = brand weekly base run-rate × weeks; incremental = base ×
     lift; ROI = incremental retail $ ÷ trade spend. */
  const calc = (e: PlanEvent): EventCalc => {
    const weeks = weeksOf(e);
    const st = plan.brandStats[e.brand];
    if (!st || st.weeklyBaseUnits <= 0) return { weeks, base: null, incr: null, roi: null };
    const base = st.weeklyBaseUnits * weeks;
    if (e.lift_pct === null) return { weeks, base, incr: null, roi: null };
    const incr = base * (e.lift_pct / 100);
    const roi = e.spend > 0 ? (incr * st.price) / e.spend : null;
    return { weeks, base, incr, roi };
  };

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

  const addManual = async () => {
    const spend = parseFloat(fSpend);
    if (!fCust || !fTitle.trim() || !spend || spend <= 0 || fEnd < fStart) return;
    const lift = parseFloat(fLift);
    setEvents(await addPlanEvents([{
      id: newId(), plan_year: year,
      customer_id: fCust, customer: plan.customers.find((c) => c.id === fCust)?.name ?? fCust,
      brand: fBrand, title: fTitle.trim(), perf: fPerf || data.perfTypes[0] || "TPR",
      start: fStart, end: fEnd, spend: Math.round(spend),
      lift_pct: isNaN(lift) ? (plan.brandStats[fBrand]?.avgLift ?? null) : lift,
      note: "", origin: "manual", created_at: new Date().toISOString(),
    }]));
    setFTitle(""); setFSpend(""); setFLift(""); setShowForm(false);
  };

  const carryForward = async () => {
    const shiftIso = (iso: string) => new Date(utc(iso) + shift * DAY).toISOString().slice(0, 10);
    const rows: PlanEvent[] = plan.copySource.map((p) => ({
      id: newId(), plan_year: year,
      customer_id: p.customer_id, customer: p.customer,
      brand: "MIXED", title: p.title, perf: p.perf,
      start: shiftIso(p.start), end: shiftIso(p.end), spend: p.planned,
      lift_pct: null, note: `carried from FY${plan.priorYear}`,
      origin: "carry", created_at: new Date().toISOString(),
    }));
    if (!rows.length) return;
    setEvents(await addPlanEvents(rows));
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
        rows.push({
          id: newId(), plan_year: year,
          customer_id: cust.id, customer: cust.name, brand,
          title: g("title") || "Imported event", perf: g("performance_type") || data.perfTypes[0] || "TPR",
          start, end, spend: Math.round(spend),
          lift_pct: isNaN(lift) ? (plan.brandStats[brand]?.avgLift ?? null) : lift,
          note: g("note"), origin: "import", created_at: new Date().toISOString(),
        });
      });
      if (rows.length) setEvents(await addPlanEvents(rows));
      setImpMsg(
        `${rows.length ? `✓ Imported ${rows.length} events.` : "No valid rows imported."}` +
        (errs.length ? ` ⚠ ${errs.length} skipped: ${errs.slice(0, 3).join(" · ")}${errs.length > 3 ? " · …" : ""}` : "")
      );
    };
    rd.readAsText(file);
  };

  const setLift = async (e: PlanEvent, raw: string) => {
    const v = parseFloat(raw);
    setEvents(await updatePlanEvent(e.id, year, { lift_pct: isNaN(v) ? null : v }));
  };

  const roiCell = (roi: number | null) =>
    roi === null
      ? <span style={{ color: "var(--warn)", fontWeight: 700 }} title="No lift set, or no NIQ base for this brand in scope — set a lift % to score it">n/a</span>
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
          <button className="btn primary" style={{ ...selStyle, cursor: "pointer", background: "var(--brand)", color: "var(--brand-ink)", borderColor: "var(--brand)" }} onClick={() => setShowForm((v) => !v)}>
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
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--ink-3)", textTransform: "uppercase" }}>Brands</span>
          {["All brands", ...BRAND_CHOICES].map((b) => (
            <span key={b} className={"minichip" + (brandChip === b ? " on" : "")} onClick={() => setBrandChip(b)} style={{ cursor: "pointer" }}>
              {b === "MIXED" ? "Mixed / carried" : b}
            </span>
          ))}
          <span style={{ color: "var(--line)", margin: "0 6px" }}>|</span>
          <span className="pill">{visible.length} events in scope · {year}</span>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="c-head">
            <h3>Trade spend vs plan</h3>
            <span className="sub">follows the brand &amp; scope filters</span>
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
            <span className="sub">recalculate as you edit · ROI = incremental retail $ ÷ trade $</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, textAlign: "center", padding: 10, background: "var(--bad-soft, rgba(220,38,38,.08))", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--bad)" }}>{guards.below}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Below ROI {ROI_GUARDRAIL}×</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: 10, background: "var(--warn-soft, rgba(217,119,6,.10))", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--warn)" }}>{guards.low}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>No lift scored</div>
            </div>
            <div style={{ flex: 1, textAlign: "center", padding: 10, background: "var(--good-soft, rgba(22,163,74,.10))", borderRadius: 10 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--good)" }}>{guards.clear}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>Cleared</div>
            </div>
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            ◇ Lift defaults to each brand&apos;s average NIQ promoted-week lift in scope
            ({BRAND_CHOICES.slice(0, 3).map((b) => `${b} +${plan.brandStats[b]?.avgLift ?? 0}%`).join(" · ")}) — override any cell where you know better.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <b>{year} events</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {visible.length} events · {fmtMoney(committed)} committed · click a lift cell to override
          </span>
        </div>
        {showForm && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", background: "var(--surface-2)" }}>
            <select style={selStyle} value={fCust} onChange={(e) => setFCust(e.target.value)}>
              <option value="">Customer…</option>
              {plan.customers.map((c) => <option key={c.id} value={c.id}>{c.name.length > 30 ? c.name.slice(0, 29) + "…" : c.name}</option>)}
            </select>
            <select style={selStyle} value={fBrand} onChange={(e) => setFBrand(e.target.value)}>
              {BRAND_CHOICES.map((b) => <option key={b}>{b}</option>)}
            </select>
            <input style={{ ...selStyle, flex: "1 1 180px", minWidth: 150 }} placeholder="Event title…" value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
            <select style={selStyle} value={fPerf} onChange={(e) => setFPerf(e.target.value)}>
              <option value="">Type…</option>
              {data.perfTypes.map((p) => <option key={p}>{p}</option>)}
            </select>
            <input style={{ ...selStyle, width: 140 }} type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} />
            <span style={{ color: "var(--ink-3)", fontSize: 12 }}>→</span>
            <input style={{ ...selStyle, width: 140 }} type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} />
            <input style={{ ...selStyle, width: 110 }} type="number" placeholder="Spend $" value={fSpend} onChange={(e) => setFSpend(e.target.value)} />
            <input style={{ ...selStyle, width: 96 }} type="number" placeholder={`Lift % (${plan.brandStats[fBrand]?.avgLift ?? 0})`} title="Expected % lift over base — blank uses the brand average" value={fLift} onChange={(e) => setFLift(e.target.value)} />
            <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={addManual} disabled={!fCust || !fTitle.trim() || !parseFloat(fSpend)}>
              ✓ Add to plan
            </button>
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Brand / Event</th><th>Customer</th><th>Window</th>
                <th style={{ textAlign: "right" }} title="Weeks in the window">Wks</th>
                <th style={{ textAlign: "right" }} title="Brand weekly base run-rate in scope × weeks (NIQ, latest 52 weeks)">Base units</th>
                <th style={{ textAlign: "right" }} title="Expected % lift over base — click to override">Pred. lift</th>
                <th style={{ textAlign: "right" }} title="Base × lift">Incr. vol</th>
                <th style={{ textAlign: "right" }}>Spend</th>
                <th style={{ textAlign: "right" }} title={`Incremental retail $ ÷ trade spend — guardrail ${ROI_GUARDRAIL}×`}>ROI</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, limit).map((e) => {
                const c = calc(e);
                return (
                  <tr key={e.id}>
                    <td style={{ padding: "9px 14px", minWidth: 200 }}>
                      <b>{e.title}</b>
                      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {e.brand}{e.origin !== "manual" ? ` · ${e.origin === "carry" ? `carried FY${plan.priorYear}` : "imported"}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "9px 14px" }}>{e.customer}<div style={{ fontSize: 11, color: "var(--ink-3)" }}>{e.perf}</div></td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{e.start} → {e.end}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.weeks}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.base === null ? "—" : fmtK(c.base)}</td>
                    <td style={{ padding: "6px 14px", textAlign: "right" }}>
                      <input
                        style={{ ...selStyle, width: 74, padding: "4px 7px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        type="number"
                        step="1"
                        value={e.lift_pct ?? ""}
                        placeholder="—"
                        title="Expected % lift over base — edit to override"
                        onChange={(ev) => void setLift(e, ev.target.value)}
                      />
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.incr === null ? "—" : fmtK(c.incr)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(e.spend)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right" }}>{roiCell(c.roi)}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span className="minichip" style={{ cursor: "pointer" }} title="Remove this event from the plan"
                        onClick={() => deletePlanEvent(e.id, year).then(setEvents)}>✕</span>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={10} style={{ padding: "18px 16px", color: "var(--ink-3)", fontSize: 12.5 }}>
                  The {year} book is empty{brandChip !== "All brands" ? ` for ${brandChip}` : ""}. Start with
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
          <h3>Monthly spend — {year} plan vs FY{plan.priorYear} book</h3>
          <span className="sub">bars green where the plan funds a month at least as hard as last year · follows the filters</span>
        </div>
        <div className="chartbox" style={{ height: 240 }}>
          <Chart
            type="bar"
            key={"yoy" + tick + brandChip + visible.length + committed}
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
                  type: "line" as const,
                  label: `FY${plan.priorYear} book`,
                  data: plan.priorPlannedByMonth,
                  borderColor: cssToken("--ink-3"),
                  backgroundColor: cssToken("--ink-3"),
                  borderDash: [6, 4],
                  borderWidth: 1.6,
                  pointRadius: 0,
                  tension: 0.2,
                },
              ],
            }}
            options={gridOptions()}
          />
        </div>
        <div className="note">
          ◇ A red month is funded lighter than the same month of the FY{plan.priorYear} book in this scope — room for
          an event, or a deliberate cut. Amounts spread evenly across each event&apos;s window. Base and lift figures come
          from the NIQ history for the divisions in scope (brand weekly run-rate × window weeks); item-level planning
          for a single customer lives in the Base &amp; Lift Lab&apos;s plan view.
        </div>
      </div>
    </div>
  );
}
