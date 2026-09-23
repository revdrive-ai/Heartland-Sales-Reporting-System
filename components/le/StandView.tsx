"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Chart } from "react-chartjs-2";
import { cssToken, gridOptions, useThemeTick } from "@/components/charts/themed";
import { parseWorkPath, processPath } from "@/lib/process";

/* Where the year stands — see app/stand/page.tsx.

   Four cards, one per number the estimate is worked in, each the FULL YEAR
   as it stands now (actuals to date + the estimate to go) against the plan,
   last year and the last locked estimate; then the same by month, and by
   brand. Everything reads for one account. */

export type StandKpi = { fy: number; plan: number; ly: number | null; lastLE: number | null; ytd?: number; ytdLy?: number };

export type StandData = {
  year: number;
  customers: number;
  scopeLabel: string;
  account: null | {
    code: string;
    name: string;
    priorYear: number;
    edge: string;
    edgeMonth: number;
    edgeComplete: boolean;
    planGrowth: number;
    cycle: { due: string; open: string; lockDate: string; daysToLock: number } | null;
    months: string[];
    kpis: { units: StandKpi; gross: StandKpi; trade: StandKpi; margin: StandKpi };
    series: {
      actU: number[]; fcU: number[]; planU: number[]; lyU: number[];
      act$: number[]; fc$: number[]; plan$: number[]; ly$: number[];
      lastLeU: number[] | null;
      trade: number[];
    };
    brands: { brand: string; ytd: number; ytdLy: number; fy: number; plan: number; ly: number; gross: number; planGross: number; lyGross: number }[];
    lastLE: { label: string; takenAt: string } | null;
    adjustments: number;
  };
};

const fmtU = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3).toLocaleString()}K` : String(Math.round(v));
const fmt$ = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1e3).toLocaleString()}K` : `$${Math.round(x)}`;
  return v < 0 ? `−${t}` : t;
};
const pct = (now: number, base: number | null) => (base ? (now / base - 1) * 100 : null);

/** "+2.4% vs plan 1.20M" — coloured only when a direction is good or bad. */
function Vs({ now, base, label, fmt, up = "good" }: { now: number; base: number | null; label: string; fmt: (v: number) => string; up?: "good" | "neutral" }) {
  const d = pct(now, base);
  const color = d === null || up === "neutral" || Math.abs(d) < 0.05 ? "var(--ink-2)" : d > 0 ? "var(--good)" : "var(--bad)";
  return (
    <div className="k-sub">
      <b style={{ color }}>{d === null ? "—" : Math.abs(d) < 0.05 ? "0.0%" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`}</b>
      <span style={{ color: "var(--ink-3)" }}> vs {label}{base !== null ? ` ${fmt(base)}` : ""}</span>
    </div>
  );
}

export default function StandView({ data }: { data: StandData }) {
  const pathname = usePathname();
  const loc = parseWorkPath(pathname);
  const stepHref = (key: string) => (loc ? processPath(loc.proc.kind, key) : null);
  const tick = useThemeTick();
  const [metric, setMetric] = useState<"units" | "gross">("units");

  const a = data.account;
  if (!a) {
    return (
      <div className="view active">
        <div className="pagehead">
          <div><h1>Where the year stands — FY{data.year}</h1></div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div className="note" style={{ marginTop: 0, fontSize: 13 }}>
            ◇ The estimate is worked one account at a time. The top bar is on <b>{data.scopeLabel}</b>
            {data.customers ? <>, which is {data.customers} accounts</> : null} — pick one under <b>Account</b> and
            this page reads that account&apos;s year.
          </div>
        </div>
      </div>
    );
  }

  const k = a.kpis;
  const year = data.year;
  const ly = `FY${a.priorYear}`;
  const remaining = 12 - a.edgeMonth - (a.edgeComplete ? 1 : 0);
  const edgeMonthName = a.months[a.edgeMonth];

  // chart: measured months as solid bars, the estimate as lighter bars, the
  // yardsticks as lines — each in a stack of its own, since a stacked axis
  // would otherwise pile the lines on top of one another
  const isU = metric === "units";
  const act = isU ? a.series.actU : a.series.act$;
  const fc = isU ? a.series.fcU : a.series.fc$;
  const plan = isU ? a.series.planU : a.series.plan$;
  const lyS = isU ? a.series.lyU : a.series.ly$;
  const fmt = isU ? fmtU : fmt$;
  const accent = cssToken("--accent"), ink = cssToken("--ink"), ink3 = cssToken("--ink-3"), warn = cssToken("--warn");
  const datasets: object[] = [
    { type: "bar", label: `FY${year} actual`, data: act.map((v, i) => (i < a.edgeMonth || (i === a.edgeMonth) ? v : null)), backgroundColor: accent, stack: "ty", order: 2 },
    { type: "bar", label: `FY${year} estimate`, data: fc.map((v, i) => (i >= a.edgeMonth ? v : null)), backgroundColor: accent + "55", borderColor: accent, borderWidth: 1, stack: "ty", order: 2 },
    { type: "line", label: `Plan (${ly} +${(a.planGrowth * 100).toFixed(1)}%)`, data: plan, borderColor: ink, backgroundColor: ink, borderWidth: 2, pointRadius: 2, tension: 0.25, order: 1, stack: "plan" },
    { type: "line", label: ly, data: lyS, borderColor: ink3, backgroundColor: ink3, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.25, order: 1, stack: "ly" },
  ];
  if (isU && a.series.lastLeU) {
    datasets.push({ type: "line", label: a.lastLE?.label ?? "Last LE", data: a.series.lastLeU, borderColor: warn, backgroundColor: warn, borderWidth: 1.5, pointRadius: 0, tension: 0.25, order: 1, stack: "le" });
  }
  const opts = gridOptions();
  const chartOpts = {
    ...opts,
    scales: {
      x: { ...opts.scales.x, stacked: true },
      y: { ...opts.scales.y, stacked: true, ticks: { ...opts.scales.y.ticks, callback: (v: number | string) => fmt(+v) } },
    },
    plugins: { ...opts.plugins, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${c.parsed.y === null ? "—" : fmt(c.parsed.y)}` } } },
  };

  const gapU = k.units.fy - k.units.plan;

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <h1>Where the year stands — FY{year}</h1>
          <p>
            <b>{a.name}</b>: actuals through <b>{a.edge}</b>{a.edgeComplete ? "" : ` (${edgeMonthName} is part-measured)`}, then the estimate to
            year-end — last year&apos;s shape at this year&apos;s run-rate, with the promotions still to run. The plan is {ly} NIQ
            units plus {(a.planGrowth * 100).toFixed(1)}%, priced at this year&apos;s list. This is what the month starts from.
          </p>
        </div>
        <div className="actions">
          <span className="pill">NIQ through {a.edge}</span>
          {a.cycle && (
            <span className="pill" title={`${a.cycle.due} is the estimate on record; ${a.cycle.open} locks at the end of ${a.cycle.lockDate}.`}>
              {a.cycle.open} locks {a.cycle.lockDate} · {a.cycle.daysToLock}d
            </span>
          )}
          {a.lastLE
            ? <span className="pill" style={{ borderColor: "var(--good)", color: "var(--good)" }}>✓ {a.lastLE.label} on record</span>
            : <span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>no estimate locked yet</span>}
        </div>
      </div>

      <div className="revfin-head">
        <b>Full year FY{year}</b>
        <span>actuals to date + estimate to go · {remaining} month{remaining === 1 ? "" : "s"} still to come · margin is after trade</span>
      </div>
      <div className="kpis stand">
        <div className="kpi">
          <div className="k-top"><span className="k-label">Units</span></div>
          <div className="k-val">{fmtU(k.units.fy)}</div>
          <Vs now={k.units.fy} base={k.units.plan} label="plan" fmt={fmtU} />
          <Vs now={k.units.fy} base={k.units.ly} label={ly} fmt={fmtU} />
          {k.units.lastLE !== null && <Vs now={k.units.fy} base={k.units.lastLE} label={a.lastLE?.label ?? "last LE"} fmt={fmtU} up="neutral" />}
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>
            YTD {fmtU(k.units.ytd ?? 0)} · {ly} same weeks {fmtU(k.units.ytdLy ?? 0)}
            {k.units.ytdLy ? <b style={{ color: (k.units.ytd ?? 0) >= k.units.ytdLy ? "var(--good)" : "var(--bad)", marginLeft: 4 }}>
              {((k.units.ytd ?? 0) / k.units.ytdLy - 1) >= 0 ? "+" : "−"}{Math.abs(((k.units.ytd ?? 0) / k.units.ytdLy - 1) * 100).toFixed(1)}%
            </b> : null}
          </div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Gross sales · at list</span></div>
          <div className="k-val">{fmt$(k.gross.fy)}</div>
          <Vs now={k.gross.fy} base={k.gross.plan} label="plan" fmt={fmt$} />
          <Vs now={k.gross.fy} base={k.gross.ly} label={ly} fmt={fmt$} />
          {k.gross.lastLE !== null && <Vs now={k.gross.fy} base={k.gross.lastLE} label={a.lastLE?.label ?? "last LE"} fmt={fmt$} up="neutral" />}
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>YTD {fmt$(k.gross.ytd ?? 0)} · {ly} same weeks {fmt$(k.gross.ytdLy ?? 0)}</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Trade spend</span></div>
          <div className="k-val">{fmt$(k.trade.fy)}</div>
          <Vs now={k.trade.fy} base={k.trade.plan} label="the Telus book" fmt={fmt$} up="neutral" />
          {k.trade.lastLE !== null && <Vs now={k.trade.fy} base={k.trade.lastLE} label={a.lastLE?.label ?? "last LE"} fmt={fmt$} up="neutral" />}
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>booked in Telus for FY{year} · no {ly} book on file</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Gross margin · after trade</span></div>
          <div className="k-val">
            {fmt$(k.margin.fy)}
            {k.gross.fy > 0 && <span className="k-pct">{((k.margin.fy / k.gross.fy) * 100).toFixed(1)}% of gross</span>}
          </div>
          <Vs now={k.margin.fy} base={k.margin.plan} label="plan" fmt={fmt$} />
          {k.margin.lastLE !== null && <Vs now={k.margin.fy} base={k.margin.lastLE} label={a.lastLE?.label ?? "last LE"} fmt={fmt$} up="neutral" />}
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>gross sales − trade spend · no product cost in the data yet</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-head">
          <h3>By month — FY{year} against the plan and {ly}</h3>
          <span className="sub" style={{ marginLeft: 6 }}>
            solid bars are measured · light bars are the estimate · {gapU >= 0 ? `${fmtU(gapU)} ahead of plan` : `${fmtU(-gapU)} short of plan`} for the year
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 0, border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
            {(["units", "gross"] as const).map((m) => (
              <button key={m} className="minichip" style={{ border: 0, borderRadius: 0, cursor: "pointer", background: metric === m ? "var(--brand-soft)" : "transparent", fontWeight: 700 }} onClick={() => setMetric(m)}>
                {m === "units" ? "Units" : "Gross $"}
              </button>
            ))}
          </div>
        </div>
        <div className="chartbox" style={{ height: 260 }}>
          <Chart key={"stand" + tick + metric} type="bar" data={{ labels: a.months, datasets: datasets as never }} options={chartOpts as never} />
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div className="c-head" style={{ padding: "14px 16px 10px" }}>
          <h3>By brand</h3>
          <span className="sub">units · year to date is the measured weeks, {ly} on the same weeks</span>
        </div>
        <table className="revtable">
          <thead>
            <tr>
              <th>Brand</th>
              <th style={{ textAlign: "right" }}>YTD</th>
              <th style={{ textAlign: "right" }}>vs {ly} YTD</th>
              <th style={{ textAlign: "right" }}>FY estimate</th>
              <th style={{ textAlign: "right" }}>Plan</th>
              <th style={{ textAlign: "right" }}>vs plan</th>
              <th style={{ textAlign: "right" }}>{ly}</th>
              <th style={{ textAlign: "right" }}>vs {ly}</th>
              <th style={{ textAlign: "right" }}>Gross est.</th>
            </tr>
          </thead>
          <tbody>
            {a.brands.map((b) => {
              const dy = pct(b.ytd, b.ytdLy), dp = pct(b.fy, b.plan), dl = pct(b.fy, b.ly);
              const col = (d: number | null) => ({ color: d === null ? "var(--ink-3)" : d >= 0 ? "var(--good)" : "var(--bad)" });
              const show = (d: number | null) => (d === null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`);
              return (
                <tr key={b.brand}>
                  <td><b>{b.brand}</b></td>
                  <td className="num">{Math.round(b.ytd).toLocaleString()}</td>
                  <td className="num" style={col(dy)}>{show(dy)}</td>
                  <td className="num"><b>{Math.round(b.fy).toLocaleString()}</b></td>
                  <td className="num">{Math.round(b.plan).toLocaleString()}</td>
                  <td className="num" style={col(dp)}>{show(dp)}</td>
                  <td className="num">{Math.round(b.ly).toLocaleString()}</td>
                  <td className="num" style={col(dl)}>{show(dl)}</td>
                  <td className="num">{fmt$(b.gross)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>
          ◇ {a.adjustments
            ? `${a.adjustments} base adjustment${a.adjustments === 1 ? "" : "s"} already on this account's estimate.`
            : "No base adjustments on this account's estimate yet."}{" "}
          Next: say whether anything moved this month, and adjust the base for the months still to come.
        </span>
        {stepHref("lebase") && <Link className="btn primary" href={stepHref("lebase")!} style={{ marginLeft: "auto" }}>Adjust the base →</Link>}
      </div>
    </div>
  );
}
