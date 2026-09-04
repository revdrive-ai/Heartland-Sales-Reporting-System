"use client";

import { useEffect, useMemo, useState } from "react";
import { addPriceEdit, deletePriceEdit, getPriceEdits, type PriceEdit } from "@/lib/repo/client";
import type { PriceRow } from "@/lib/repo";

/* Price List — dated list prices per item. Every price carries an
   effective-from date: the workbook ingest seeds versions in bulk, and the
   form here records per-item changes (new price + effective date + why), so
   the tool can mark change dates on trends and measure their effects. */

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

const today = () => new Date().toISOString().slice(0, 10);
const fmt$ = (v: number | null) => (v === null ? "—" : "$" + v.toFixed(2));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

type Version = {
  effective_from: string;
  unit_price: number | null;
  case_price: number | null;
  source: string;
  note?: string;
  editId?: string;           // present = a local manual edit, removable
};

export default function PriceListView({ rows }: { rows: PriceRow[] }) {
  const [edits, setEdits] = useState<PriceEdit[]>([]);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [segment, setSegment] = useState("");
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null); // fg with history expanded

  // change form
  const [fFg, setFFg] = useState("");
  const [fUnit, setFUnit] = useState("");
  const [fCase, setFCase] = useState("");
  const [fDate, setFDate] = useState(today());
  const [fNote, setFNote] = useState("");

  useEffect(() => { getPriceEdits().then(setEdits); }, []);

  /* one entry per item: identity from the newest record, full dated version
     history (workbook versions + local edits), and the price in force today */
  const items = useMemo(() => {
    const byFg = new Map<string, { meta: PriceRow; versions: Version[] }>();
    for (const r of rows) {
      const e = byFg.get(r.fg) ?? { meta: r, versions: [] };
      e.meta = r;
      e.versions.push({ effective_from: r.effective_from, unit_price: r.unit_price, case_price: r.case_price, source: r.source });
      byFg.set(r.fg, e);
    }
    for (const e of edits) {
      const it = byFg.get(e.fg);
      if (!it) continue;
      it.versions.push({ effective_from: e.effective_from, unit_price: e.unit_price, case_price: e.case_price, source: "manual", note: e.note, editId: e.id });
    }
    const t = today();
    return [...byFg.values()].map(({ meta, versions }) => {
      versions.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      const current = [...versions].reverse().find((v) => v.effective_from <= t) ?? null;
      const upcoming = versions.filter((v) => v.effective_from > t);
      return { meta, versions, current, upcoming, changes: versions.length - 1 };
    }).sort((a, b) => a.meta.brand.localeCompare(b.meta.brand) || a.meta.item.localeCompare(b.meta.item));
  }, [rows, edits]);

  const brands = useMemo(() => [...new Set(items.map((i) => i.meta.brand))].sort(), [items]);
  const segments = useMemo(() => [...new Set(items.map((i) => i.meta.segment).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => {
      if (brand && i.meta.brand !== brand) return false;
      if (segment && i.meta.segment !== segment) return false;
      if (!words.length) return true;
      const hay = [i.meta.fg, i.meta.upc, i.meta.upc_core, i.meta.item, i.meta.brand, i.meta.category, i.meta.form, i.meta.segment]
        .filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, q, brand, segment]);

  const priced = items.filter((i) => i.current?.unit_price != null).length;
  const inPull = items.filter((i) => i.meta.upc).length;
  const changed = items.filter((i) => i.changes > 0);
  const upcomingN = items.reduce((a, i) => a + i.upcoming.length, 0);

  const addChange = async () => {
    const unit = parseFloat(fUnit);
    const cse = parseFloat(fCase);
    if (!fFg || (isNaN(unit) && isNaN(cse)) || !fDate) return;
    const meta = items.find((i) => i.meta.fg === fFg)?.meta;
    setEdits(await addPriceEdit({
      id: newId(), fg: fFg, upc: meta?.upc ?? null,
      unit_price: isNaN(unit) ? null : +unit.toFixed(4),
      case_price: isNaN(cse) ? null : +cse.toFixed(4),
      effective_from: fDate, note: fNote.trim(), created_at: new Date().toISOString(),
    }));
    setFUnit(""); setFCase(""); setFNote("");
    setOpen(fFg);
  };

  const dlCsv = () => {
    const head = ["fg", "upc", "item", "brand", "category", "form", "segment", "units_per_case", "case_price", "unit_price", "effective_from", "source", "note"];
    const esc = (v: string | number | null | undefined) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const out: string[] = [head.join(",")];
    for (const i of items) {
      for (const v of i.versions) {
        out.push([i.meta.fg, i.meta.upc ?? i.meta.upc_core, i.meta.item, i.meta.brand, i.meta.category, i.meta.form, i.meta.segment,
          i.meta.units_per_case, v.case_price, v.unit_price, v.effective_from, v.source, v.note ?? ""].map(esc).join(","));
      }
    }
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(out.join("\n"));
    a.download = "heartland_price_list_dated.csv";
    a.click();
  };

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <div className="crumb">Data &amp; Integrations · Pricing Basis</div>
          <h1>Price List</h1>
          <p>
            Dated list prices per item — the pricing basis every analysis ties back to. Each price carries an
            effective date, so changes over time stay visible: plan-year ROI scores on the list price in force at
            the event, and price-change dates mark on the Base &amp; Lift trend to read their effects.
          </p>
        </div>
        <div className="actions">
          <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={dlCsv} title="Download every dated price record as CSV">
            ⬇ Download dated list (CSV)
          </button>
          <span className="pill">Initial list effective 2026-01-01 · re-ingest a new workbook with --effective for bulk changes</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">Items priced</span></div>
          <div className="k-val">{priced}</div>
          <div className="k-sub flat">of {items.length} on the list · {items.length - priced} TBD</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">In the NIQ pull</span></div>
          <div className="k-val">{inPull}</div>
          <div className="k-sub flat">items whose UPC carries measured volume — priced analysis works there</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Items with price changes</span></div>
          <div className="k-val">{changed.length}</div>
          <div className="k-sub flat">dated versions beyond the initial list</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Upcoming changes</span></div>
          <div className="k-val">{upcomingN}</div>
          <div className="k-sub flat">effective after today — plans ahead of them already price correctly</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <b>Record a price change</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginLeft: 10 }}>
            new price + when it takes effect + why — the change dates drive the effect analysis
          </span>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select style={{ ...selStyle, maxWidth: 340 }} value={fFg} onChange={(e) => setFFg(e.target.value)}>
            <option value="">Item…</option>
            {items.map((i) => (
              <option key={i.meta.fg} value={i.meta.fg}>
                {i.meta.brand} · {i.meta.item.length > 34 ? i.meta.item.slice(0, 33) + "…" : i.meta.item} ({i.meta.fg})
              </option>
            ))}
          </select>
          <input style={{ ...selStyle, width: 120 }} type="number" step="0.01" placeholder="Unit $" value={fUnit} onChange={(e) => setFUnit(e.target.value)} />
          <input style={{ ...selStyle, width: 120 }} type="number" step="0.01" placeholder="Case $" value={fCase} onChange={(e) => setFCase(e.target.value)} />
          <input style={{ ...selStyle, width: 150 }} type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} title="Effective from" />
          <input style={{ ...selStyle, flex: "1 1 220px", minWidth: 180 }} placeholder="Why — e.g. list increase 4% Apr 1…" value={fNote} onChange={(e) => setFNote(e.target.value)} />
          <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={addChange} disabled={!fFg || (!parseFloat(fUnit) && !parseFloat(fCase))}>
            ＋ Add dated price
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(100); }} placeholder="Search item, FG#, UPC, segment…" style={{ ...selStyle, minWidth: 240, fontWeight: 500 }} />
          <select style={selStyle} value={brand} onChange={(e) => { setBrand(e.target.value); setLimit(100); }}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b}>{b}</option>)}
          </select>
          <select style={selStyle} value={segment} onChange={(e) => { setSegment(e.target.value); setLimit(100); }}>
            <option value="">All segments</option>
            {segments.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
            {filtered.length} items · click a row for its dated history
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Item</th><th>FG# / UPC</th><th>Brand</th><th>Segment</th>
                <th style={{ textAlign: "right" }}>Units / case</th>
                <th style={{ textAlign: "right" }}>Case $</th>
                <th style={{ textAlign: "right" }}>Unit $</th>
                <th>Effective</th>
                <th style={{ textAlign: "right" }} title="Dated versions beyond the initial list">Changes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((i) => {
                const isOpen = open === i.meta.fg;
                return (
                  <PriceTr key={i.meta.fg} it={i} isOpen={isOpen}
                    onToggle={() => setOpen(isOpen ? null : i.meta.fg)}
                    onRemoveEdit={(id) => deletePriceEdit(id).then(setEdits)} />
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ padding: "16px", color: "var(--ink-3)", fontSize: 12.5 }}>Nothing matches the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
            <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={() => setLimit((l) => l + 300)}>
              Show more — {filtered.length - limit} remaining
            </button>
          </div>
        )}
        <div className="note" style={{ margin: 0, padding: "10px 16px" }}>
          ◇ The price shown is the one in force today; expand a row for its full dated history, including upcoming
          changes. Manual changes are saved in this browser until Supabase lands (migration 00009 is authored) —
          bulk changes come as a new workbook through <code>scripts/ingest_price_list.py --effective YYYY-MM-DD</code>.
        </div>
      </div>
    </div>
  );
}

function PriceTr({ it, isOpen, onToggle, onRemoveEdit }: {
  it: { meta: PriceRow; versions: Version[]; current: Version | null; upcoming: Version[]; changes: number };
  isOpen: boolean;
  onToggle: () => void;
  onRemoveEdit: (id: string) => void;
}) {
  const td: React.CSSProperties = { padding: "9px 14px", borderBottom: "1px solid var(--line)" };
  const right: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const mono: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 };
  const c = it.current;
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: isOpen ? "var(--surface-2)" : undefined }}>
        <td style={{ ...td, minWidth: 180 }}><b>{it.meta.item}</b><div style={{ fontSize: 11, color: "var(--ink-3)" }}>{it.meta.category} · {it.meta.form}</div></td>
        <td style={{ ...td, ...mono }}>{it.meta.fg}<div style={{ color: "var(--ink-3)" }}>{it.meta.upc ?? (it.meta.upc_core || "TBD")}</div></td>
        <td style={td}>{it.meta.brand}</td>
        <td style={{ ...td, fontSize: 12 }}>{it.meta.segment}</td>
        <td style={right}>{it.meta.units_per_case ?? "—"}</td>
        <td style={right}>{fmt$(c?.case_price ?? null)}</td>
        <td style={{ ...right, fontWeight: 700 }}>{fmt$(c?.unit_price ?? null)}</td>
        <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
          {c?.effective_from ?? "—"}
          {it.upcoming.length > 0 && <span className="badge" style={{ marginLeft: 6, background: "var(--warn-soft, rgba(217,119,6,.10))", color: "var(--warn)" }}>+{it.upcoming.length} upcoming</span>}
        </td>
        <td style={{ ...right, fontWeight: 700, color: it.changes > 0 ? "var(--accent)" : "var(--ink-3)" }}>{it.changes}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={9} style={{ padding: "8px 14px 12px 28px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
            <table style={{ fontSize: 12.5 }}>
              <thead><tr><th>Effective</th><th style={{ textAlign: "right" }}>Unit $</th><th style={{ textAlign: "right" }}>Case $</th><th>Source</th><th>Note</th><th></th></tr></thead>
              <tbody>
                {[...it.versions].reverse().map((v, k) => (
                  <tr key={k}>
                    <td style={{ padding: "6px 12px", fontVariantNumeric: "tabular-nums" }}>
                      {v.effective_from}
                      {v.effective_from > new Date().toISOString().slice(0, 10) && <span style={{ color: "var(--warn)", fontWeight: 700 }}> · upcoming</span>}
                    </td>
                    <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt$(v.unit_price)}</td>
                    <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt$(v.case_price)}</td>
                    <td style={{ padding: "6px 12px" }}>{v.editId ? "manual (this browser)" : v.source}</td>
                    <td style={{ padding: "6px 12px", color: "var(--ink-2)" }}>{v.note || "—"}</td>
                    <td style={{ padding: "6px 12px" }}>
                      {v.editId && (
                        <span className="minichip" style={{ cursor: "pointer" }} title="Remove this manual price change"
                          onClick={(ev) => { ev.stopPropagation(); onRemoveEdit(v.editId!); }}>✕</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
