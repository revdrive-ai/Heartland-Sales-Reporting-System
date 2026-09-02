"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import type { Plugin } from "chart.js";
import WorkflowStrip from "@/components/WorkflowStrip";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";
import { STATUS_STYLE } from "@/components/planner/lines";
import type { PromoOverlay } from "@/lib/repo";

/* Base & Lift Lab, draft 1: the division's weekly trend (actual vs NIQ base)
   with the Telus promotion windows overlaid. Event windows (≤ 12 weeks) are
   shaded on the plot; always-on programs (EDLP and other long runners) are
   listed below and can be shaded on demand — a year-long band over every
   week is noise, not signal. */

export type WeekPoint = { week: string; actual: number; base: number; promoAcv: number };

export type BaseData = {
  markets: { code: string; name: string }[];
  brands: string[];
  mkt: string;
  brand: string;
  metric: "units" | "dollars";
  win: "52w" | "all";
  points: WeekPoint[];
  overlays: PromoOverlay[];
  totals: { actual: number; base: number; incremental: number; niqPromoWeeks: number };
};

const DAY = 86400000;
const EVENT_MAX_DAYS = 84; // ≤ 12 weeks = an event window; longer = always-on

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (isoDate: string) => Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10));
const durationDays = (o: PromoOverlay) => (utc(o.end_date) - utc(o.start_date)) / DAY + 1;

const fmtNum = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3).toLocaleString() + "K" : String(Math.round(v)));

export default function BaseView({ data }: { data: BaseData }) {
  const tick = useThemeTick();
  const router = useRouter();
  const [shadeAlwaysOn, setShadeAlwaysOn] = useState(false);

  const nav = (patch: Partial<Record<"mkt" | "brand" | "metric" | "win", string>>) => {
    const p = new URLSearchParams({ mkt: data.mkt, brand: data.brand, metric: data.metric, win: data.win, ...patch });
    router.push(`/base?${p.toString()}`);
  };

  const events = data.overlays.filter((o) => durationDays(o) <= EVENT_MAX_DAYS);
  const alwaysOn = data.overlays.filter((o) => durationDays(o) > EVENT_MAX_DAYS);

  /* week index ranges each shaded promo covers (a week_ending Saturday covers
     the 7 days ending that day) */
  const bands = useMemo(() => {
    const weekTs = data.points.map((p) => utc(p.week));
    const toBand = (o: PromoOverlay) => {
      const s = utc(o.start_date), e = utc(o.end_date);
      let i0 = -1, i1 = -1;
      weekTs.forEach((w, i) => {
        const overlaps = s <= w && e >= w - 6 * DAY;
        if (overlaps) { if (i0 < 0) i0 = i; i1 = i; }
      });
      return i0 < 0 ? null : { i0, i1 };
    };
    return {
      events: events.map(toBand).filter((b): b is { i0: number; i1: number } => !!b),
      alwaysOn: alwaysOn.map(toBand).filter((b): b is { i0: number; i1: number } => !!b),
    };
  }, [data.points, data.overlays]); // eslint-disable-line react-hooks/exhaustive-deps

  /* promos active per week, for the tooltip */
  const activeByWeek = useMemo(() => {
    return data.points.map((p) => {
      const w = utc(p.week);
      return data.overlays.filter((o) => utc(o.start_date) <= w && utc(o.end_date) >= w - 6 * DAY);
    });
  }, [data.points, data.overlays]);

  const bandPlugin: Plugin<"line"> = useMemo(() => ({
    id: "promoBands",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      if (!x || !chartArea) return;
      const half = data.points.length > 1
        ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2
        : (chartArea.right - chartArea.left) / 2;
      const draw = (list: { i0: number; i1: number }[], color: string, alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        for (const b of list) {
          const x0 = Math.max(x.getPixelForValue(b.i0) - half, chartArea.left);
          const x1 = Math.min(x.getPixelForValue(b.i1) + half, chartArea.right);
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        }
        ctx.restore();
      };
      if (shadeAlwaysOn) draw(bands.alwaysOn, cssToken("--accent"), 0.05);
      draw(bands.events, cssToken("--warn"), 0.16);
    },
  }), [bands, shadeAlwaysOn, data.points.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const liftPct = data.totals.base > 0 ? (data.totals.incremental / data.totals.base) * 100 : 0;
  const marketName = data.markets.find((m) => m.code === data.mkt)?.name ?? data.mkt;
  const fmtVal = data.metric === "dollars" ? fmtMoney : (v: number) => fmtNum(v);

  const opts = useMemo(() => {
    const o = gridOptions();
    return {
      ...o,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        ...o.plugins,
        tooltip: {
          callbacks: {
            afterBody: (items: { dataIndex: number }[]) => {
              const i = items[0]?.dataIndex ?? 0;
              const list = activeByWeek[i] ?? [];
              if (!list.length) return "";
              const names = list.slice(0, 6).map((p) => `• ${p.promo_title} (${p.performance_type})`);
              if (list.length > 6) names.push(`… +${list.length - 6} more`);
              return ["", "Promotions live this week:", ...names].join("\n");
            },
          },
        },
      },
    };
  }, [activeByWeek, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view active">
      <WorkflowStrip current="base" />

      <div className="pagehead">
        <div>
          <div className="crumb">Trade Workflow · Step 1</div>
          <h1>Base &amp; Lift Lab</h1>
          <p>
            NIQ weekly {data.metric} for {data.brand} at {marketName} — actual against NIQ&apos;s modelled base,
            with the Telus promotion windows for this division overlaid. Event windows are shaded;
            always-on programs are listed below.
          </p>
        </div>
        <div className="actions">
          <span className="pill">{data.points[0]?.week} → {data.points.at(-1)?.week}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", marginBottom: 16 }}>
        <select style={selStyle} value={data.mkt} onChange={(e) => nav({ mkt: e.target.value })}>
          {data.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
        <select style={selStyle} value={data.brand} onChange={(e) => nav({ brand: e.target.value })}>
          {data.brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select style={selStyle} value={data.metric} onChange={(e) => nav({ metric: e.target.value })}>
          <option value="units">Units</option>
          <option value="dollars">Dollars</option>
        </select>
        <select style={selStyle} value={data.win} onChange={(e) => nav({ win: e.target.value })}>
          <option value="52w">Latest 52 weeks</option>
          <option value="all">All weeks on file</option>
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginLeft: 6 }}>
          <input type="checkbox" checked={shadeAlwaysOn} onChange={(e) => setShadeAlwaysOn(e.target.checked)} />
          Shade always-on programs
        </label>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">Actual — window total</span></div>
          <div className="k-val">{fmtVal(data.totals.actual)}</div>
          <div className="k-sub flat">{data.brand} · {data.points.length} weeks</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">NIQ modelled base</span></div>
          <div className="k-val">{fmtVal(data.totals.base)}</div>
          <div className="k-sub flat">non-promoted expectation</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Incremental vs base</span></div>
          <div className="k-val" style={{ color: data.totals.incremental >= 0 ? "var(--good)" : "var(--bad)" }}>
            {data.totals.incremental >= 0 ? "+" : "−"}{fmtVal(Math.abs(data.totals.incremental))}
          </div>
          <div className="k-sub flat">{liftPct >= 0 ? "+" : "−"}{Math.abs(liftPct).toFixed(1)}% lift on base</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Promotion windows</span></div>
          <div className="k-val">{data.overlays.length}</div>
          <div className="k-sub flat">{events.length} events · {alwaysOn.length} always-on · NIQ saw promo support in {data.totals.niqPromoWeeks} wks</div>
        </div>
      </div>

      <div className="card">
        <b>Weekly {data.metric} — actual vs NIQ base · Telus event windows shaded</b>
        <div className="chartbox" style={{ height: 320, marginTop: 12 }}>
          <Line
            key={"b" + tick + data.mkt + data.brand + data.metric + data.win + (shadeAlwaysOn ? 1 : 0)}
            plugins={[bandPlugin]}
            data={{
              labels: data.points.map((p) => p.week.slice(5)),
              datasets: [
                {
                  label: "Actual",
                  data: data.points.map((p) => p.actual),
                  borderColor: cssToken("--accent"),
                  backgroundColor: cssToken("--accent"),
                  borderWidth: 2,
                  tension: 0.25,
                  pointRadius: data.points.map((p) => (p.promoAcv >= 10 ? 3 : 0)),
                  pointHoverRadius: 5,
                },
                {
                  label: "NIQ base",
                  data: data.points.map((p) => p.base),
                  borderColor: cssToken("--ink-3"),
                  backgroundColor: cssToken("--ink-3"),
                  borderDash: [6, 4],
                  borderWidth: 1.6,
                  tension: 0.25,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                },
              ],
            }}
            options={opts}
          />
        </div>
        <div className="note">
          ◇ Amber bands are Telus <b>event windows</b> (≤ 12 weeks: TPR, features, shopper programs) mapped to this
          division&apos;s customers, corporate programs included. Dots on the actual line mark weeks where NIQ measured
          promo support on shelf (≥ 10 %ACV) — where a band has no dot, a planned event may not have executed;
          a dot with no band is support Telus doesn&apos;t know about.
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <b>Promotion windows on this trend</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {marketName} · {data.brand} · {fmtMoney(data.overlays.reduce((a, o) => a + o.planned_amount, 0))} planned in scope
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Promotion</th><th>Customer</th><th>Status</th><th>Type</th><th>Window</th>
                <th style={{ textAlign: "right" }}>Weeks</th>
                <th style={{ textAlign: "right" }}>Planned</th>
                <th style={{ textAlign: "right" }}>Actual</th>
              </tr>
            </thead>
            <tbody>
              {data.overlays.map((o) => {
                const st = STATUS_STYLE[o.promo_status] ?? STATUS_STYLE.Expired;
                const days = durationDays(o);
                const isEvent = days <= EVENT_MAX_DAYS;
                return (
                  <tr key={o.promo_id}>
                    <td style={{ padding: "9px 14px" }}>
                      <b>{o.promo_title}</b>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "ui-monospace, Menlo, monospace" }}>
                        {o.promo_id} · {isEvent ? "event" : "always-on"}
                      </div>
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {o.customer_name}
                      {o.corporate && <span className="badge" style={{ marginLeft: 6, background: "var(--surface-2)", color: "var(--ink-3)" }}>corporate</span>}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      <span className="badge" style={{ background: st.bg, color: st.fg }}>{o.promo_status}</span>
                    </td>
                    <td style={{ padding: "9px 14px" }}>{o.performance_type}</td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{o.start_date} → {o.end_date}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(days / 7)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(o.planned_amount)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(o.actual_amount)}</td>
                  </tr>
                );
              })}
              {data.overlays.length === 0 && (
                <tr><td colSpan={8} style={{ padding: "16px", color: "var(--ink-3)", fontSize: 12.5 }}>
                  No Telus promotions map to this division × brand in the window.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
