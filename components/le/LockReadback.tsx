"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { parseWorkPath, processPath } from "@/lib/process";

/* Review & lock — the estimate's last step, for ONE account.

   The full year read back in the four numbers the estimate is worked in,
   each against the plan, last year and the last locked estimate; what this
   cycle changed (the answer to "did anything move", the levers on the base,
   the promotions cancelled, changed or added); then the lock. Locking takes
   a version for the cycle being prepared — the next scheduled lock — and
   the scheduled job leaves an account already locked for its cycle alone.
   Lock again and a new version is appended; nothing is ever overwritten. */

export type ReadbackKpi = { fy: number; plan: number; ly: number | null; lastLE: number | null };

export type LockReadbackData = {
  code: string;
  name: string;
  year: number;
  priorYear: number;
  edge: string;
  cycle: { key: string; label: string; lockDate: string; daysToLock: number };
  kpis: { units: ReadbackKpi; gross: ReadbackKpi; trade: ReadbackKpi; margin: ReadbackKpi };
  lastLE: { label: string; seq: number; takenAt: string; cycle: string | null } | null;
  lockedThisCycle: { seq: number; takenAt: string } | null;
  answer: "none" | "adjusting" | null;
  adjustments: { brand: string; item: string | null; kind: string; pct: number; from: string; to: string }[];
  promos: { kind: "cancelled" | "changed" | "added"; title: string; detail: string }[];
};

const fmtU = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3).toLocaleString()}K` : String(Math.round(v));
const fmt$ = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1e3).toLocaleString()}K` : `$${Math.round(x)}`;
  return v < 0 ? `−${t}` : t;
};
const pct = (now: number, base: number | null) => (base ? (now / base - 1) * 100 : null);
const show = (d: number | null) => (d === null ? "—" : Math.abs(d) < 0.05 ? "0.0%" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`);
const col = (d: number | null, up: "good" | "neutral") =>
  d === null || up === "neutral" || Math.abs(d) < 0.05 ? "var(--ink-2)" : d >= 0 ? "var(--good)" : "var(--bad)";
const KIND: Record<string, string> = { distribution: "Distribution", price: "Base price", trend: "Trend" };

export default function LockReadback({ a }: { a: LockReadbackData }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = parseWorkPath(pathname);
  const stepHref = (key: string) => (loc ? processPath(loc.proc.kind, key) : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lock = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/plansnap/${a.code}/${a.year}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim(), cycle: a.cycle.key }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      setNote("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not lock");
    } finally {
      setBusy(false);
    }
  };

  const ly = `FY${a.priorYear}`;
  const rows: { label: string; k: ReadbackKpi; fmt: (v: number) => string; up: "good" | "neutral"; note?: string }[] = [
    { label: "Units", k: a.kpis.units, fmt: fmtU, up: "good" },
    { label: "Gross sales · at list", k: a.kpis.gross, fmt: fmt$, up: "good" },
    { label: "Trade spend", k: a.kpis.trade, fmt: fmt$, up: "neutral", note: "the Telus book, with this estimate's changes" },
    { label: "Gross margin · after trade", k: a.kpis.margin, fmt: fmt$, up: "good", note: "gross sales − trade · no product cost in the data yet" },
  ];
  const changed = a.adjustments.length + a.promos.length;

  return (
    <div className="card lockrb" style={{ padding: 0, marginBottom: 16 }}>
      <div className="lockrb-head">
        <div>
          <b>Review &amp; lock — {a.name}, {a.cycle.label}</b>
          <span>
            Full year FY{a.year}: actuals through {a.edge} plus the estimate to go, with this cycle&apos;s changes in.
            {a.cycle.label} locks at the end of {a.cycle.lockDate}{a.cycle.daysToLock > 0 ? ` — ${a.cycle.daysToLock} day${a.cycle.daysToLock === 1 ? "" : "s"}` : " — due now"}.
          </span>
        </div>
        {a.lockedThisCycle
          ? <span className="pill" style={{ borderColor: "var(--good)", color: "var(--good)" }}>✓ {a.cycle.label} locked · v{a.lockedThisCycle.seq} · {a.lockedThisCycle.takenAt.slice(0, 10)}</span>
          : <span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>{a.cycle.label} not locked yet</span>}
      </div>

      <div className="lockrb-grid">
        <table className="revtable">
          <thead>
            <tr>
              <th>Full year FY{a.year}</th>
              <th style={{ textAlign: "right" }}>Estimate</th>
              <th style={{ textAlign: "right" }}>Plan</th>
              <th style={{ textAlign: "right" }}>vs plan</th>
              <th style={{ textAlign: "right" }}>{ly}</th>
              <th style={{ textAlign: "right" }}>vs {ly}</th>
              <th style={{ textAlign: "right" }}>{a.lastLE ? a.lastLE.label : "Last LE"}</th>
              <th style={{ textAlign: "right" }}>vs last LE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dp = pct(r.k.fy, r.k.plan), dl = pct(r.k.fy, r.k.ly), de = pct(r.k.fy, r.k.lastLE);
              return (
                <tr key={r.label}>
                  <td><b>{r.label}</b>{r.note && <div className="dim">{r.note}</div>}</td>
                  <td className="num"><b>{r.fmt(r.k.fy)}</b></td>
                  <td className="num">{r.fmt(r.k.plan)}</td>
                  <td className="num" style={{ color: col(dp, r.up), fontWeight: 700 }}>{show(dp)}</td>
                  <td className="num">{r.k.ly === null ? <span className="dim">—</span> : r.fmt(r.k.ly)}</td>
                  <td className="num" style={{ color: col(dl, r.up), fontWeight: 700 }}>{show(dl)}</td>
                  <td className="num">{r.k.lastLE === null ? <span className="dim">—</span> : r.fmt(r.k.lastLE)}</td>
                  <td className="num" style={{ color: col(de, "neutral"), fontWeight: 700 }}>{show(de)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="lockrb-changes">
          <b>What this cycle changed</b>
          <div className="lockrb-answer">
            {a.answer === "none"
              ? <>Answered <b>nothing changed</b> this month.</>
              : a.answer === "adjusting"
                ? <>Answered <b>adjusting</b> — {changed ? `${changed} change${changed === 1 ? "" : "s"} below` : "nothing entered yet"}.</>
                : <>The &ldquo;did anything move&rdquo; question has not been answered this cycle.{stepHref("lebase") && <> <Link href={stepHref("lebase")!}>Answer it →</Link></>}</>}
          </div>
          <ul className="revlist" style={{ padding: "4px 0 0" }}>
            {a.adjustments.map((x, i) => (
              <li key={"a" + i}>
                <b style={{ color: x.pct >= 0 ? "var(--good)" : "var(--bad)" }}>{x.pct >= 0 ? "+" : "−"}{Math.abs(x.pct)}%</b>{" "}
                {KIND[x.kind] ?? x.kind} · {x.item ?? `all ${x.brand} items`} <span className="dim">· {x.from} → {x.to}</span>
              </li>
            ))}
            {a.promos.map((x, i) => (
              <li key={"p" + i}>
                <span className={"minichip on pr-" + x.kind}>{x.kind}</span> {x.title} <span className="dim">· {x.detail}</span>
              </li>
            ))}
            {!changed && <li className="dim">No levers on the base and no promotion changes — the estimate is the carried book on the current run-rate.</li>}
          </ul>
          <div className="lockrb-links">
            {stepHref("lebase") && <Link className="btn sm" href={stepHref("lebase")!}>Base →</Link>}
            {stepHref("promos") && <Link className="btn sm" href={stepHref("promos")!}>Promotions →</Link>}
          </div>
        </div>
      </div>

      <div className="lockrb-foot">
        <input
          placeholder={a.lockedThisCycle ? "Re-lock note (optional) — what moved since" : "Lock note (optional) — what moved and why; travels with the version"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          disabled={busy}
        />
        <button className="btn primary" onClick={lock} disabled={busy}
          title={a.lockedThisCycle ? `Take another ${a.cycle.label} version with the estimate as it stands now` : `Freeze this estimate as ${a.cycle.label} for ${a.name}`}>
          {busy ? "Locking…" : a.lockedThisCycle ? `Lock ${a.cycle.label} again` : `Lock ${a.cycle.label}`}
        </button>
        {err && <span className="dim" style={{ color: "var(--bad)" }}>{err}</span>}
        <span className="dim" style={{ flex: "1 1 100%", fontSize: 11.5 }}>
          ◇ The scheduled lock runs at the end of the second Friday and leaves an account already locked for its cycle alone. Versions are append-only.
          After this lock, the next cycle&apos;s adjustments can start straight away.
        </span>
      </div>
    </div>
  );
}
