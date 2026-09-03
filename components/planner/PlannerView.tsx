"use client";

import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import WorkflowStrip from "@/components/WorkflowStrip";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";
import { LinesTable, STATUS_STYLE, usePromoLines } from "./lines";
import PromoCalendar from "./PromoCalendar";
import PlanBook from "./PlanBook";
import type { PromoLine, PromoMeta } from "@/lib/types/db";

/* Promotion Planner, draft 1 on the real Telus FY2026 snapshot.
   Two modes over the same filtered book: the table ("Book") and the Gantt
   calendar ("Calendar"). Read-only for now — planning actions (new event
   wizard, amendments, guardrails) layer on once the Base & Lift side exists. */

export type PromoRow = {
  id: string; title: string; status: string; perf: string; template: string;
  customer: string; channel: string; market: string;
  start: string; end: string; lines: number; planned: number; actual: number;
};

export type PlannerData = {
  meta: PromoMeta;
  scopeLabel?: string;
  years: number[];           // Telus book year + future plan years, in perpetuity
  year: number;              // the selected year
  plan?: {                   // present when a future year is selected — the plan builder
    year: number;
    priorYear: number;
    priorPlannedByMonth: number[];
    priorPlannedTotal: number;
    brandStats: Record<string, {
      weeklyBaseUnits: number; price: number; avgLift: number;
      items: { upc: string; name: string; wk: number }[];  // per-item weekly base in scope
    }>;
    customers: { id: string; name: string }[];
    copySource: { title: string; customer_id: string; customer: string; perf: string; start: string; end: string; planned: number }[];
    scopeActive: boolean;
  };
  byStatus: Record<string, number>;
  months: string[];
  plannedByMonth: number[];
  actualByMonth: number[];
  topCustomers: { name: string; planned: number; actual: number; promos: number }[];
  statuses: string[];
  perfTypes: string[];
  channels: string[];
  markets: string[];
  rows: PromoRow[];
};

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

type SortKey = "start" | "end" | "planned" | "actual" | "customer" | "status" | "lines" | "consumed";

export default function PlannerView({ data }: { data: PlannerData }) {
  const tick = useThemeTick();
  const [mode, setMode] = useState<"book" | "calendar">("book");
  const [status, setStatus] = useState("");
  const [perf, setPerf] = useState("");
  const [channel, setChannel] = useState("");
  const [market, setMarket] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "planned", dir: -1 });
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null);
  const { lines, load } = usePromoLines();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = data.rows.filter(
      (r) =>
        (!status || r.status === status) &&
        (!perf || r.perf === perf) &&
        (!channel || r.channel === channel) &&
        (!market || r.market === market) &&
        (!needle || r.title.toLowerCase().includes(needle) || r.customer.toLowerCase().includes(needle) || r.id.toLowerCase().includes(needle))
    );
    const val = (r: PromoRow): number | string => {
      if (sort.key === "consumed") return r.planned > 0 ? r.actual / r.planned : r.actual > 0 ? Infinity : -1;
      return r[sort.key];
    };
    return rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * sort.dir;
    });
  }, [data.rows, status, perf, channel, market, q, sort]);

  const fPlanned = filtered.reduce((a, r) => a + r.planned, 0);
  const fActual = filtered.reduce((a, r) => a + r.actual, 0);

  const toggleRow = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) void load(next);
  };

  const th = (label: string, key?: SortKey, right?: boolean) => (
    <th
      style={{ textAlign: right ? "right" : "left", cursor: key ? "pointer" : undefined, userSelect: "none" }}
      onClick={key ? () => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 })) : undefined}
    >
      {label}{key && sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const consumedPct = data.meta.planned_total ? (data.meta.actual_total / data.meta.planned_total) * 100 : 0;

  // A future year selected → the forward plan builder takes over the page.
  if (data.plan) return <PlanBook data={data} />;

  return (
    <div className="view active">
      <WorkflowStrip current="planner" />

      <div className="pagehead">
        <div>
          <div className="crumb">Trade Workflow · Step 2</div>
          <h1>Promotion Planner</h1>
          <p>
            The FY{data.meta.fiscal_year} promotion book from Telus — {data.meta.promotions.toLocaleString()} promotions,{" "}
            {data.meta.promo_lines.toLocaleString()} component lines. Snapshot {data.meta.snapshot_date}; re-imports upsert
            on promo and line keys.
          </p>
        </div>
        <div className="actions">
          {data.scopeLabel && <span className="pill" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Scope: {data.scopeLabel}</span>}
          <select
            style={selStyle}
            value={String(data.year)}
            onChange={(e) => { window.location.href = `/planner?yr=${e.target.value}`; }}
            title="FY2026 monitors the booked Telus plan; a future year opens the plan builder"
          >
            {data.years.map((y) => (
              <option key={y} value={String(y)}>{y === data.meta.fiscal_year ? `FY${y} (Telus book)` : `Plan ${y}`}</option>
            ))}
          </select>
          <span className="pill">Source: Telus export · {data.meta.snapshot_date}</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">Planned trade — FY{data.meta.fiscal_year}</span></div>
          <div className="k-val">{fmtMoney(data.meta.planned_total)}</div>
          <div className="k-sub flat">{data.meta.promotions.toLocaleString()} promotions · {data.meta.promo_lines.toLocaleString()} lines</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Actual spend to date</span></div>
          <div className="k-val">{fmtMoney(data.meta.actual_total)}</div>
          <div className="k-sub flat">{consumedPct.toFixed(1)}% of plan consumed at snapshot</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Active now</span></div>
          <div className="k-val">{(data.byStatus["Active"] ?? 0).toLocaleString()}</div>
          <div className="k-sub flat">{data.byStatus["Expiring"] ?? 0} expiring · {data.byStatus["Expired"] ?? 0} expired</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Pre-active (upcoming)</span></div>
          <div className="k-val">{(data.byStatus["Pre-Active"] ?? 0).toLocaleString()}</div>
          <div className="k-sub flat">windows not yet open at snapshot</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <b>Trade spend by month — planned vs actual pace</b>
          <div className="chartbox" style={{ marginTop: 12 }}>
            <Bar
              key={"m" + tick}
              data={{
                labels: data.months,
                datasets: [
                  { label: "Planned", data: data.plannedByMonth, backgroundColor: cssToken("--accent"), borderRadius: 6 },
                  { label: "Actual (paced)", data: data.actualByMonth, backgroundColor: cssToken("--good"), borderRadius: 6 },
                ],
              }}
              options={gridOptions()}
            />
          </div>
          <div className="note">
            ◇ Amounts are spread evenly across each promotion&apos;s window (actuals across the elapsed window to{" "}
            {data.meta.snapshot_date}) — a timing approximation until deduction-level data lands.
          </div>
        </div>
        <div className="card">
          <b>Top 10 customers by planned trade</b>
          <div className="chartbox" style={{ marginTop: 12 }}>
            <Bar
              key={"c" + tick}
              data={{
                labels: data.topCustomers.map((c) => c.name.length > 22 ? c.name.slice(0, 21) + "…" : c.name),
                datasets: [
                  { label: "Planned", data: data.topCustomers.map((c) => c.planned), backgroundColor: cssToken("--accent"), borderRadius: 5 },
                  { label: "Actual", data: data.topCustomers.map((c) => c.actual), backgroundColor: cssToken("--good"), borderRadius: 5 },
                ],
              }}
              options={{ ...gridOptions(), indexAxis: "y" as const }}
            />
          </div>
          <div className="note">◇ {data.topCustomers.length} of {new Set(data.rows.map((r) => r.customer)).size} customers carrying FY{data.meta.fiscal_year} promotions.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 0, border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
            {(["book", "calendar"] as const).map((m) => (
              <button
                key={m}
                className="btn"
                onClick={() => setMode(m)}
                style={{
                  border: "none", borderRadius: 0, padding: "8px 14px",
                  background: mode === m ? "var(--brand)" : "transparent",
                  color: mode === m ? "var(--brand-ink)" : "var(--ink-2)",
                }}
                aria-pressed={mode === m}
              >
                {m === "book" ? "Book" : "Calendar"}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(100); }}
            placeholder="Search title, customer, promo ID…"
            style={{ ...selStyle, minWidth: 220, fontWeight: 500 }}
          />
          <select style={selStyle} value={status} onChange={(e) => { setStatus(e.target.value); setLimit(100); }}>
            <option value="">All statuses</option>
            {data.statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select style={selStyle} value={perf} onChange={(e) => { setPerf(e.target.value); setLimit(100); }}>
            <option value="">All performance types</option>
            {data.perfTypes.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select style={selStyle} value={channel} onChange={(e) => { setChannel(e.target.value); setLimit(100); }}>
            <option value="">Both channels</option>
            {data.channels.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select style={selStyle} value={market} onChange={(e) => { setMarket(e.target.value); setLimit(100); }}>
            <option value="">All markets</option>
            {data.markets.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
            {filtered.length.toLocaleString()} promotions · {fmtMoney(fPlanned)} planned · {fmtMoney(fActual)} actual
          </span>
        </div>

        {mode === "calendar" ? (
          <PromoCalendar rows={filtered} snapshot={data.meta.snapshot_date} />
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {th("Promo")}
                    {th("Customer", "customer")}
                    {th("Status", "status")}
                    {th("Type")}
                    {th("Window", "start")}
                    {th("Lines", "lines", true)}
                    {th("Planned", "planned", true)}
                    {th("Actual", "actual", true)}
                    {th("Consumed", "consumed", true)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, limit).map((r) => (
                    <PromoTr
                      key={r.id}
                      r={r}
                      consumed={r.planned > 0 ? (r.actual / r.planned) * 100 : null}
                      isOpen={open === r.id}
                      rowLines={lines[r.id]}
                      onToggle={() => toggleRow(r.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {filtered.length > limit && (
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
                <button className="btn" onClick={() => setLimit((l) => l + 300)}>
                  Show more — {filtered.length - limit} remaining
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromoTr({
  r, consumed, isOpen, rowLines, onToggle,
}: {
  r: PromoRow; consumed: number | null;
  isOpen: boolean; rowLines: PromoLine[] | "loading" | undefined; onToggle: () => void;
}) {
  const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.Expired;
  const td: React.CSSProperties = { padding: "10px 14px", borderBottom: "1px solid var(--line)", verticalAlign: "top" };
  const right: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: isOpen ? "var(--surface-2)" : undefined }}>
        <td style={{ ...td, minWidth: 220 }}>
          <b>{r.title}</b>
          <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "ui-monospace, Menlo, monospace" }}>{r.id}</div>
        </td>
        <td style={td}>
          {r.customer}
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.channel} · {r.market}</div>
        </td>
        <td style={td}>
          <span className="badge" style={{ background: st.bg, color: st.fg }}>{r.status}</span>
        </td>
        <td style={td}>
          {r.perf}
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.template}</div>
        </td>
        <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.start} → {r.end}</td>
        <td style={right}>{r.lines}</td>
        <td style={right}>{fmtMoney(r.planned)}</td>
        <td style={right}>{fmtMoney(r.actual)}</td>
        <td style={right}>
          {consumed === null ? (r.actual > 0 ? <span style={{ color: "var(--warn)", fontWeight: 700 }}>unplanned</span> : "—")
            : <span style={{ color: consumed > 110 ? "var(--bad)" : "var(--ink)", fontWeight: 700 }}>{consumed.toFixed(0)}%</span>}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={9} style={{ padding: 0, borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <LinesTable rows={rowLines} />
          </td>
        </tr>
      )}
    </>
  );
}
