"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Data & Integrations — the connection health of the shared-state backend and
   the one-click data loader (the in-app twin of scripts/load_supabase.py).
   Loading walks the tables in FK order, posting one chunk at a time to
   /api/admin/load so progress is visible and no request runs long. Everything
   upserts on natural keys: re-loading is always safe. */

type Health = { backend: string; writable: boolean; reason?: string };
type TableInfo = { table: string; rows: number };
type Progress = { loaded: number; total: number; state: "idle" | "loading" | "done" | "error"; error?: string };

const fmtN = (n: number) => n.toLocaleString("en-US");

export default function IntegrationsView() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [prog, setProg] = useState<Record<string, Progress>>({});
  const [running, setRunning] = useState<string | null>(null); // "all" or a table name
  const cancelRef = useRef(false);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      setHealth(await r.json());
    } catch {
      setHealth({ backend: "unknown", writable: false, reason: "health endpoint unreachable" });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    fetch("/api/admin/load", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { configured: boolean; tables?: TableInfo[] }) => {
        setConfigured(d.configured);
        setTables(d.tables ?? []);
      })
      .catch(() => setConfigured(false));
  }, [checkHealth]);

  async function loadTable(table: string, total: number): Promise<boolean> {
    setProg((p) => ({ ...p, [table]: { loaded: 0, total, state: "loading" } }));
    let offset = 0;
    for (;;) {
      if (cancelRef.current) {
        setProg((p) => ({ ...p, [table]: { loaded: offset, total, state: "idle" } }));
        return false;
      }
      let res: Response;
      try {
        res = await fetch("/api/admin/load", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ table, offset }),
        });
      } catch {
        setProg((p) => ({ ...p, [table]: { loaded: offset, total, state: "error", error: "network error — click Load to resume" } }));
        return false;
      }
      const data = (await res.json()) as { loaded?: number; total?: number; done?: boolean; error?: string };
      if (!res.ok || data.error) {
        setProg((p) => ({ ...p, [table]: { loaded: offset, total, state: "error", error: data.error ?? `HTTP ${res.status}` } }));
        return false;
      }
      offset = data.loaded ?? offset;
      setProg((p) => ({ ...p, [table]: { loaded: offset, total: data.total ?? total, state: data.done ? "done" : "loading" } }));
      if (data.done) return true;
    }
  }

  async function runAll() {
    cancelRef.current = false;
    setRunning("all");
    for (const t of tables) {
      const ok = await loadTable(t.table, t.rows);
      if (!ok) break; // FK order matters — stop at the first failure
    }
    setRunning(null);
  }

  async function runOne(table: string, total: number) {
    cancelRef.current = false;
    setRunning(table);
    await loadTable(table, total);
    setRunning(null);
  }

  const totalRows = tables.reduce((s, t) => s + t.rows, 0);
  const badge = (ok: boolean, label: string) => (
    <span className="badge" style={{ background: ok ? "var(--pos-bg, #e7f6ec)" : "var(--neg-bg, #fdecec)", color: ok ? "#177245" : "#b3261e" }}>
      {ok ? "●" : "○"} {label}
    </span>
  );

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <div className="crumb">Data &amp; Integrations</div>
          <h1>Integrations</h1>
          <p>Backend connection health and the fixture-data loader for the connected Supabase project.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-head">
          <h3>Shared-state backend</h3>
          <button className="btn ghost" onClick={checkHealth} disabled={checking}>
            {checking ? "Checking…" : "Re-check"}
          </button>
        </div>
        {health === null ? (
          <div className="note">Checking…</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span className="pill">backend: {health.backend}</span>
              {badge(health.writable, health.writable ? "connected & writable" : "not writable")}
            </div>
            {!health.writable && (
              <div className="note" style={{ color: "#b3261e" }}>
                ⚠ {health.reason ?? "Writes are failing."} If this mentions a missing table, run supabase/setup.sql in the
                Supabase SQL Editor (it is idempotent), then re-check.
              </div>
            )}
            {health.writable && (
              <div className="note">
                ✓ Plan events, budgets, adjustments, registrations, price edits and alignment changes are saved to Supabase
                and shared with every user of this site.
              </div>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-head">
          <h3>Load data to Supabase</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {running && (
              <button className="btn ghost" onClick={() => (cancelRef.current = true)}>
                Stop
              </button>
            )}
            <button className="btn primary" onClick={runAll} disabled={!!running || configured === false || tables.length === 0}>
              {running === "all" ? "Loading…" : `Load all (${fmtN(totalRows)} rows)`}
            </button>
          </div>
        </div>

        {configured === false && (
          <div className="note" style={{ color: "#b3261e" }}>
            ⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on this deployment, so loading is disabled here.
          </div>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-3)", fontSize: 11 }}>
              <th style={{ padding: "6px 8px" }}>Table</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>Fixture rows</th>
              <th style={{ padding: "6px 8px", width: "40%" }}>Progress</th>
              <th style={{ padding: "6px 8px" }} />
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => {
              const p = prog[t.table];
              const pct = p && p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
              return (
                <tr key={t.table} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "7px 8px", fontWeight: 600 }}>{t.table}</td>
                  <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtN(t.rows)}</td>
                  <td style={{ padding: "7px 8px" }}>
                    {p ? (
                      p.state === "error" ? (
                        <span style={{ color: "#b3261e", fontSize: 11.5 }}>✗ {p.error}</span>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 6, borderRadius: 4, background: "var(--surface-2)", overflow: "hidden" }}>
                            <div
                              style={{
                                width: p.state === "done" ? "100%" : `${pct}%`,
                                height: "100%",
                                background: p.state === "done" ? "#177245" : "var(--brand)",
                                transition: "width .2s",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--ink-3)", minWidth: 86, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {p.state === "done" ? `✓ ${fmtN(p.total)} rows` : `${fmtN(p.loaded)} / ${fmtN(p.total)}`}
                          </span>
                        </div>
                      )
                    ) : (
                      <span style={{ color: "var(--ink-3)", fontSize: 11.5 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "right" }}>
                    <button
                      className="btn ghost"
                      style={{ padding: "4px 10px", fontSize: 11.5 }}
                      onClick={() => runOne(t.table, t.rows)}
                      disabled={!!running || configured === false}
                    >
                      Load
                    </button>
                  </td>
                </tr>
              );
            })}
            {tables.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "10px 8px", color: "var(--ink-3)" }}>
                  Reading fixture inventory…
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="note">
          ◇ Loads the data shipped with this deployment (NIQ weekly history, the Telus FY promo book, crosswalks, price
          list) into the connected Supabase project. Every table upserts on its natural key, so re-loading is always safe —
          after a new workbook or CSV is ingested and deployed, come back here and load just that table.
        </div>
      </div>

      <div className="card">
        <div className="c-head">
          <h3>How new files get in (POC flow)</h3>
        </div>
        <div className="note" style={{ display: "block", lineHeight: 1.7 }}>
          1 · Drop the CSV/Excel file in the repo and run its ingest script (validates and writes the fixture — the audit
          trail in git).
          <br />
          2 · Commit &amp; push — the site redeploys with the new data.
          <br />
          3 · Open this page and load the matching table(s) to Supabase.
          <br />
          Alignment keys are not file loads: they are edited on the Alignment Key screen and save to the shared backend
          automatically. Full runbook: <code>supabase/README.md</code>.
        </div>
      </div>
    </div>
  );
}
