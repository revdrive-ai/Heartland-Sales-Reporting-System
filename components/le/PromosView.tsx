"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { saveLeOverlay, type LeAddedEvent, type LeOverlay } from "@/lib/repo/client";
import { overlayCount } from "@/lib/leovl";
import { parseWorkPath, processPath } from "@/lib/process";

/* Adjust the promotions — see app/promos/page.tsx.

   The account's Telus book for the year, one row per promotion, read
   through the estimate's overlay. A promotion still to run can be changed
   (window, expected lift, spend), cancelled, or put back as booked; one the
   book does not have can be added. Anything that ended before the NIQ edge
   is in the actuals and reads only. The roll-up at the top is the estimate
   with these changes in it, recomputed on every save. */

export type PromoRow = {
  id: string; title: string; status: string; perf: string; customer: string; corporate: boolean;
  start: string; end: string; planned: number; brands: string[];
};

export type PromosData = {
  year: number;
  customers: number;
  scopeLabel: string;
  account: null | {
    code: string;
    name: string;
    edge: string;
    telusSnapshot: string;
    cycle: { open: string; lockDate: string; daysToLock: number } | null;
    brands: string[];
    perfTypes: string[];
    rows: PromoRow[];
    overlay: LeOverlay;
    rollup: { units: number; planUnits: number; gross: number; planGross: number; trade: number; tradeBook: number; margin: number };
  };
};

const fmtU = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3).toLocaleString()}K` : String(Math.round(v));
const fmt$ = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1e3).toLocaleString()}K` : `$${Math.round(x)}`;
  return v < 0 ? `−${t}` : t;
};
const pctOf = (now: number, base: number) => (base ? `${now >= base ? "+" : "−"}${Math.abs((now / base - 1) * 100).toFixed(1)}%` : "—");
const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 9, padding: "7px 10px",
};
const inStyle: React.CSSProperties = { ...selStyle, fontWeight: 500, padding: "6px 8px", fontSize: 12 };

type Draft = { start: string; end: string; spend: string; lift: string; note: string };

export default function PromosView({ data }: { data: PromosData }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = parseWorkPath(pathname);
  const stepHref = (key: string) => (loc ? processPath(loc.proc.kind, key) : null);

  const a = data.account;
  const [ovl, setOvl] = useState<LeOverlay>(a?.overlay ?? { cancelled: {}, changes: {}, added: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ start: "", end: "", spend: "", lift: "", note: "" });
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState({ brand: a?.brands[0] ?? "", title: "", perf: a?.perfTypes[0] ?? "", start: "", end: "", spend: "", lift: "", note: "" });
  const [show, setShow] = useState<"toRun" | "all">("toRun");
  const [busy, setBusy] = useState(false);

  const toRun = useMemo(() => (a ? a.rows.filter((r) => r.end > a.edge) : []), [a]);
  const rows = show === "toRun" ? toRun : (a?.rows ?? []);

  if (!a) {
    return (
      <div className="view active">
        <div className="pagehead"><div><h1>Adjust the promotions — FY{data.year}</h1></div></div>
        <div className="card" style={{ padding: 18 }}>
          <div className="note" style={{ marginTop: 0, fontSize: 13 }}>
            ◇ The estimate is worked one account at a time. The top bar is on <b>{data.scopeLabel}</b>
            {data.customers ? <>, which is {data.customers} accounts</> : null} — pick one under <b>Account</b> and
            this page lists that account&apos;s promotions.
          </div>
        </div>
      </div>
    );
  }

  const persist = async (next: LeOverlay) => {
    setBusy(true);
    try {
      setOvl(next);
      await saveLeOverlay(a.code, data.year, next);
      router.refresh(); // the roll-up and the rail recompute server-side
    } finally {
      setBusy(false);
    }
  };

  const now = () => new Date().toISOString();
  const cancel = (id: string) => persist({ ...ovl, cancelled: { ...ovl.cancelled, [id]: { at: now(), note: "" } } });
  const restore = (id: string) => {
    const cancelled = { ...ovl.cancelled }; delete cancelled[id];
    const changes = { ...ovl.changes }; delete changes[id];
    return persist({ ...ovl, cancelled, changes });
  };
  const startEdit = (r: PromoRow) => {
    const c = ovl.changes[r.id];
    setEditing(r.id);
    setDraft({ start: c?.start ?? r.start, end: c?.end ?? r.end, spend: String(c?.spend ?? r.planned), lift: c?.lift_pct == null ? "" : String(c.lift_pct), note: c?.note ?? "" });
  };
  const saveEdit = (r: PromoRow) => {
    const spend = Math.max(0, parseFloat(draft.spend) || 0);
    const lift = draft.lift.trim() === "" ? null : parseFloat(draft.lift);
    const change = {
      ...(draft.start !== r.start ? { start: draft.start } : {}),
      ...(draft.end !== r.end ? { end: draft.end } : {}),
      ...(spend !== r.planned ? { spend } : {}),
      ...(lift !== null && !Number.isNaN(lift) ? { lift_pct: lift } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      at: now(),
    };
    const changes = { ...ovl.changes };
    if (Object.keys(change).length === 1) delete changes[r.id]; else changes[r.id] = change;
    setEditing(null);
    return persist({ ...ovl, changes });
  };
  const saveAdd = () => {
    if (!add.start || !add.end || add.end < add.start || !add.brand) return;
    const ev: LeAddedEvent = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      brand: add.brand, title: add.title.trim() || `${add.brand} ${add.perf}`, perf: add.perf,
      start: add.start, end: add.end, spend: Math.max(0, parseFloat(add.spend) || 0),
      lift_pct: add.lift.trim() === "" ? null : parseFloat(add.lift), note: add.note.trim(), at: now(),
    };
    setAdding(false);
    setAdd({ brand: a.brands[0] ?? "", title: "", perf: a.perfTypes[0] ?? "", start: "", end: "", spend: "", lift: "", note: "" });
    return persist({ ...ovl, added: [...ovl.added, ev] });
  };
  const removeAdded = (id: string) => persist({ ...ovl, added: ovl.added.filter((x) => x.id !== id) });

  const changes = overlayCount(ovl);
  const r = a.rollup;
  const tradeDelta = r.trade - r.tradeBook;

  const stateOf = (row: PromoRow): { key: "ran" | "cancelled" | "changed" | "booked"; label: string } => {
    if (row.end <= a.edge) return { key: "ran", label: "ran · in the actuals" };
    if (ovl.cancelled[row.id]) return { key: "cancelled", label: "cancelled" };
    if (ovl.changes[row.id]) return { key: "changed", label: "changed" };
    return { key: "booked", label: "as booked" };
  };
  const estSpend = (row: PromoRow) => (ovl.cancelled[row.id] ? 0 : ovl.changes[row.id]?.spend ?? row.planned);

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <h1>Adjust the promotions — FY{data.year}</h1>
          <p>
            <b>{a.name}</b>&apos;s Telus book, read through the estimate. Promotions still to run can be changed, cancelled or put back;
            new ones can be added. The book stays as booked (snapshot {a.telusSnapshot}); the estimate carries your changes, and the
            forecast and the trade line pick them up on save.
          </p>
        </div>
        <div className="actions">
          <span className="pill">NIQ through {a.edge}</span>
          {a.cycle && <span className="pill">{a.cycle.open} locks {a.cycle.lockDate} · {a.cycle.daysToLock}d</span>}
          <span className="pill" style={changes ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
            {changes ? `${changes} change${changes === 1 ? "" : "s"} on the book` : "book as booked"}
          </span>
        </div>
      </div>

      <div className="kpis stand">
        <div className="kpi">
          <div className="k-top"><span className="k-label">FY estimate · units</span></div>
          <div className="k-val">{fmtU(r.units)}</div>
          <div className="k-sub"><b style={{ color: r.units >= r.planUnits ? "var(--good)" : "var(--bad)" }}>{pctOf(r.units, r.planUnits)}</b><span style={{ color: "var(--ink-3)" }}> vs plan {fmtU(r.planUnits)}</span></div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">FY estimate · gross at list</span></div>
          <div className="k-val">{fmt$(r.gross)}</div>
          <div className="k-sub"><b style={{ color: r.gross >= r.planGross ? "var(--good)" : "var(--bad)" }}>{pctOf(r.gross, r.planGross)}</b><span style={{ color: "var(--ink-3)" }}> vs plan {fmt$(r.planGross)}</span></div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Trade spend · estimate</span></div>
          <div className="k-val">{fmt$(r.trade)}</div>
          <div className="k-sub">
            <b style={{ color: Math.abs(tradeDelta) < 1 ? "var(--ink-2)" : tradeDelta > 0 ? "var(--warn)" : "var(--good)" }}>
              {Math.abs(tradeDelta) < 1 ? "as booked" : `${tradeDelta > 0 ? "+" : "−"}${fmt$(Math.abs(tradeDelta))}`}
            </b>
            <span style={{ color: "var(--ink-3)" }}> vs the book {fmt$(r.tradeBook)}</span>
          </div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Gross margin · after trade</span></div>
          <div className="k-val">{fmt$(r.margin)}{r.gross > 0 && <span className="k-pct">{((r.margin / r.gross) * 100).toFixed(1)}% of gross</span>}</div>
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>gross sales − trade spend</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 0, border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
            {(["toRun", "all"] as const).map((m) => (
              <button key={m} className="btn" onClick={() => setShow(m)} aria-pressed={show === m}
                style={{ border: "none", borderRadius: 0, padding: "8px 14px", background: show === m ? "var(--brand)" : "transparent", color: show === m ? "var(--brand-ink)" : "var(--ink-2)" }}>
                {m === "toRun" ? `Still to run (${toRun.length})` : `Whole year (${a.rows.length})`}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {show === "toRun" ? `windows ending after the NIQ edge, ${a.edge}` : "promotions that have run are in the actuals and read only"}
          </span>
          <button className="newevent" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)} title="Add a promotion the book does not have — it joins the estimate, not the Telus book">
            <span aria-hidden="true">＋</span> Add a promotion
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="revtable promos">
            <thead>
              <tr>
                <th>Window</th><th>Promotion</th><th>Type</th><th>Brand</th>
                <th style={{ textAlign: "right" }}>Booked $</th><th style={{ textAlign: "right" }}>Estimate $</th>
                <th style={{ textAlign: "right" }}>Lift</th><th>Estimate</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const st = stateOf(row);
                const c = ovl.changes[row.id];
                const isEdit = editing === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className={"pr-" + st.key}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {c?.start || c?.end
                          ? <><s className="dim">{row.start} → {row.end}</s><br /><b>{c.start ?? row.start} → {c.end ?? row.end}</b></>
                          : <>{row.start} → {row.end}</>}
                      </td>
                      <td>
                        <b>{row.title}</b>
                        <div className="dim">{row.id} · {row.corporate ? "corporate · all divisions" : row.customer} · {row.status}{c?.note ? ` · ${c.note}` : ""}</div>
                      </td>
                      <td>{row.perf}</td>
                      <td>{row.brands.join(", ") || "—"}</td>
                      <td className="num">{row.planned.toLocaleString()}</td>
                      <td className="num">
                        {st.key === "cancelled" ? <span className="dim">0</span>
                          : c?.spend !== undefined ? <b>{c.spend.toLocaleString()}</b> : row.planned.toLocaleString()}
                      </td>
                      <td className="num">{c?.lift_pct != null ? <b>{c.lift_pct}%</b> : <span className="dim">history</span>}</td>
                      <td><span className={"minichip on pr-" + st.key}>{st.label}</span></td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {st.key !== "ran" && !isEdit && (
                          <>
                            {st.key !== "cancelled" && <button className="btn sm" onClick={() => startEdit(row)} disabled={busy}>Change</button>}
                            {st.key === "booked"
                              ? <button className="btn sm" onClick={() => cancel(row.id)} disabled={busy} style={{ marginLeft: 6, color: "var(--bad)" }}>Cancel</button>
                              : <button className="btn sm" onClick={() => restore(row.id)} disabled={busy} style={{ marginLeft: 6 }}>As booked</button>}
                          </>
                        )}
                      </td>
                    </tr>
                    {isEdit && (
                      <tr className="pr-edit">
                        <td colSpan={9}>
                          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", padding: "4px 0" }}>
                            <label className="pr-f">Start<input type="date" style={inStyle} value={draft.start} min={a.edge} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label>
                            <label className="pr-f">End<input type="date" style={inStyle} value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></label>
                            <label className="pr-f">Spend $<input type="number" style={{ ...inStyle, width: 110 }} value={draft.spend} onChange={(e) => setDraft({ ...draft, spend: e.target.value })} /></label>
                            <label className="pr-f">Expected lift %<input type="number" style={{ ...inStyle, width: 90 }} placeholder="history" value={draft.lift} onChange={(e) => setDraft({ ...draft, lift: e.target.value })} /></label>
                            <label className="pr-f" style={{ flex: "1 1 200px" }}>Why<input type="text" style={inStyle} placeholder="optional — travels with the estimate" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
                            <button className="btn primary sm" onClick={() => saveEdit(row)} disabled={busy || !draft.start || !draft.end || draft.end < draft.start}>Save change</button>
                            <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
                          </div>
                          <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                            Leave lift blank to let the forecast read it from last year&apos;s matching weeks. Only weeks after the NIQ edge move — a window that has started keeps its measured weeks.
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {ovl.added.map((ev) => (
                <tr key={ev.id} className="pr-added">
                  <td style={{ whiteSpace: "nowrap" }}>{ev.start} → {ev.end}</td>
                  <td><b>{ev.title}</b><div className="dim">added by the estimate{ev.note ? ` · ${ev.note}` : ""}</div></td>
                  <td>{ev.perf}</td>
                  <td>{ev.brand}</td>
                  <td className="num dim">—</td>
                  <td className="num"><b>{Math.round(ev.spend).toLocaleString()}</b></td>
                  <td className="num">{ev.lift_pct != null ? <b>{ev.lift_pct}%</b> : <span className="dim">history</span>}</td>
                  <td><span className="minichip on pr-added">added</span></td>
                  <td style={{ textAlign: "right" }}><button className="btn sm" onClick={() => removeAdded(ev.id)} disabled={busy} style={{ color: "var(--bad)" }}>Remove</button></td>
                </tr>
              ))}
              {rows.length === 0 && ovl.added.length === 0 && (
                <tr><td colSpan={9} className="dim" style={{ padding: 18 }}>No promotions {show === "toRun" ? "still to run" : "on the book"} for this account.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ fontWeight: 700 }}>{show === "toRun" ? "Still to run" : "Whole year"} · {rows.length + ovl.added.length} promotions</td>
                <td className="num" style={{ fontWeight: 700 }}>{rows.reduce((s, x) => s + x.planned, 0).toLocaleString()}</td>
                <td className="num" style={{ fontWeight: 700 }}>{(rows.reduce((s, x) => s + estSpend(x), 0) + ovl.added.reduce((s, x) => s + x.spend, 0)).toLocaleString()}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="note" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>◇ {changes ? `${changes} change${changes === 1 ? "" : "s"} on ${a.name}'s book this year.` : `${a.name}'s book stands as booked.`} Next: read the full year back and lock this cycle&apos;s version.</span>
        {stepHref("lock") && <Link className="btn primary" href={stepHref("lock")!} style={{ marginLeft: "auto" }}>Review &amp; lock →</Link>}
      </div>

      {adding && (
        <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget) setAdding(false); }}>
          <div className="box" style={{ width: 560 }}>
            <div className="m-head">
              <div>
                <div className="mt">Add a promotion to the estimate</div>
                <div className="ms">For <b>{a.name}</b>, FY{data.year}. It joins the estimate, not the Telus book — book it in Telus when it is agreed.</div>
              </div>
              <button className="x" onClick={() => setAdding(false)} aria-label="Close">✕</button>
            </div>
            <div className="m-body">
              <div className="f-2col" style={{ marginTop: 10 }}>
                <div className="f-row"><label>Brand</label>
                  <select value={add.brand} onChange={(e) => setAdd({ ...add, brand: e.target.value })}>{a.brands.map((b) => <option key={b}>{b}</option>)}</select></div>
                <div className="f-row"><label>Type</label>
                  <select value={add.perf} onChange={(e) => setAdd({ ...add, perf: e.target.value })}>{a.perfTypes.map((p) => <option key={p}>{p}</option>)}</select></div>
              </div>
              <div className="f-row"><label>Title</label>
                <input type="text" placeholder={`${add.brand} ${add.perf}`} value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} /></div>
              <div className="f-2col">
                <div className="f-row"><label>Start</label><input type="date" min={a.edge} value={add.start} onChange={(e) => setAdd({ ...add, start: e.target.value })} /></div>
                <div className="f-row"><label>End</label><input type="date" min={add.start || a.edge} value={add.end} onChange={(e) => setAdd({ ...add, end: e.target.value })} /></div>
              </div>
              <div className="f-2col">
                <div className="f-row"><label>Trade $</label><input type="number" value={add.spend} onChange={(e) => setAdd({ ...add, spend: e.target.value })} /></div>
                <div className="f-row"><label>Expected lift %</label><input type="number" placeholder="blank = from history" value={add.lift} onChange={(e) => setAdd({ ...add, lift: e.target.value })} /></div>
              </div>
              <div className="f-row"><label>Why</label><input type="text" placeholder="optional" value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} /></div>
            </div>
            <div className="m-foot">
              <span className="summ">Lift applies to the brand&apos;s forecast weeks in the window; trade spreads over its days.</span>
              <button className="btn primary" style={{ marginLeft: "auto" }} onClick={saveAdd} disabled={busy || !add.start || !add.end || add.end < add.start}>Add to the estimate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
