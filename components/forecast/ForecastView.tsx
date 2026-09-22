"use client";

import { Fragment, useMemo, useState } from "react";
import type { ModeKind } from "@/lib/mode";
import { useRouter } from "next/navigation";
import { Bar } from "react-chartjs-2";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";

/* Monthly Forecast Review — the FY forecast by calendar month vs prior-year
   actuals, with each month labeled actual / landing / forecast. Same numbers
   as the Sales Dashboard FY mode, at monthly review altitude. */

import type { LeCompare } from "@/lib/server/leCompare";

export type ForecastData = {
  markets: { code: string; name: string }[];
  heartlandBrands: string[];
  mkt: string;
  brand: string;
  item: string;                 // "ALL" or a UPC — narrows the whole review
  itemName: string | null;
  items: { upc: string; name: string; brand: string }[];
  /** frozen Latest Estimates for the customers in scope, by monthly cycle */
  le: LeCompare | null;
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

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tdc: React.CSSProperties = { padding: "8px 13px", whiteSpace: "nowrap" };
const tdn: React.CSSProperties = { ...tdc, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const deltaColor = (d: number) => (Math.abs(d) < 1 ? "var(--ink-3)" : d > 0 ? "var(--good)" : "var(--bad)");
/* A change of 3,501 units reading "+4K" hides exactly what an LE review is
   looking at, so the comparison keeps a decimal place: two cycles a few
   hundred units apart must not both print as "29K". */
const fmtLE = (v: number) =>
  v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(1) + "K" : Math.round(v).toLocaleString();
const fmtDelta = (d: number) => (Math.abs(d) < 1 ? "—" : `${d > 0 ? "+" : "−"}${fmtLE(Math.abs(d))}`);

const STATUS: Record<string, { label: string; bg: string; fg: string; title: string }> = {
  actual: { label: "actual", bg: "var(--good-soft, rgba(22,163,74,.12))", fg: "var(--good)", title: "Every NIQ week of this month is measured" },
  partial: { label: "landing", bg: "var(--warn-soft, rgba(217,119,6,.12))", fg: "var(--warn)", title: "Some weeks measured, the rest forecast — firms up as NIQ weeks land" },
  forecast: { label: "forecast", bg: "var(--surface-2)", fg: "var(--ink-3)", title: "Past the NIQ data edge — year-ago base × expected Telus window lift" },
};

export default function ForecastView({ data, mode, planYear }: { data: ForecastData; mode: ModeKind; planYear: number }) {
  const tick = useThemeTick();
  const router = useRouter();
  const nav = (patch: Partial<Record<"mkt" | "brand" | "item" | "cmp", string>>) => {
    const p = new URLSearchParams({
      mkt: data.mkt, brand: data.brand, item: data.item,
      cmp: (data.le?.comparisons ?? []).map((c) => c.key).join(","),
      ...patch,
    });
    router.push(`/forecast?${p.toString()}`);
  };
  /** replace one comparison slot; "" clears it */
  const setCmp = (slot: number, key: string) => {
    const keys = (data.le?.comparisons ?? []).map((c) => c.key);
    keys[slot] = key;
    nav({ cmp: keys.filter(Boolean).join(",") });
  };
  const [showValues, setShowValues] = useState(false);
  const le = data.le;
  const scopeName = data.markets.find((m) => m.code === data.mkt)?.name ?? data.mkt;
  const brandName = data.itemName ?? (data.brand === "ALL" ? "all Heartland brands" : data.brand);
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
        <select style={selStyle} value={data.brand} onChange={(e) => nav({ brand: e.target.value, item: "ALL" })}>
          <option value="ALL">All Heartland brands</option>
          {data.heartlandBrands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select
          style={{ ...selStyle, maxWidth: 340 }}
          value={data.item}
          onChange={(e) => nav({ item: e.target.value })}
          title="Narrow the whole review to a single item — every month, the chart and the LE comparison follow"
        >
          <option value="ALL">
            {data.brand === "ALL" ? "All items" : `All ${data.brand} items`} ({data.items.length})
          </option>
          {[...new Set(data.items.map((i) => i.brand))].map((b) => (
            <optgroup key={b} label={b}>
              {data.items.filter((i) => i.brand === b).map((i) => (
                <option key={i.upc} value={i.upc}>{i.name.length > 44 ? i.name.slice(0, 43) + "…" : i.name}</option>
              ))}
            </optgroup>
          ))}
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


      {/* ---- LE comparison: what moved between Latest Estimate cycles ---- */}
      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <b>LE comparison{le ? ` — ${le.latest.label}` : ""}</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {brandName} · {scopeName} · units
          </span>
          {le && le.comparisons.length > 0 && (
            <button
              className="btn"
              style={{ ...selStyle, marginLeft: "auto", cursor: "pointer", padding: "5px 10px" }}
              onClick={() => setShowValues((v) => !v)}
              title={showValues ? "Show only the change against each earlier LE" : "Show each earlier LE's own monthly numbers beside the change"}
            >
              {showValues ? "Δ only" : "Show LE values"}
            </button>
          )}
        </div>

        {!le ? (
          <div className="note" style={{ margin: 0, padding: "16px" }}>
            ◇ No Latest Estimates have been locked for FY{data.fyYear} yet, so there is nothing to compare. The forecast
            locks at the end of the second Friday of each month; run the lock in the <b>Latest Estimate</b> view (Planning
            Tools) and each account&apos;s version freezes that month&apos;s forecast by month and by item. This table then
            shows what moved between any two locks.
          </div>
        ) : (<>
          <div style={{ padding: "11px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>Compare {le.latest.label} against</span>
            {[0, 1, 2].map((slot) => (
              <select
                key={slot}
                style={{ ...selStyle, padding: "6px 9px" }}
                value={le.comparisons[slot]?.key ?? ""}
                onChange={(e) => setCmp(slot, e.target.value)}
                title="An earlier LE — the forecast on record at the end of that month's second Friday, across every account"
              >
                <option value="">— none —</option>
                {le.cycles.filter((c) => c.key !== le.latest.key).map((c) => (
                  <option key={c.key} value={c.key}>{c.label} · locked {c.lockDate}</option>
                ))}
              </select>
            ))}
            <span className="pill" title={`Locked ${le.cycles[0].lockDate} — the forecast on record at the end of that second Friday, across ${le.cycles[0].ofRecord} accounts`}>
              {le.latest.label} · locked {le.cycles[0].lockDate}
            </span>
          </div>

          {le.comparisons.length === 0 ? (
            <div className="note" style={{ margin: 0, padding: "16px" }}>
              ◇ Only one LE cycle on record ({le.latest.label}). Pick an earlier cycle above once a second month has been
              taken — the table then reads month by month, and the movers below name the items behind each change.
            </div>
          ) : (<>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: "right" }}>{le.latest.label}</th>
                  {le.comparisons.map((c) => (
                    <Fragment key={c.key}>
                      {showValues && <th style={{ textAlign: "right" }}>{c.label}</th>}
                      <th style={{ textAlign: "right" }} title={`Change from ${c.label} to ${le.latest.label}`}>Δ vs {c.label.replace("LE ", "")}</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MONTH_NAMES.map((mn, i) => {
                  const cur = le.latest.months[i];
                  const moved = le.comparisons.some((c) => Math.abs(cur - c.months[i]) >= 1);
                  return (
                    <tr key={mn} style={moved ? undefined : { color: "var(--ink-3)" }}>
                      <td style={tdc}>{mn}</td>
                      <td style={{ ...tdn, fontWeight: 700 }}>{cur ? fmtLE(cur) : "—"}</td>
                      {le.comparisons.map((c) => (
                        <Fragment key={c.key}>
                          {showValues && <td style={tdn}>{c.months[i] ? fmtLE(c.months[i]) : "—"}</td>}
                          <td style={{ ...tdn, fontWeight: 700, color: deltaColor(cur - c.months[i]) }}>
                            {fmtDelta(cur - c.months[i])}
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "2px solid var(--line)" }}>
                  <td style={tdc}><b>Full year</b></td>
                  <td style={{ ...tdn, fontWeight: 800 }}>{fmtLE(le.latest.total)}</td>
                  {le.comparisons.map((c) => (
                    <Fragment key={c.key}>
                      {showValues && <td style={{ ...tdn, fontWeight: 700 }}>{fmtLE(c.total)}</td>}
                      <td style={{ ...tdn, fontWeight: 800, color: deltaColor(le.latest.total - c.total) }}>
                        {fmtDelta(le.latest.total - c.total)}
                      </td>
                    </Fragment>
                  ))}
                </tr>
                <tr>
                  <td style={tdc}>vs that LE</td>
                  <td style={tdn}>—</td>
                  {le.comparisons.map((c) => (
                    <Fragment key={c.key}>
                      {showValues && <td style={tdn}>—</td>}
                      <td style={{ ...tdn, color: deltaColor(le.latest.total - c.total) }}>
                        {c.total > 0 ? `${le.latest.total >= c.total ? "+" : "−"}${Math.abs(((le.latest.total - c.total) / c.total) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </Fragment>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="note" style={{ margin: 0, padding: "10px 16px" }}>
            ◇ Every account locks on the same schedule — the forecast on record at the <b>end of the second Friday</b> of
            each month — so each column is the whole portfolio as it stood at that lock. An account whose lock didn&apos;t run
            that month carries its previous number into both sides and nets to zero. Grey months didn&apos;t move. Months
            already closed can still change between locks as NIQ weeks land.
          </div>
          </>)}
        </>)}
      </div>

      {/* ---- which items drove the change ---- */}
      {le && le.comparisons.length > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 16 }}>
          <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
            <b>What moved it — {le.comparisons[0].label} → {le.latest.label}</b>
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
              items ranked by absolute change{data.item !== "ALL" ? " · this item only" : ""}
            </span>
          </div>
          {!le.itemDetail ? (
            <div className="note" style={{ margin: 0, padding: "16px" }}>
              ◇ These LE versions were frozen before per-item detail was recorded, so only the monthly totals above can be
              compared. The next LE taken carries item detail and this table fills in.
            </div>
          ) : le.drivers.length === 0 ? (
            <div className="note" style={{ margin: 0, padding: "16px" }}>◇ No item changed between these two cycles.</div>
          ) : (<>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Brand</th>
                    <th style={{ textAlign: "right" }}>{le.comparisons[0].label}</th>
                    <th style={{ textAlign: "right" }}>{le.latest.label}</th>
                    <th style={{ textAlign: "right" }}>Δ units</th>
                    <th style={{ textAlign: "right" }}>Δ %</th>
                    <th>Biggest month</th>
                  </tr>
                </thead>
                <tbody>
                  {le.drivers.slice(0, 15).map((d) => {
                    let bi = 0;
                    d.months.forEach((v, i) => { if (Math.abs(v) > Math.abs(d.months[bi])) bi = i; });
                    return (
                      <tr key={d.upc}>
                        <td style={{ ...tdc, whiteSpace: "normal", maxWidth: 300 }}>
                          <b>{d.name.length > 52 ? d.name.slice(0, 51) + "…" : d.name}</b>
                        </td>
                        <td style={tdc}>{d.brand}</td>
                        <td style={tdn}>{d.prior ? fmtLE(d.prior) : "—"}</td>
                        <td style={{ ...tdn, fontWeight: 700 }}>{d.latest ? fmtLE(d.latest) : "—"}</td>
                        <td style={{ ...tdn, fontWeight: 800, color: deltaColor(d.delta) }}>{fmtDelta(d.delta)}</td>
                        <td style={{ ...tdn, color: deltaColor(d.delta) }}>
                          {d.prior > 0 ? `${d.delta >= 0 ? "+" : "−"}${Math.abs((d.delta / d.prior) * 100).toFixed(1)}%` : d.latest > 0 ? "new" : "—"}
                        </td>
                        <td style={tdc}>
                          {Math.abs(d.months[bi]) >= 1
                            ? <>{MONTH_NAMES[bi]} <span style={{ color: deltaColor(d.months[bi]), fontWeight: 700 }}>{fmtDelta(d.months[bi])}</span></>
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="note" style={{ margin: 0, padding: "10px 16px" }}>
              ◇ Showing the {Math.min(15, le.drivers.length)} biggest movers of {le.drivers.length}. An item moves between
              cycles when its measured weeks landed differently than forecast, when an LE adjustment was set on it, or when
              distribution changed. Pick the item in the selector above to see its whole year.
            </div>
          </>)}
        </div>
      )}

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
