"use client";

import { useMemo, useState } from "react";
import { fmtMoney } from "@/components/charts/themed";
import type { TieRow } from "@/lib/repo";

/* Tie List — the identifier map from the reference mockup, on the real item
   crosswalk: Telus/Heartland item numbers ↔ NIQ UPCs ↔ the NIQ pull, with the
   FY promo dollars riding on each identifier. This is the access point for
   the crosswalk everyone plans against — the Promotion Planner's carry-
   forward and the wizard's item scoring both read this map. */

export type TieListData = {
  rows: TieRow[];
  fiscalYear: number;
  scopeLabel?: string;
};

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

const STATUS: Record<TieRow["status"], { label: string; fg: string; bg: string; hint: string }> = {
  tied: { label: "Tied", fg: "var(--good)", bg: "var(--good-soft, rgba(22,163,74,.10))",
    hint: "Telus item number ↔ NIQ UPC, and the item is in the NIQ pull — promo lines score at item level" },
  static_only: { label: "No NIQ volume", fg: "var(--accent)", bg: "var(--accent-soft, rgba(37,99,235,.10))",
    hint: "Mapped and known to NIQ, but the item carries no volume in the loaded ALBSCO pull" },
  no_niq: { label: "Not in NIQ", fg: "var(--warn)", bg: "var(--warn-soft, rgba(217,119,6,.10))",
    hint: "Heartland item mapped to a UPC that NIQ's static file doesn't carry (e.g. Canada / club items)" },
  no_item_number: { label: "No Heartland #", fg: "var(--warn)", bg: "var(--warn-soft, rgba(217,119,6,.10))",
    hint: "NIQ knows this item but the crosswalk has no Telus/Heartland item number for it yet" },
  unmapped_sku: { label: "Unmapped SKU", fg: "var(--bad)", bg: "var(--bad-soft, rgba(220,38,38,.08))",
    hint: "This item number carries promo dollars in Telus but isn't in the crosswalk — its events fall back to brand-level scoring" },
};

export default function TieListView({ data }: { data: TieListData }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [brand, setBrand] = useState("");
  const [limit, setLimit] = useState(100);

  const brands = useMemo(() => [...new Set(data.rows.map((r) => r.brand).filter(Boolean))].sort(), [data.rows]);

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (brand && r.brand !== brand) return false;
      if (!words.length) return true;
      const hay = [r.item_number, r.upc, r.upc_core, r.description, r.niq_item, r.segment, r.brand]
        .filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [data.rows, q, status, brand]);

  const n = (s: TieRow["status"]) => data.rows.filter((r) => r.status === s).length;
  const tied = n("tied"), staticOnly = n("static_only");
  const unmappedSkus = data.rows.filter((r) => r.status === "unmapped_sku");
  const unmapped$ = unmappedSkus.reduce((a, r) => a + r.line_planned, 0);
  const total$ = data.rows.reduce((a, r) => a + r.line_planned, 0);
  const coverage = total$ > 0 ? ((total$ - unmapped$) / total$) * 100 : 100;

  const dlCsv = () => {
    const head = ["item_number", "niq_upc", "description", "brand", "business_unit", "segment", "niq_item", "status", `fy${data.fiscalYear}_line_planned_usd`, "line_count"];
    const esc = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [head.join(","), ...data.rows.map((r) =>
      [r.item_number, r.upc ?? r.upc_core, r.description, r.brand, r.business_unit, r.segment, r.niq_item, r.status, r.line_planned, r.line_count].map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "heartland_tie_list.csv";
    a.click();
  };

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <div className="crumb">Data &amp; Integrations · Core Model</div>
          <h1>Tie List</h1>
          <p>
            The single mapping that ties every item identifier together: Telus/Heartland item # ↔ NIQ UPC ↔ the
            NIQ pull, with segments from the NIQ hierarchy. The Promotion Planner&apos;s carry-forward and event
            scoring read this map — unmapped identifiers fall back to brand-level numbers until they land here.
          </p>
        </div>
        <div className="actions">
          {data.scopeLabel && <span className="pill" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Scope: {data.scopeLabel}</span>}
          <button className="btn" style={{ ...selStyle, cursor: "pointer" }} onClick={dlCsv} title="Download the full identifier map as CSV">
            ⬇ Download map (CSV)
          </button>
          <span className="pill">Source: Crosswalk_items_V1.xlsx · re-ingest to update</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">Tied identifiers</span></div>
          <div className="k-val">{tied}</div>
          <div className="k-sub flat">item # ↔ UPC ↔ NIQ pull · +{staticOnly} mapped without pull volume</div>
        </div>
        <div className="kpi alert">
          <div className="k-top"><span className="k-label">Unmapped Telus SKUs</span></div>
          <div className="k-val">{unmappedSkus.length}</div>
          <div className="k-sub flat">on FY{data.fiscalYear} promo lines · {fmtMoney(unmapped$)} planned riding on them</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Promo $ coverage</span></div>
          <div className="k-val">{coverage.toFixed(1)}%</div>
          <div className="k-sub flat">of FY{data.fiscalYear} line dollars resolve to a UPC</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">NIQ items missing a Heartland #</span></div>
          <div className="k-val">{n("no_item_number")}</div>
          <div className="k-sub flat">known to NIQ · no Telus item number yet</div>
        </div>
      </div>

      <div className="callout">
        <span className="ci">🔗</span>
        <div className="ct">
          <b>Why it matters:</b> every promo line resolves to NIQ volume through this list. The{" "}
          {unmappedSkus.length} unmapped SKUs carry {fmtMoney(unmapped$)} of FY{data.fiscalYear} planned trade that
          can only score at brand level — extend <code>Crosswalk_items_V1.xlsx</code> and re-run the ingest to close
          the gap.
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setLimit(100); }}
            placeholder="Search item #, UPC, description, segment…"
            style={{ ...selStyle, minWidth: 260, fontWeight: 500 }}
          />
          <select style={selStyle} value={status} onChange={(e) => { setStatus(e.target.value); setLimit(100); }}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS) as TieRow["status"][]).map((s) => (
              <option key={s} value={s}>{STATUS[s].label} ({n(s)})</option>
            ))}
          </select>
          <select style={selStyle} value={brand} onChange={(e) => { setBrand(e.target.value); setLimit(100); }}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b}>{b}</option>)}
          </select>
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
            {filtered.length.toLocaleString()} identifiers · {fmtMoney(filtered.reduce((a, r) => a + r.line_planned, 0))} FY{data.fiscalYear} planned
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Heartland item #</th>
                <th>NIQ UPC</th>
                <th>Item</th>
                <th>Brand</th>
                <th>Segment</th>
                <th style={{ textAlign: "right" }} title={`FY${data.fiscalYear} planned trade on promo lines carrying this item number`}>FY{data.fiscalYear} promo $</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r, i) => {
                const st = STATUS[r.status];
                const mono: React.CSSProperties = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 };
                return (
                  <tr key={(r.item_number ?? "") + (r.upc_core ?? "") + i} style={r.status === "unmapped_sku" ? { background: "var(--bad-soft, rgba(220,38,38,.05))" } : undefined}>
                    <td style={{ padding: "9px 14px", ...mono }}>{r.item_number ?? <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                    <td style={{ padding: "9px 14px", ...mono }}>{r.upc ?? r.upc_core ?? <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                    <td style={{ padding: "9px 14px", minWidth: 220 }}>
                      <b>{r.description || r.niq_item || "—"}</b>
                      {r.niq_item && r.description && r.niq_item !== r.description && (
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>NIQ: {r.niq_item.length > 60 ? r.niq_item.slice(0, 59) + "…" : r.niq_item}</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 14px" }}>{r.brand || "—"}</td>
                    <td style={{ padding: "9px 14px", fontSize: 12 }}>{r.segment ?? <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.line_planned > 0 ? <>{fmtMoney(r.line_planned)}<span style={{ color: "var(--ink-3)", fontSize: 11 }}> · {r.line_count} ln</span></> : <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      <span className="badge" style={{ background: st.bg, color: st.fg }} title={st.hint}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "16px", color: "var(--ink-3)", fontSize: 12.5 }}>Nothing matches the filters.</td></tr>
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
          ◇ Hover a status badge for what it means. Rows sort by the FY{data.fiscalYear} promo dollars riding on the
          identifier, so the mappings worth fixing first are at the top. The map updates by re-running{" "}
          <code>scripts/ingest_item_crosswalk.py</code> on an extended workbook; editing rows in place arrives with
          the Supabase swap-in (migration 00008 is authored).
        </div>
      </div>
    </div>
  );
}
