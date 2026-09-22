"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LeCycle } from "@/lib/leSchedule";
import type { LeCronRun } from "@/lib/server/leCron";

/* Latest Estimate (LE) view — see app/le/page.tsx. */

export type VersionLite = {
  id: string; seq: number; kind: "por" | "le"; label: string; taken_at: string; note: string;
  cycle?: string; scheduled_lock?: string; locked_late?: boolean;
  total: number; adjustments: number; distver: { out: number; added: number; verifiedAt: string | null };
};

export type LeRow = {
  code: string;
  name: string;
  versions: VersionLite[];
  live: { total: number; adjustments: number; distver: { out: number; added: number; verifiedAt: string | null } } | null;
  lockedForDue: boolean;
  lockedCycle: string | null;
  signedOff: boolean;
  hasVersions: boolean;
};

export type LeData = {
  kind: "le" | "plan";
  schedule: { due: LeCycle; open: LeCycle; daysToLock: number } | null;
  lastLockRun: LeCronRun | null;
  hint: string | null;
  year: number;
  month: string;
  dataEdge: string;
  telusSnapshot: string;
  brands: string[];
  rows: LeRow[];
  totals: { customers: number; taken: number; signed: number; verified: number; adjustments: number; events: number };
  portfolio: { months: string[]; latest: Record<string, number[]>; previous: Record<string, number[]>; live: Record<string, number[]> };
};

const selStyle: React.CSSProperties = {
  border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", font: "inherit",
  fontWeight: 700, fontSize: 12.5, padding: "8px 12px", borderRadius: 10,
};
const fmtU = (v: number) =>
  Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3).toLocaleString() + "K" : String(Math.round(v));
const fmtD = (d: number) => (d === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmtU(Math.abs(d))}`);
const changed = (a: number, b: number) => Math.abs(a - b) > Math.max(5, Math.abs(b) * 0.002);
const td: React.CSSProperties = { padding: "9px 12px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const num: React.CSSProperties = { ...td, textAlign: "right" };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export default function LeView({ data }: { data: LeData }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);   // market code being taken, or "ALL"
  const [msg, setMsg] = useState<string | null>(null);
  const plan = data.kind === "plan";
  const canAct = data.hint === null;

  const take = async (codes: string[]) => {
    setBusy(codes.length === 1 ? codes[0] : "ALL");
    setMsg(null);
    let ok = 0, fail = 0;
    for (const code of codes) {
      try {
        const r = await fetch(`/api/plansnap/${code}/${data.year}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: note.trim(), ...(data.schedule ? { cycle: data.schedule.due.key } : {}) }),
        });
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setBusy(null);
    setNote("");
    setMsg(`${plan ? "Signed off" : "Locked"} ${ok} ${ok === 1 ? "account" : "accounts"}${fail ? ` · ${fail} failed` : ""}.`);
    router.refresh();
  };

  // bulk targets: LE — every account not yet locked for the due cycle;
  // Plan — verified but unsigned
  const bulk = data.rows.filter((r) => (plan ? !r.signedOff && r.live?.distver.verifiedAt : !r.lockedForDue)).map((r) => r.code);
  const sched = data.schedule;
  const overdue = !plan && !!sched && sched.daysToLock <= 0;

  const latestTotal = sum(data.rows.map((r) => r.versions.at(-1)?.total ?? 0));
  const prevTotal = sum(data.rows.map((r) => (r.versions.length > 1 ? r.versions[r.versions.length - 2].total : r.versions.at(-1)?.total ?? 0)));
  const liveTotal = sum(data.rows.map((r) => r.live?.total ?? 0));
  const drifted = data.rows.filter((r) => r.live && r.versions.length && changed(r.live.total, r.versions.at(-1)!.total)).length;

  const port = useMemo(() => {
    const tot = (m: Record<string, number[]>) => data.portfolio.months.map((_, i) => sum(Object.values(m).map((a) => a[i] ?? 0)));
    return { latest: tot(data.portfolio.latest), previous: tot(data.portfolio.previous), live: tot(data.portfolio.live) };
  }, [data.portfolio]);

  const actionLabel = (r: LeRow) =>
    plan
      ? (r.hasVersions ? "Take LE" : "Take Plan of Record")
      : (r.lockedForDue ? "Re-lock" : "Lock");

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <h1>{plan ? `Plan sign-off — ${data.year}` : `Latest Estimate — FY${data.year}`}</h1>
          <p>
            {plan
              ? <>Every customer&apos;s {data.year} plan base side by side: distribution verification, adjustments, and the
                Plan of Record sign-off that freezes v1. Later versions are the in-year Latest Estimates; each one is
                diffable against the last and against the Plan of Record.</>
              : <>Every account locks on the same schedule: the forecast on record at the{" "}
                <b>end of the second Friday</b> of each month becomes that month&apos;s Latest Estimate and never moves again. This is{" "}
                {sched ? <><b>{sched.due.label}</b> (read {sched.due.lockDate})</> : "the current cycle"} against the
                working forecast right now — actuals through the NIQ edge plus the forecast to year-end, with LE
                adjustments. Versions are append-only and diffable.</>}
          </p>
        </div>
        <div className="actions">
          {data.hint && <span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)" }} title={data.hint}>Analyze mode — read only</span>}
          {sched && !plan && (
            <span className="pill" style={overdue ? { borderColor: "var(--warn)", color: "var(--warn)" } : undefined}
              title={`The forecast freezes at the end of the second Friday. ${sched.due.label} was read on ${sched.due.lockDate}; the next lock is ${sched.open.lockDate}.`}>
              {overdue ? "lock due now" : `next lock ${sched.open.lockDate} · ${sched.daysToLock}d`}
            </span>
          )}
          <span className="pill">NIQ through {data.dataEdge}</span>
          <span className="pill">Telus book {data.telusSnapshot}</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">{plan ? "Plan of Record signed" : `Locked · ${sched?.due.label ?? "cycle"}`}</span></div>
          <div className="k-val" style={!plan && data.totals.taken < data.totals.customers ? { color: "var(--warn)" } : undefined}>
            {plan ? data.totals.signed : data.totals.taken} <span style={{ fontSize: 14, color: "var(--ink-3)" }}>of {data.totals.customers}</span>
          </div>
          <div className="k-sub flat">
            {plan ? `${data.totals.verified} of ${data.totals.customers} distribution verified`
              : sched
              ? (sched.daysToLock > 0
                  ? `next lock ${sched.open.lockDate} · ${sched.daysToLock} day${sched.daysToLock === 1 ? "" : "s"}`
                  : "next lock due now")
              : `${data.totals.customers - data.totals.taken} still open`}
          </div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Portfolio full year — latest versions</span></div>
          <div className="k-val">{fmtU(latestTotal)} <span style={{ fontSize: 14, color: "var(--ink-3)" }}>units</span></div>
          <div className="k-sub flat">{fmtD(latestTotal - prevTotal)} vs previous versions</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Working {plan ? "plan" : "forecast"} right now</span></div>
          <div className="k-val" style={{ color: changed(liveTotal, latestTotal) ? "var(--warn)" : undefined }}>{fmtU(liveTotal)}</div>
          <div className="k-sub flat">{fmtD(liveTotal - latestTotal)} vs latest versions · {drifted} customer{drifted === 1 ? "" : "s"} moved</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Adjustments in play</span></div>
          <div className="k-val">{data.totals.adjustments}</div>
          <div className="k-sub flat">{plan ? `${data.totals.events} events in the ${data.year} plan` : "LE levers on the forecast-to-go"}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center" }}>
          <b>{plan ? `Customers — ${data.year} plan` : `Accounts — ${sched?.due.label ?? "LE"}`}</b>
          <input
            style={{ ...selStyle, flex: "1 1 260px", minWidth: 200, fontWeight: 500 }}
            placeholder={plan ? "Sign-off note (optional) — applies to the versions you take from here" : "Lock note (optional) — what moved and why; recorded on every account you lock from here"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            disabled={!canAct}
          />
          <button
            className="btn primary"
            style={{ ...selStyle, cursor: bulk.length && canAct ? "pointer" : "default", opacity: bulk.length && canAct ? 1 : 0.5 }}
            disabled={!bulk.length || !canAct || busy !== null}
            title={plan ? "Take the Plan of Record for every customer whose distribution is verified and who has no sign-off yet" : `Lock ${sched?.due.label ?? "this cycle"} for every account not yet locked — the scheduled portfolio freeze`}
            onClick={() => {
              if (!window.confirm(plan
                ? `Sign off the Plan of Record for ${bulk.length} customer${bulk.length === 1 ? "" : "s"} (verified, unsigned)? Versions are append-only.`
                : `Lock ${sched?.due.label ?? "this cycle"} for ${bulk.length} account${bulk.length === 1 ? "" : "s"}? The forecast on record for ${sched?.due.lockDate ?? "the lock date"} freezes and cannot be edited afterwards.`)) return;
              void take(bulk);
            }}
          >
            {busy === "ALL" ? "Locking…" : plan ? `Sign off ${bulk.length} verified & unsigned` : `Lock ${sched?.due.label ?? "cycle"} · ${bulk.length} account${bulk.length === 1 ? "" : "s"}`}
          </button>
          {msg && <span className="pill" style={{ borderColor: "var(--good)", color: "var(--good)" }}>{msg}</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Latest version</th>
                <th>Note</th>
                <th style={{ textAlign: "right" }}>Versions</th>
                <th style={{ textAlign: "right" }}>Full year — latest</th>
                <th style={{ textAlign: "right" }}>Working now</th>
                <th style={{ textAlign: "right" }}>Δ since</th>
                <th style={{ textAlign: "right" }}>Adj</th>
                <th>Distribution</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const latest = r.versions.at(-1);
                const drift = r.live && latest ? r.live.total - latest.total : 0;
                const moved = !!(r.live && latest && changed(r.live.total, latest.total));
                const dv = r.live?.distver;
                return (
                  <tr key={r.code}>
                    <td style={td}><b>{r.name}</b></td>
                    <td style={td}>
                      {latest ? (<>
                        <span className="pill" style={latest.kind === "por" ? { borderColor: "var(--good)", color: "var(--good)" } : undefined}>
                          v{latest.seq} · {latest.label}
                        </span>{" "}
                        <span style={{ fontSize: 12, color: "var(--ink-3)" }}
                          title={latest.scheduled_lock
                            ? `Forecast on record for the scheduled lock${latest.locked_late ? ` — run ${latest.taken_at.slice(0, 10)}, after the lock instant` : ""}`
                            : `Taken ${latest.taken_at.slice(0, 10)}`}>
                          {latest.scheduled_lock ? new Date(new Date(latest.scheduled_lock).getTime() - 86400000).toISOString().slice(0, 10) : latest.taken_at.slice(0, 10)}
                          {latest.locked_late ? " ·  late" : ""}
                        </span>
                        {!plan && r.lockedForDue && <span style={{ marginLeft: 6, color: "var(--good)", fontWeight: 800, fontSize: 12 }}>✓ locked</span>}
                      </>) : (
                        <span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>{plan ? "not signed off" : "no LE yet"}</span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "normal", maxWidth: 240, fontSize: 12.5, color: "var(--ink-2)" }}>{latest?.note || "—"}</td>
                    <td style={num}>{r.versions.length}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{latest ? fmtU(latest.total) : "—"}</td>
                    <td style={num}>{r.live ? fmtU(r.live.total) : "—"}</td>
                    <td style={{ ...num, fontWeight: 700, color: moved ? (drift > 0 ? "var(--good)" : "var(--bad)") : "var(--ink-3)" }}>
                      {latest && r.live ? fmtD(drift) : "—"}
                    </td>
                    <td style={num}>{r.live?.adjustments ?? 0}</td>
                    <td style={td}>
                      {dv ? (dv.verifiedAt
                        ? <span style={{ color: "var(--good)", fontWeight: 700, fontSize: 12 }}>✓ {dv.out} out · {dv.added} added</span>
                        : <span style={{ color: plan ? "var(--warn)" : "var(--ink-3)", fontWeight: 700, fontSize: 12 }}>{plan ? "⚠ unverified" : "carried"}</span>)
                        : "—"}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                        <button
                          className={"btn" + (latest && !moved && (plan || r.lockedForDue) ? "" : " primary")}
                          style={{ ...selStyle, padding: "6px 10px", cursor: canAct ? "pointer" : "default", opacity: canAct ? 1 : 0.5 }}
                          disabled={!canAct || busy !== null}
                          title={plan
                            ? (r.hasVersions ? `Freeze the current ${data.year} plan base as the next LE version` : `Freeze the current ${data.year} plan base as v1 — the Plan of Record`)
                            : `Lock this account's FY${data.year} forecast for ${sched?.due.label ?? "this cycle"} — every account locks on the same schedule, so do this only to catch one up`}
                          onClick={() => void take([r.code])}
                        >
                          {busy === r.code ? "Taking…" : actionLabel(r)}
                        </button>
                        <a
                          href={`/base?mkt=${encodeURIComponent(r.code)}`}
                          className="minichip"
                          style={{ textDecoration: "none", whiteSpace: "nowrap" }}
                          title="Open this customer in Base & Lift — the year follows the top-bar mode"
                        >
                          Base &amp; Lift →
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ margin: 0, padding: "10px 16px" }}>
          {!plan && (<>
            ◇ The lock runs <b>automatically</b> just after midnight UTC each day and acts at the second-Friday
            boundary, so a cycle closes without anyone pressing anything.{" "}
            {data.lastLockRun
              ? <>Last automated lock: <b>{data.lastLockRun.cycle}</b> on {data.lastLockRun.at.slice(0, 10)} —{" "}
                {data.lastLockRun.locked.length} account{data.lastLockRun.locked.length === 1 ? "" : "s"} locked
                {data.lastLockRun.failed.length > 0 && <span style={{ color: "var(--bad)", fontWeight: 700 }}>, {data.lastLockRun.failed.length} failed</span>}
                {!data.lastLockRun.onTime && <span style={{ color: "var(--warn)", fontWeight: 700 }}> (late)</span>}.
                The button above is the manual catch-up.</>
              : <>No automated run has locked a cycle yet; the button above locks one by hand.</>}
            <br />
          </>)}
          ◇ <b>Full year — latest</b> is the last frozen version&apos;s adjusted units (all Heartland brands); <b>Working now</b> is the same
          construction computed live — {plan ? "the carried + projected plan base with distribution verification and adjustments" : "actuals through the NIQ edge plus the forecast to year-end with LE adjustments"}.
          A Δ in color means the working forecast has moved more than 0.2% (or 5 units) since that account&apos;s last locked
          version — that drift is what the next lock will capture. Versions are never edited or deleted.
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <b>Portfolio by month — latest versions vs previous</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>units · sum of every customer&apos;s latest frozen version, by brand</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                {data.portfolio.months.map((m) => <th key={m} style={{ textAlign: "right" }}>{m}</th>)}
                <th style={{ textAlign: "right" }}>Full year</th>
              </tr>
            </thead>
            <tbody>
              {data.brands.filter((b) => sum(data.portfolio.latest[b] ?? []) > 0 || sum(data.portfolio.live[b] ?? []) > 0).map((b) => {
                const a = data.portfolio.latest[b] ?? Array(12).fill(0);
                return (
                  <tr key={b}>
                    <td style={td}><b>{b}</b></td>
                    {a.map((v, i) => <td key={i} style={num}>{v ? fmtU(v) : "—"}</td>)}
                    <td style={{ ...num, fontWeight: 700 }}>{fmtU(sum(a))}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid var(--line)" }}>
                <td style={td}><b>Total — latest</b></td>
                {port.latest.map((v, i) => <td key={i} style={{ ...num, fontWeight: 700 }}>{v ? fmtU(v) : "—"}</td>)}
                <td style={{ ...num, fontWeight: 800 }}>{fmtU(sum(port.latest))}</td>
              </tr>
              <tr>
                <td style={td}>Total — previous versions</td>
                {port.previous.map((v, i) => <td key={i} style={num}>{v ? fmtU(v) : "—"}</td>)}
                <td style={{ ...num, fontWeight: 700 }}>{fmtU(sum(port.previous))}</td>
              </tr>
              <tr>
                <td style={td}>Δ latest vs previous</td>
                {port.latest.map((v, i) => {
                  const d = v - port.previous[i];
                  return <td key={i} style={{ ...num, color: d === 0 ? "var(--ink-3)" : d > 0 ? "var(--good)" : "var(--bad)" }}>{fmtD(d)}</td>;
                })}
                <td style={{ ...num, fontWeight: 700 }}>{fmtD(sum(port.latest) - sum(port.previous))}</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--line)" }}>
                <td style={td}>Working now (live)</td>
                {port.live.map((v, i) => <td key={i} style={num}>{v ? fmtU(v) : "—"}</td>)}
                <td style={{ ...num, fontWeight: 700 }}>{fmtU(sum(port.live))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note" style={{ margin: 0, padding: "10px 16px" }}>
          ◇ Where a customer has only one version, its previous equals its latest (no Δ). The live row is what the next
          version would freeze today.
        </div>
      </div>
    </div>
  );
}
