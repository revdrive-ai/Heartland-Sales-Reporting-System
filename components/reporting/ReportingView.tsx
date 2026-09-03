"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Bar, Line } from "react-chartjs-2";
import WorkflowStrip from "@/components/WorkflowStrip";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";

/* Sales Dashboard, draft 1 on the real NIQ pull. Headline = own brands in
   measured Albertsons retail; the competitive set appears as share and as a
   context row on the brand cut, never mixed into the headline. */

export type ReportingData = {
  markets: { code: string; name: string }[];
  ownBrands: string[];
  mkt: string;
  brand: string;
  win: 13 | 26 | 52;
  years: number[];                       // plan years looking forward (2027, 2028, …)
  plan: { year: number; priorYear: number; matchedWeeks: number } | null;
  windowLabel: string;
  weeks: string[];
  seriesTY: number[];
  seriesLY: (number | null)[];           // null past the prior year's measured weeks (plan mode)
  kpis: {
    dollars: number; dollarsYoY: number | null;
    units: number; unitsYoY: number | null;
    price: number | null; priceYoY: number | null;
    share: number | null; sharePts: number | null;
  };
  brandRows: { name: string; ty: number; ly: number }[];
  groupRows: { name: string; ty: number; ly: number }[];
  groupKind: "division" | "category";
  topMovers: { upc: string; name: string; brand: string; ty: number; ly: number; delta: number }[];
};

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

const fmtUnits = (v: number) =>
  Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3).toLocaleString() + "K" : String(Math.round(v));

function YoY({ v, suffix = "% YoY" }: { v: number | null; suffix?: string }) {
  if (v === null) return <span className="k-sub flat">no year-ago basis</span>;
  const up = v >= 0;
  return (
    <span className={"k-sub " + (up ? "up" : "down")}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}{suffix}
    </span>
  );
}

export default function ReportingView({ data }: { data: ReportingData }) {
  const tick = useThemeTick();
  const router = useRouter();

  const nav = (patch: Partial<Record<"mkt" | "brand" | "win", string>>) => {
    const p = new URLSearchParams({ mkt: data.mkt, brand: data.brand, win: String(data.win), ...patch });
    router.push(`/reporting?${p.toString()}`);
  };

  const scopeName = data.markets.find((m) => m.code === data.mkt)?.name ?? data.mkt;
  const brandName = data.brand === "ALL" ? "all own brands" : data.brand;

  const opts = useMemo(() => {
    const o = gridOptions();
    return { ...o, interaction: { mode: "index" as const, intersect: false } };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const hOpts = useMemo(() => ({ ...gridOptions(), indexAxis: "y" as const }), [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view active">
      <WorkflowStrip current="reporting" />

      <div className="pagehead">
        <div>
          <div className="crumb">Trade Workflow · Step 3{data.plan ? " · Plan year" : ""}</div>
          <h1>Sales Dashboard{data.plan ? ` — ${data.plan.year} plan` : ""}</h1>
          <p>
            {data.plan ? (
              <>The {data.plan.year} plan base for {brandName} at {scopeName} — the {data.plan.priorYear} actual base
              carried in as far as it has actualized ({data.plan.matchedWeeks} weeks), the rest projected by each
              division&apos;s seasonality — read against prior-year actual sales.</>
            ) : (
              <>Measured retail for {brandName} at {scopeName} — NIQ weekly data, last {data.win} weeks against the
              same weeks a year earlier. The competitive set shows up as share, never in the headline.</>
            )}
          </p>
        </div>
        <div className="actions">
          <span className="pill">{data.windowLabel}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", marginBottom: 16 }}>
        <select style={selStyle} value={data.mkt} onChange={(e) => nav({ mkt: e.target.value })}>
          {data.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
        <select style={selStyle} value={data.brand} onChange={(e) => nav({ brand: e.target.value })}>
          <option value="ALL">All own brands</option>
          {data.ownBrands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select
          style={selStyle}
          value={data.plan ? String(data.plan.year) : String(data.win)}
          onChange={(e) => nav({ win: e.target.value })}
          title="Measured windows, or a forward plan year compared to the prior year"
        >
          <option value="13">Last 13 weeks</option>
          <option value="26">Last 26 weeks</option>
          <option value="52">Last 52 weeks</option>
          {data.years.map((y) => <option key={y} value={String(y)}>Plan {y} vs prior year</option>)}
        </select>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">{data.plan ? "Plan base dollars — full year" : "Retail dollars"}</span></div>
          <div className="k-val">{fmtMoney(data.kpis.dollars)}</div>
          <YoY v={data.kpis.dollarsYoY} suffix={data.plan ? "% vs latest 52 wks sold" : "% YoY"} />
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">{data.plan ? "Plan base units" : "Units"}</span></div>
          <div className="k-val">{fmtUnits(data.kpis.units)}</div>
          <YoY v={data.kpis.unitsYoY} suffix={data.plan ? "% vs latest 52 wks" : "% YoY"} />
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Avg price / unit</span></div>
          <div className="k-val">{data.kpis.price === null ? "—" : "$" + data.kpis.price.toFixed(2)}</div>
          <YoY v={data.kpis.priceYoY} suffix={data.plan ? "% vs latest 52 wks" : "% YoY"} />
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Share of measured set</span></div>
          <div className="k-val">{data.kpis.share === null ? "—" : data.kpis.share.toFixed(1) + "%"}</div>
          {data.plan
            ? <span className="k-sub flat">no plan for the competitive set</span>
            : data.brand === "ALL"
            ? <YoY v={data.kpis.sharePts} suffix=" pts YoY" />
            : <span className="k-sub flat">share reads at all-own-brands scope</span>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <b>{data.plan
          ? `Weekly base dollars — ${data.plan.year} plan vs ${data.plan.priorYear} actuals`
          : "Weekly retail dollars — this year vs same weeks last year"}</b>
        <div className="chartbox" style={{ height: 300, marginTop: 12 }}>
          <Line
            key={"t" + tick + data.mkt + data.brand + data.win + (data.plan?.year ?? "")}
            data={{
              labels: data.weeks.map((w) => w.slice(5)),
              datasets: [
                {
                  label: data.plan ? `${data.plan.year} plan base` : "This year",
                  data: data.seriesTY,
                  borderColor: cssToken("--accent"),
                  backgroundColor: cssToken("--accent"),
                  borderWidth: 2, tension: 0.25, pointRadius: 0, pointHoverRadius: 4,
                },
                {
                  label: data.plan ? `${data.plan.priorYear} actuals` : "Year ago",
                  data: data.seriesLY,
                  borderColor: cssToken("--ink-3"),
                  backgroundColor: cssToken("--ink-3"),
                  borderDash: [6, 4], borderWidth: 1.6, tension: 0.25, pointRadius: 0, pointHoverRadius: 4,
                  spanGaps: false,
                },
              ],
            }}
            options={opts}
          />
        </div>
        <div className="note">
          {data.plan
            ? <>◇ The plan line is base only (no promo lift): {data.plan.priorYear} actual base for its measured weeks,
              seasonality-shaped projection after. The dashed line is what actually sold in the matching weeks a year
              earlier — it stops where {data.plan.priorYear} data ends and fills in as weeks land.</>
            : <>◇ Year-ago is the identical NIQ weeks shifted 52 — holiday weeks line up with holiday weeks.</>}
        </div>
      </div>

      <div className="grid2b">
        <div className="card">
          <b>{data.plan ? `Portfolio by brand — ${data.plan.year} plan vs latest 52 measured weeks` : "Portfolio by brand — this year vs year ago"}</b>
          <div className="chartbox" style={{ marginTop: 12, height: 46 + data.brandRows.length * 44 }}>
            <Bar
              key={"b" + tick + data.mkt + data.win}
              data={{
                labels: data.brandRows.map((b) => b.name),
                datasets: [
                  { label: data.plan ? `${data.plan.year} plan` : "This year", data: data.brandRows.map((b) => b.ty),
                    backgroundColor: data.brandRows.map((b) => b.name === "Competitive set" ? cssToken("--ink-3") : cssToken("--accent")),
                    borderRadius: 5 },
                  { label: data.plan ? "Latest 52 wks actual" : "Year ago", data: data.brandRows.map((b) => b.ly),
                    backgroundColor: cssToken("--line"), borderRadius: 5 },
                ],
              }}
              options={hOpts}
            />
          </div>
          <div className="note">
            {data.plan
              ? <>◇ Full-year plan base per brand against the most recent complete 52 weeks of measured sales.</>
              : <>◇ The brand cut always spans every own brand; the grey competitive row is context for the share number.</>}
          </div>
        </div>

        <div className="card">
          <b>{data.groupKind === "division" ? "Sales by division" : "Sales by category"}{data.plan ? ` — ${data.plan.year} plan vs latest 52 measured weeks` : " — this year vs year ago"}</b>
          <div className="chartbox" style={{ marginTop: 12, height: 46 + data.groupRows.length * (data.groupKind === "division" ? 30 : 44) }}>
            <Bar
              key={"g" + tick + data.mkt + data.brand + data.win}
              data={{
                labels: data.groupRows.map((g) => g.name.replace("Albertsons ", "")),
                datasets: [
                  { label: data.plan ? `${data.plan.year} plan` : "This year", data: data.groupRows.map((g) => g.ty), backgroundColor: cssToken("--accent"), borderRadius: 5 },
                  { label: data.plan ? "Latest 52 wks actual" : "Year ago", data: data.groupRows.map((g) => g.ly), backgroundColor: cssToken("--line"), borderRadius: 5 },
                ],
              }}
              options={hOpts}
            />
          </div>
          <div className="note">
            {data.plan
              ? "◇ Full-year plan base per division against its most recent 52 measured weeks."
              : data.groupKind === "division"
              ? "◇ Pick a division above to swap this cut for categories within it."
              : "◇ Categories within this division; choose All divisions for the division cut."}
          </div>
        </div>
      </div>

      {data.plan ? (
        <div className="card" style={{ marginTop: 16 }}>
          <b>Item-level planning</b>
          <div className="note" style={{ marginTop: 8 }}>
            ◇ This dashboard plans at brand × division altitude. For item-level plan curves and adjustments
            (distribution, price, trend) open the <b>Base &amp; Lift Lab</b> and pick Total year {data.plan.year}; the
            promotional book for {data.plan.year} builds in the <b>Promotion Planner</b>&apos;s plan mode.
          </div>
        </div>
      ) : (
      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <b>Item movers — biggest year-over-year dollar swings</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{brandName} · {scopeName}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Brand</th>
                <th style={{ textAlign: "right" }}>This year</th>
                <th style={{ textAlign: "right" }}>Year ago</th>
                <th style={{ textAlign: "right" }}>Δ $</th>
                <th style={{ textAlign: "right" }}>Δ %</th>
              </tr>
            </thead>
            <tbody>
              {data.topMovers.map((m) => {
                const up = m.delta >= 0;
                const dpct = m.ly > 0 ? (m.delta / m.ly) * 100 : null;
                return (
                  <tr key={m.upc}>
                    <td style={{ padding: "9px 14px" }}>
                      {m.name}
                      <span style={{ color: "var(--ink-3)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}> {m.upc}</span>
                    </td>
                    <td style={{ padding: "9px 14px" }}>{m.brand}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.ty)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(m.ly)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: up ? "var(--good)" : "var(--bad)" }}>
                      {up ? "+" : "−"}{fmtMoney(Math.abs(m.delta)).replace("$", "$")}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: up ? "var(--good)" : "var(--bad)", fontWeight: 700 }}>
                      {dpct === null ? "new" : (up ? "+" : "−") + Math.abs(dpct).toFixed(0) + "%"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ padding: "10px 16px" }}>
          ◇ Top gainers and decliners by dollar change vs the same weeks last year. &quot;new&quot; = no year-ago sales on file.
        </div>
      </div>
      )}
    </div>
  );
}
