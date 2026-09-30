"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bar } from "react-chartjs-2";
import { cssToken, gridOptions, useThemeTick } from "@/components/charts/themed";
import WeekNote from "@/components/WeekNote";
import {
  LEADERSHIP_REPORT, PERIODS, fmtFor, fmtPct, pctChange,
  type LeadershipData, type RankRow, type ReportPage, type Selection,
} from "@/lib/leadership/report";

/* The Leadership team report on screen.

   Selectors along the top set one selection for every page; the tabs pick
   the page. "Build the report" shows every page in order, each on its own
   sheet, ready to print — the presentation the President takes to the
   owner. Excel writes the same pages to one workbook. The layout folds to
   a phone: KPI cards two-up, tables scroll sideways with the name column
   held, the chart shortens. */

type Props = { data: LeadershipData; page: string };

function Delta({ cur, ly, small }: { cur: number; ly: number; small?: boolean }) {
  const p = pctChange(cur, ly);
  const color = p === null ? "var(--ink-3)" : Math.abs(p) < 0.05 ? "var(--ink-2)" : p > 0 ? "var(--good)" : "var(--bad)";
  return <b className={small ? "ldr-d small" : "ldr-d"} style={{ color }}>{fmtPct(p)}</b>;
}

function Kpis({ data }: { data: LeadershipData }) {
  const { kpis, period, selection } = data;
  const fm = fmtFor("dollars"), fu = fmtFor("units");
  const lyLabel = period.lyLabel;
  return (
    <div className="kpis ldr-kpis">
      <div className="kpi">
        <div className="k-top"><span className="k-label">Sales · {period.label}</span></div>
        <div className="k-val">{fm(kpis.dollars.cur)}</div>
        <div className="k-sub"><Delta cur={kpis.dollars.cur} ly={kpis.dollars.ly} /><span className="dim"> vs {lyLabel} {fm(kpis.dollars.ly)}</span></div>
      </div>
      <div className="kpi">
        <div className="k-top"><span className="k-label">Units · {period.label}</span></div>
        <div className="k-val">{fu(kpis.units.cur)}</div>
        <div className="k-sub"><Delta cur={kpis.units.cur} ly={kpis.units.ly} /><span className="dim"> vs {lyLabel} {fu(kpis.units.ly)}</span></div>
      </div>
      <div className="kpi">
        <div className="k-top"><span className="k-label">Price per unit</span></div>
        <div className="k-val">{kpis.units.cur ? `$${(kpis.dollars.cur / kpis.units.cur).toFixed(2)}` : "—"}</div>
        <div className="k-sub">
          {kpis.units.ly ? <><Delta cur={kpis.dollars.cur / Math.max(kpis.units.cur, 1)} ly={kpis.dollars.ly / kpis.units.ly} /><span className="dim"> vs {lyLabel} ${(kpis.dollars.ly / kpis.units.ly).toFixed(2)}</span></> : <span className="dim">no year-ago read</span>}
        </div>
      </div>
      <div className="kpi">
        <div className="k-top"><span className="k-label">Selling</span></div>
        <div className="k-val">{kpis.customers} <span className="ldr-unit">customer{kpis.customers === 1 ? "" : "s"}</span></div>
        <div className="k-sub dim">{kpis.items} item{kpis.items === 1 ? "" : "s"} with sales{selection.brand !== "ALL" ? ` · ${selection.brand}` : ""}</div>
      </div>
    </div>
  );
}

function Trend({ data, id }: { data: LeadershipData; id: string }) {
  const tick = useThemeTick();
  const fmt = fmtFor(data.selection.measure);
  const year = data.period.weeks[0]?.slice(0, 4) ?? data.source.edge.slice(0, 4);
  const opts = useMemo(() => {
    const g = gridOptions();
    return {
      ...g,
      plugins: { ...g.plugins, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${c.parsed.y === null ? "—" : fmt(c.parsed.y)}` } } },
      scales: { ...g.scales, y: { ...g.scales.y, ticks: { ...g.scales.y.ticks, callback: (v: number | string) => fmt(+v) } } },
    };
  }, [fmt, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const ds = {
    labels: data.months.map((m) => m.label),
    datasets: [
      { label: `FY${year}`, data: data.months.map((m) => m.cur), backgroundColor: cssToken("--accent"), borderRadius: 3 },
      { label: `FY${+year - 1}`, data: data.months.map((m) => m.ly), backgroundColor: cssToken("--line"), borderRadius: 3 },
    ],
  };
  return (
    <div className="card ldr-trend">
      <div className="c-head" style={{ flexWrap: "wrap", gap: 10 }}>
        <h3>Month by month — FY{year} against FY{+year - 1}<WeekNote year={+year} vs={+year - 1} /></h3>
        <span className="sub">{data.selection.measure === "dollars" ? "sales dollars" : "units"} · through {data.source.edge}</span>
      </div>
      <div className="chartbox ldr-chart"><Bar key={id + tick} data={ds} options={opts} /></div>
    </div>
  );
}

function RankTable({ rows, total, totalLy, measure, dim, top }: { rows: RankRow[]; total: number; totalLy: number; measure: Selection["measure"]; dim: string; top?: number }) {
  const fmt = fmtFor(measure);
  const head = dim === "customer" ? "Customer" : dim === "brand" ? "Brand" : "Item";
  return (
    <div className="ldr-tablewrap">
      <table className="revtable ldrtable">
        <thead>
          <tr>
            <th className="rk">#</th>
            <th>{head}</th>
            <th className="num">{measure === "dollars" ? "Sales" : "Units"}</th>
            <th className="num">Last year</th>
            <th className="num">Change</th>
            <th className="num sh">Share</th>
            <th className="bar" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td className="rk dim">{i + 1}</td>
              <td className="nm"><b>{r.name}</b>{r.sub && <span className="dim"> · {r.sub}</span>}</td>
              <td className="num"><b>{fmt(r.cur)}</b></td>
              <td className="num dim">{fmt(r.ly)}</td>
              <td className="num"><Delta cur={r.cur} ly={r.ly} small /></td>
              <td className="num sh dim">{r.share.toFixed(1)}%</td>
              <td className="bar"><span style={{ width: `${Math.min(100, rows[0]?.cur ? (r.cur / rows[0].cur) * 100 : 0)}%` }} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="dim" style={{ padding: 14 }}>Nothing sold in this period for the selection.</td></tr>}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td><b>{top && rows.length >= top ? `Top ${top} shown · all` : "Total"}</b></td>
            <td className="num"><b>{fmt(total)}</b></td>
            <td className="num dim">{fmt(totalLy)}</td>
            <td className="num"><Delta cur={total} ly={totalLy} small /></td>
            <td className="num sh dim">100%</td>
            <td className="bar" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Matrix({ data }: { data: LeadershipData }) {
  const fmt = fmtFor(data.selection.measure);
  const m = data.matrix;
  return (
    <div className="ldr-tablewrap">
      <table className="revtable ldrtable ldrmatrix">
        <thead>
          <tr><th>Customer</th>{m.brands.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.customer}>
              <td className="nm"><b>{r.name}</b></td>
              {r.cells.map((c, i) => <td key={i} className="num">{c ? fmt(c) : <span className="dim">—</span>}</td>)}
              <td className="num"><b>{fmt(r.total)}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td><b>Total</b></td>{m.totals.map((t, i) => <td key={i} className="num"><b>{fmt(t)}</b></td>)}<td className="num"><b>{fmt(m.grand)}</b></td></tr>
        </tfoot>
      </table>
    </div>
  );
}

function PageBody({ page, data, sheet }: { page: ReportPage; data: LeadershipData; sheet: boolean }) {
  if (page.kind === "summary") {
    return (
      <>
        <Kpis data={data} />
        <Trend data={data} id={sheet ? "sheet" : "screen"} />
      </>
    );
  }
  if (page.kind === "rank") {
    const r = data.ranks[page.key];
    return (
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="c-head" style={{ padding: "12px 16px 8px", flexWrap: "wrap", gap: 8 }}>
          <h3>{page.title}</h3>
          <span className="sub">{data.period.label} · {data.period.range} · vs {data.period.lyLabel}{page.top ? ` · top ${page.top} by ${data.selection.sort === "change" ? "change" : data.selection.sort === "name" ? "name" : data.selection.measure === "dollars" ? "sales" : "units"}` : ""}</span>
        </div>
        <RankTable rows={r.rows} total={r.total} totalLy={r.totalLy} measure={data.selection.measure} dim={page.dim} top={page.top} />
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="c-head" style={{ padding: "12px 16px 8px", flexWrap: "wrap", gap: 8 }}>
        <h3>{page.title}</h3>
        <span className="sub">{data.period.label} · {data.selection.measure === "dollars" ? "sales dollars" : "units"}</span>
      </div>
      <Matrix data={data} />
    </div>
  );
}

export default function LeadershipView({ data, page }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sel = data.selection;
  const all = page === "all";
  const current = LEADERSHIP_REPORT.find((p) => p.key === page) ?? LEADERSHIP_REPORT[0];

  const nav = (patch: Partial<Record<string, string>>) => {
    const q = new URLSearchParams({ period: sel.period, cust: sel.customer, brand: sel.brand, item: sel.item, m: sel.measure, sort: sel.sort, page });
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === "") q.delete(k); else q.set(k, v); }
    router.push(`${pathname}?${q.toString()}`);
  };
  const exportHref = `/api/leadership/export?${new URLSearchParams({ period: sel.period, cust: sel.customer, brand: sel.brand, item: sel.item, m: sel.measure, sort: sel.sort }).toString()}`;

  const [printedAt, setPrintedAt] = useState("");
  useEffect(() => {
    const stamp = () => setPrintedAt(new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);

  const selLine = [
    sel.customer === "ALL" ? data.scopeLabel : data.options.customers.find((c) => c.code === sel.customer)?.name ?? sel.customer,
    sel.brand === "ALL" ? "all brands" : sel.brand,
    sel.item === "ALL" ? null : data.options.items.find((i) => i.upc === sel.item)?.name ?? sel.item,
  ].filter(Boolean).join(" · ");

  return (
    <div className={"view active ldr" + (all ? " ldrprint" : " ldrone")}>
      <div className="pagehead ldr-head">
        <div>
          <h1>Leadership team report</h1>
          <p>
            Sales for the leadership team, cut by customer, brand and item. Set the period and the selection once; every page of the report follows it.
            <span className="ldr-src"> Source: <b>{data.source.name}</b> through {data.source.edge}.</span>
          </p>
        </div>
        <div className="actions noprint">
          {all
            ? <button className="btn" onClick={() => nav({ page: "summary" })}>← Back to the pages</button>
            : <button className="btn primary" onClick={() => nav({ page: "all" })} title="Every page of the report in order, ready to print">Build the report</button>}
          <button className="btn" onClick={() => window.print()} title="Print on letter paper"><span aria-hidden="true">🖨</span> Print</button>
          <a className="btn" href={exportHref} title="Every page of the report as one Excel workbook, a sheet each">⬇ Excel</a>
        </div>
      </div>

      <div className="ldr-selectors noprint">
        <div className="ldr-periods" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} className={"minichip" + (sel.period === p.key ? " on" : "")} onClick={() => nav({ period: p.key })} title={p.long}>{p.label}</button>
          ))}
        </div>
        <select value={sel.customer} onChange={(e) => nav({ cust: e.target.value })} aria-label="Customer">
          <option value="ALL">{data.scopeLabel}</option>
          {data.options.customers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select value={sel.brand} onChange={(e) => nav({ brand: e.target.value, item: "ALL" })} aria-label="Brand">
          <option value="ALL">All brands</option>
          {data.options.brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={sel.item} onChange={(e) => nav({ item: e.target.value })} aria-label="Item" className="ldr-item">
          <option value="ALL">All items</option>
          {data.options.items.map((i) => <option key={i.upc} value={i.upc}>{i.name}</option>)}
        </select>
        <div className="ldr-toggle" role="group" aria-label="Measure">
          <button className={"minichip" + (sel.measure === "dollars" ? " on" : "")} onClick={() => nav({ m: "dollars" })}>$</button>
          <button className={"minichip" + (sel.measure === "units" ? " on" : "")} onClick={() => nav({ m: "units" })}>Units</button>
        </div>
        <select value={sel.sort} onChange={(e) => nav({ sort: e.target.value })} aria-label="Sort">
          <option value="value">Sort: largest first</option>
          <option value="change">Sort: biggest change</option>
          <option value="name">Sort: by name</option>
        </select>
      </div>

      {!all && (
        <div className="ldr-tabs noprint" role="tablist">
          {LEADERSHIP_REPORT.map((p, i) => (
            <button key={p.key} role="tab" aria-selected={p.key === current.key} className={"ldr-tab" + (p.key === current.key ? " on" : "")} onClick={() => nav({ page: p.key })}>
              <span className="n">{i + 1}</span>{p.title}
            </button>
          ))}
        </div>
      )}

      {all ? (
        <div className="ldr-book">
          <section className="ldr-sheet ldr-cover">
            <div className="ldr-coverhead"><b>Heartland Foods</b><span>Leadership team report</span></div>
            <h2>{data.period.label}</h2>
            <p className="ldr-coverline">{data.period.range} · against {data.period.lyLabel}</p>
            <p className="ldr-coverline">{selLine} · {sel.measure === "dollars" ? "sales dollars" : "units"}</p>
            <ol className="ldr-toc">{LEADERSHIP_REPORT.map((p) => <li key={p.key}>{p.title}</li>)}</ol>
            <p className="ldr-coverfoot">Source: {data.source.name} through {data.source.edge}. {data.source.note}{printedAt ? ` Printed ${printedAt}.` : ""}</p>
          </section>
          {LEADERSHIP_REPORT.map((p, i) => (
            <section className="ldr-sheet" key={p.key}>
              <div className="ldr-sheethead">
                <div><b>{i + 1} · {p.title}</b><span>{data.period.label} · {data.period.range} · {selLine}</span></div>
                <div><b>Leadership team report</b><span>{data.source.name} through {data.source.edge} · page {i + 2} of {LEADERSHIP_REPORT.length + 1}</span></div>
              </div>
              <PageBody page={p} data={data} sheet />
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="ldr-line noprint"><b>{current.title}</b> · {data.period.label} · {data.period.range} · {selLine}</div>
          <PageBody page={current} data={data} sheet={false} />
          <div className="note" style={{ fontSize: 12 }}>
            ◇ {data.source.note} The internal sales feed will replace it here without changing the report.
          </div>
        </>
      )}
    </div>
  );
}
