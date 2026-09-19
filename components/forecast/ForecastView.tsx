"use client";

import { useMemo } from "react";
import type { ModeKind } from "@/lib/mode";
import { useRouter } from "next/navigation";
import { Bar } from "react-chartjs-2";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";

/* Monthly Forecast Review — the FY forecast by calendar month vs prior-year
   actuals, with each month labeled actual / landing / forecast. Same numbers
   as the Sales Dashboard FY mode, at monthly review altitude. */

export type ForecastData = {
  markets: { code: string; name: string }[];
  ownBrands: string[];
  mkt: string;
  brand: string;
  fyYear: number;
  priorYear: number;
  latestWeek: string;
  rows: {
    month: string;
    status: "actual" | "partial" | "forecast";
    measuredWks: number;
    totalWks: number;
    fy: number;      // this year's dollars — measured, or forecast
    fyU: number;
    prior: number;   // prior-year actual dollars, aligned weeks
  }[];
  totals: { fy: number; prior: number; fyU: number; measuredApprox: number };
  brandRows: { name: string; fy: number; prior: number }[];
};

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

const fmtUnits = (v: number) =>
  Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3).toLocaleString() + "K" : String(Math.round(v));

const STATUS: Record<string, { label: string; bg: string; fg: string; title: string }> = {
  actual: { label: "actual", bg: "var(--good-soft, rgba(22,163,74,.12))", fg: "var(--good)", title: "Every NIQ week of this month is measured" },
  partial: { label: "landing", bg: "var(--warn-soft, rgba(217,119,6,.12))", fg: "var(--warn)", title: "Some weeks measured, the rest forecast — firms up as NIQ weeks land" },
  forecast: { label: "forecast", bg: "var(--surface-2)", fg: "var(--ink-3)", title: "Past the NIQ data edge — year-ago base × expected Telus window lift" },
};

export default function ForecastView({ data, mode, planYear }: { data: ForecastData; mode: ModeKind; planYear: number }) {
  const tick = useThemeTick();
  const router = useRouter();
  const nav = (patch: Partial<Record<"mkt" | "brand", string>>) => {
    const p = new URLSearchParams({ mkt: data.mkt, brand: data.brand, ...patch });
    router.push(`/forecast?${p.toString()}`);
  };
  const scopeName = data.markets.find((m) => m.code === data.mkt)?.name ?? data.mkt;
  const brandName = data.brand === "ALL" ? "all own brands" : data.brand;
  const pct = (cur: number, ly: number) => (ly > 0 ? ((cur - ly) / ly) * 100 : null);
  const yoy = pct(data.totals.fy, data.totals.prior);
  const toGo = data.totals.fy - data.totals.measuredApprox;

  const opts = useMemo(() => gridOptions(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const hOpts = useMemo(() => ({ ...gridOptions(), indexAxis: "y" as const }), [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view active">

      <div className="pagehead">
        <div>
          <h1>Monthly Forecast Review</h1>
          <p>
            FY{data.fyYear} month by month for {brandName} at {scopeName} — measured NIQ retail where the month has
            landed, the forecast (year-ago base × expected Telus window lift) where it hasn&apos;t — against{" "}
            {data.priorYear} actuals on the same aligned weeks.
          </p>
        </div>
        <div className="actions">
          {mode === "plan" && (
            <span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
              title={`The monthly review reads actuals against the forecast, so it lives in the in-flight year — Plan ${planYear} has no measured months yet`}>
              Plan — FY{planYear} · showing the in-flight FY{data.fyYear}
            </span>
          )}
          <span className="pill">{mode === "le" ? `LE — FY${data.fyYear} · ` : ""}NIQ data edge · {data.latestWeek}</span>
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
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">FY{data.fyYear} dollars — full year (fcst)</span></div>
          <div className="k-val">{fmtMoney(data.totals.fy)}</div>
          {yoy !== null && (
            <span className={"k-sub " + (yoy >= 0 ? "up" : "down")}>
              {yoy >= 0 ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}% vs {data.priorYear}
            </span>
          )}
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Measured to date</span></div>
          <div className="k-val">{fmtMoney(data.totals.measuredApprox)}</div>
          <div className="k-sub flat">through {data.latestWeek}</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Forecast to go</span></div>
          <div className="k-val">{fmtMoney(toGo)}</div>
          <div className="k-sub flat">rest of {data.fyYear} · Telus windows + base carry</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">FY{data.fyYear} units (fcst)</span></div>
          <div className="k-val">{fmtUnits(data.totals.fyU)}</div>
          <div className="k-sub flat">full-year, measured + forecast</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <b>Monthly retail dollars — FY{data.fyYear} vs {data.priorYear} actuals</b>
        <div className="chartbox" style={{ height: 300, marginTop: 12 }}>
          <Bar
            key={"mf" + tick + data.mkt + data.brand}
            data={{
              labels: data.rows.map((r) => r.month),
              datasets: [
                {
                  label: `FY${data.fyYear}`,
                  data: data.rows.map((r) => r.fy),
                  backgroundColor: data.rows.map((r) =>
                    r.status === "actual" ? cssToken("--accent") : r.status === "partial" ? cssToken("--warn") : cssToken("--accent") + "66"),
                  borderRadius: 5,
                },
                {
                  label: `${data.priorYear} actual`,
                  data: data.rows.map((r) => r.prior),
                  backgroundColor: cssToken("--line"),
                  borderRadius: 5,
                },
              ],
            }}
            options={opts}
          />
        </div>
        <div className="note">
          ◇ Solid blue months are fully measured, the amber month is landing (part measured, part forecast), and the
          translucent months are forecast. Prior-year bars are actuals on the same aligned NIQ weeks.
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <b>Month by month</b>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Month</th><th>Status</th>
                <th style={{ textAlign: "right" }}>FY{data.fyYear} $</th>
                <th style={{ textAlign: "right" }}>{data.priorYear} $</th>
                <th style={{ textAlign: "right" }}>Δ $</th>
                <th style={{ textAlign: "right" }}>Δ %</th>
                <th style={{ textAlign: "right" }}>FY{data.fyYear} units</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const s = STATUS[r.status];
                const d = r.fy - r.prior;
                const dp = r.prior > 0 ? (d / r.prior) * 100 : null;
                return (
                  <tr key={r.month}>
                    <td style={{ padding: "9px 14px", fontWeight: 700 }}>{r.month}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span className="badge" style={{ background: s.bg, color: s.fg }} title={s.title}>
                        {s.label}{r.status === "partial" ? ` · ${r.measuredWks}/${r.totalWks} wks` : ""}
                      </span>
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.fy)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.prior)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: d >= 0 ? "var(--good)" : "var(--bad)" }}>
                      {d >= 0 ? "+" : "−"}{fmtMoney(Math.abs(d))}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: d >= 0 ? "var(--good)" : "var(--bad)", fontWeight: 700 }}>
                      {dp === null ? "—" : (d >= 0 ? "+" : "−") + Math.abs(dp).toFixed(1) + "%"}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUnits(r.fyU)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 800 }}>
                <td style={{ padding: "9px 14px" }}>Full year</td>
                <td style={{ padding: "9px 14px" }} />
                <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(data.totals.fy)}</td>
                <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(data.totals.prior)}</td>
                <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: data.totals.fy - data.totals.prior >= 0 ? "var(--good)" : "var(--bad)" }}>
                  {data.totals.fy - data.totals.prior >= 0 ? "+" : "−"}{fmtMoney(Math.abs(data.totals.fy - data.totals.prior))}
                </td>
                <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (yoy ?? 0) >= 0 ? "var(--good)" : "var(--bad)" }}>
                  {yoy === null ? "—" : ((yoy >= 0 ? "+" : "−") + Math.abs(yoy).toFixed(1) + "%")}
                </td>
                <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtUnits(data.totals.fyU)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note" style={{ padding: "10px 16px" }}>
          ◇ Months split by NIQ week-endings (a Saturday belongs to the month it falls in). The forecast is the same
          construction as the Sales Dashboard&apos;s FY mode and the Base &amp; Lift Total-year view: year-ago NIQ base
          carried forward × the expected lift of the Telus performance windows still open (EDLP/Slotting fund price, no
          lift). Each month firms up as its NIQ weeks land.
        </div>
      </div>

      {data.brand === "ALL" && data.brandRows.length > 1 && (
        <div className="card">
          <b>Full-year FY{data.fyYear} by brand vs {data.priorYear}</b>
          <div className="chartbox" style={{ marginTop: 12, height: 46 + data.brandRows.length * 44 }}>
            <Bar
              key={"bf" + tick + data.mkt}
              data={{
                labels: data.brandRows.map((b) => b.name),
                datasets: [
                  { label: `FY${data.fyYear} fcst`, data: data.brandRows.map((b) => b.fy), backgroundColor: cssToken("--accent"), borderRadius: 5 },
                  { label: `${data.priorYear} actual`, data: data.brandRows.map((b) => b.prior), backgroundColor: cssToken("--line"), borderRadius: 5 },
                ],
              }}
              options={hOpts}
            />
          </div>
        </div>
      )}
    </div>
  );
}
