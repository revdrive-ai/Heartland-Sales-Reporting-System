"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/* Versions of one account's plan, side by side.

   A plan year can hold several candidate versions — each a frozen read of
   the base, the levers, the distribution answers and the promotion plan
   with its money. This card lists them, lets them be named, compares any
   two or three (and the plan as it stands now) in the numbers the plan is
   judged on, says WHAT differs between them, and makes one of them the
   plan: the version submitted for approval.

   Choosing is the submission. It sits beside the versions as a small
   record, so choosing an older candidate never rewrites a newer one. */

/** What a version (or the live plan) is compared on. */
export type VersionFacts = {
  total: number;                                          // full-year plan base, adjusted, units
  base: number;                                           // the same before the levers
  byBrand: { brand: string; adjusted: number }[];
  items: Record<string, { name: string; brand: string; units: number }>;
  adjustments: { id: string; kind: string; brand: string; item: string | null; pct: number; from: string; to: string }[];
  dist: { out: string[]; added: string[] } | null;        // by name; null for a version frozen before names were kept
  distCounts: { out: number; added: number };
  plan: null | {
    events: number;
    spend: number;
    rows: { id: string; title: string; brand: string; perf: string; start: string; end: string; spend: number; lift: number | null }[];
    totals: { gross: number; grossPrior: number; grossTarget: number; spend: number; spendPrior: number; fund: number; priorYear: number } | null;
  };
};

export type ReviewVersion = VersionFacts & {
  id: string; seq: number; kind: "por" | "le"; label: string; name: string | null;
  takenAt: string; note: string; fromReview: boolean;
};

export type PlanChoiceLite = { id: string; at: string; note: string };

const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000).toLocaleString()}K` : Math.round(n).toLocaleString());
const money = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1e3).toLocaleString()}K` : `$${Math.round(x)}`;
  return v < 0 ? `−${t}` : t;
};
const fmtD = (d: number, f: (n: number) => string) => (Math.abs(d) < 0.5 ? "—" : `${d > 0 ? "+" : "−"}${f(Math.abs(d))}`);
const pct = (d: number, base: number) => (base ? ` (${d >= 0 ? "+" : "−"}${(Math.abs(d / base) * 100).toFixed(1)}%)` : "");

export const versionTitle = (v: { name: string | null; label: string; seq: number }) => v.name ?? `${v.label} · v${v.seq}`;

type Col = { key: string; title: string; sub: string; facts: VersionFacts; version: ReviewVersion | null };

/** One row of the comparison: a number per column, with the delta against the first. */
function Row({ label, cols, get, fmt, good }: { label: string; cols: Col[]; get: (f: VersionFacts) => number | null; fmt: (n: number) => string; good: "up" | "down" | "none" }) {
  const ref = get(cols[0].facts);
  return (
    <tr>
      <td>{label}</td>
      {cols.map((c, i) => {
        const v = get(c.facts);
        const d = v !== null && ref !== null && i > 0 ? v - ref : null;
        const tone = d === null || good === "none" || Math.abs(d) < 0.5 ? "var(--ink-3)" : (d > 0) === (good === "up") ? "var(--good)" : "var(--bad)";
        return (
          <td key={c.key} className="num">
            {v === null ? <span className="dim">—</span> : <b>{fmt(v)}</b>}
            {d !== null && <div className="pv-delta" style={{ color: tone }}>{fmtD(d, fmt)}{d !== 0 && ref ? pct(d, ref) : ""}</div>}
          </td>
        );
      })}
    </tr>
  );
}

/** Two columns hold the same plan when nothing the comparison reads differs. */
function sameFacts(a: VersionFacts, b: VersionFacts): boolean {
  const adjKeys = (f: VersionFacts) => f.adjustments.map((x) => `${x.kind}|${x.brand}|${x.item ?? "ALL"}|${x.pct}|${x.from}|${x.to}`).sort().join(";");
  const evKeys = (f: VersionFacts) => (f.plan?.rows ?? []).map((e) => `${e.id}|${e.start}|${e.end}|${e.spend}|${e.lift ?? ""}`).sort().join(";");
  const dist = (f: VersionFacts) => (f.dist ? `${f.dist.out.join(",")}/${f.dist.added.join(",")}` : `${f.distCounts.out}/${f.distCounts.added}`);
  return Math.round(a.total) === Math.round(b.total) && Math.round(a.base) === Math.round(b.base)
    && adjKeys(a) === adjKeys(b) && evKeys(a) === evKeys(b) && dist(a) === dist(b);
}

/** What differs between two versions, in words: items, levers, events, distribution. */
function Differences({ from, to }: { from: Col; to: Col }) {
  const a = from.facts, b = to.facts;
  const items = useMemo(() => {
    const keys = new Set([...Object.keys(a.items), ...Object.keys(b.items)]);
    return [...keys]
      .map((u) => {
        const x = a.items[u]?.units ?? 0, y = b.items[u]?.units ?? 0;
        return { upc: u, name: (b.items[u] ?? a.items[u]).name, brand: (b.items[u] ?? a.items[u]).brand, from: x, to: y, delta: y - x };
      })
      .filter((r) => Math.abs(r.delta) >= 1)
      .sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));
  }, [a, b]);
  const adjKey = (x: VersionFacts["adjustments"][number]) => `${x.kind}|${x.brand}|${x.item ?? "ALL"}|${x.pct}|${x.from}|${x.to}`;
  const aAdj = new Map(a.adjustments.map((x) => [adjKey(x), x])), bAdj = new Map(b.adjustments.map((x) => [adjKey(x), x]));
  const adjAdded = b.adjustments.filter((x) => !aAdj.has(adjKey(x)));
  const adjGone = a.adjustments.filter((x) => !bAdj.has(adjKey(x)));
  const aEv = new Map((a.plan?.rows ?? []).map((e) => [e.id, e])), bEv = new Map((b.plan?.rows ?? []).map((e) => [e.id, e]));
  const evAdded = [...bEv.values()].filter((e) => !aEv.has(e.id));
  const evGone = [...aEv.values()].filter((e) => !bEv.has(e.id));
  const evChanged = [...bEv.values()].filter((e) => {
    const o = aEv.get(e.id);
    return o && (o.spend !== e.spend || o.start !== e.start || o.end !== e.end || o.lift !== e.lift);
  });
  const setDiff = (x: string[], y: string[]) => x.filter((n) => !y.includes(n));
  const distKnown = !!a.dist && !!b.dist;
  const outAdded = distKnown ? setDiff(b.dist!.out, a.dist!.out) : [], outGone = distKnown ? setDiff(a.dist!.out, b.dist!.out) : [];
  const newAdded = distKnown ? setDiff(b.dist!.added, a.dist!.added) : [], newGone = distKnown ? setDiff(a.dist!.added, b.dist!.added) : [];
  const nothing = !items.length && !adjAdded.length && !adjGone.length && !evAdded.length && !evGone.length && !evChanged.length
    && !outAdded.length && !outGone.length && !newAdded.length && !newGone.length;
  const adjText = (x: VersionFacts["adjustments"][number]) => `${x.pct >= 0 ? "+" : "−"}${Math.abs(x.pct)}% ${x.kind} · ${x.item ?? `all ${x.brand}`} · ${x.from} → ${x.to}`;
  const evText = (e: NonNullable<VersionFacts["plan"]>["rows"][number]) => `${e.title || e.perf} · ${e.brand} · ${e.start} → ${e.end} · $${e.spend.toLocaleString()}`;
  return (
    <div className="pv-diff">
      <b>{from.title} → {to.title}</b>
      {nothing ? <div className="dim">Nothing differs between these two.</div> : (
        <div className="pv-diffgrid">
          {items.length > 0 && (
            <div>
              <span className="pv-h">Items that moved · top {Math.min(items.length, 8)} of {items.length}</span>
              <ul>
                {items.slice(0, 8).map((r) => (
                  <li key={r.upc}>
                    <b style={{ color: r.delta > 0 ? "var(--good)" : "var(--bad)" }}>{fmtD(r.delta, fmtK)}</b> {r.name} <span className="dim">· {r.brand} · {fmtK(r.from)} → {fmtK(r.to)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(adjAdded.length > 0 || adjGone.length > 0) && (
            <div>
              <span className="pv-h">Levers on the base</span>
              <ul>
                {adjAdded.map((x) => <li key={"a" + x.id}><span className="minichip on yes">added</span> {adjText(x)}</li>)}
                {adjGone.map((x) => <li key={"g" + x.id}><span className="minichip on no">removed</span> {adjText(x)}</li>)}
              </ul>
            </div>
          )}
          {(evAdded.length > 0 || evGone.length > 0 || evChanged.length > 0) && (
            <div>
              <span className="pv-h">Promotion events</span>
              <ul>
                {evAdded.map((e) => <li key={"a" + e.id}><span className="minichip on yes">added</span> {evText(e)}</li>)}
                {evGone.map((e) => <li key={"g" + e.id}><span className="minichip on no">removed</span> {evText(e)}</li>)}
                {evChanged.map((e) => {
                  const o = aEv.get(e.id)!;
                  return <li key={"c" + e.id}><span className="minichip on">changed</span> {e.title || e.perf} · {e.brand} <span className="dim">· {o.start} → {o.end} ${o.spend.toLocaleString()}{o.lift !== null ? ` ${o.lift}%` : ""} became {e.start} → {e.end} ${e.spend.toLocaleString()}{e.lift !== null ? ` ${e.lift}%` : ""}</span></li>;
                })}
              </ul>
            </div>
          )}
          {(outAdded.length > 0 || outGone.length > 0 || newAdded.length > 0 || newGone.length > 0) && (
            <div>
              <span className="pv-h">Distribution</span>
              <ul>
                {outAdded.map((n) => <li key={"o" + n}><span className="minichip on no">no volume</span> {n}</li>)}
                {outGone.map((n) => <li key={"i" + n}><span className="minichip on yes">back in</span> {n}</li>)}
                {newAdded.map((n) => <li key={"n" + n}><span className="minichip on yes">new item</span> {n}</li>)}
                {newGone.map((n) => <li key={"r" + n}><span className="minichip on no">new item dropped</span> {n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PlanVersions({ code, year, versions, chosen, now, locked, busy: outerBusy }: {
  code: string; year: number; versions: ReviewVersion[]; chosen: PlanChoiceLite | null; now: VersionFacts;
  locked: boolean; busy?: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [withNow, setWithNow] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const call = async (key: string, req: () => Promise<Response>) => {
    if (busy) return;
    setBusy(key); setErr(null);
    try {
      const r = await req();
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(null);
    }
  };
  const url = `/api/plansnap/${code}/${year}`;
  const json = { "content-type": "application/json" };
  const save = () => call("save", () => fetch(url, { method: "POST", headers: json, body: JSON.stringify({ name: saveName.trim() }) })).then(() => setSaveName(""));
  const choose = (v: ReviewVersion) => {
    if (!window.confirm(`Make "${versionTitle(v)}" the plan for ${year}? This is the submission for approval, and it locks the plan's steps.`)) return;
    void call("choose:" + v.id, () => fetch(url, { method: "PUT", headers: json, body: JSON.stringify({ id: v.id }) }));
  };
  const rename = (id: string, name: string) => {
    setRenaming(null);
    void call("rename:" + id, () => fetch(url, { method: "PATCH", headers: json, body: JSON.stringify({ id, name }) }));
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? [...p.slice(1), id] : [...p, id]));
  const cols: Col[] = useMemo(() => {
    const vs = versions.filter((v) => picked.includes(v.id)).sort((a, b) => a.seq - b.seq)
      .map((v): Col => ({ key: v.id, title: versionTitle(v), sub: `${v.label} · v${v.seq} · ${v.takenAt.slice(0, 10)}`, facts: v, version: v }));
    return withNow && vs.length ? [...vs, { key: "now", title: "As it stands now", sub: "the live plan — not a version", facts: now, version: null }] : vs;
  }, [versions, picked, withNow, now]);

  const chosenV = chosen ? versions.find((v) => v.id === chosen.id) ?? null : null;
  const drift = (v: VersionFacts) => v.total - now.total;
  const brands = useMemo(() => [...new Set(cols.flatMap((c) => c.facts.byBrand.map((b) => b.brand)))].sort(), [cols]);
  const brandOf = (f: VersionFacts, b: string) => f.byBrand.find((x) => x.brand === b)?.adjusted ?? 0;
  const gross = (f: VersionFacts) => f.plan?.totals?.gross ?? null;
  const spend = (f: VersionFacts) => (f.plan ? f.plan.spend : null);
  const margin = (f: VersionFacts) => (f.plan?.totals ? f.plan.totals.gross - f.plan.totals.spend : null);

  return (
    <section className="card revsec pvcard">
      <header>
        <span className="n">5</span>
        <div>
          <b>Plan versions</b>
          <span>
            {versions.length
              ? <>{versions.length} version{versions.length === 1 ? "" : "s"} of {year} for this account{chosenV ? <> · <b>{versionTitle(chosenV)}</b> is the plan, chosen {chosen!.at.slice(0, 10)}</> : " · none chosen as the plan yet"}. Tick two or three to compare them; name them so they can be told apart.</>
              : <>No versions yet. Save the plan as it stands to keep a candidate; submitting below saves one and makes it the plan.</>}
          </span>
        </div>
        <div className="pv-save noprint">
          <input placeholder="Name this version (optional)" value={saveName} onChange={(e) => setSaveName(e.target.value)} disabled={!!busy || outerBusy} maxLength={80} />
          <button className="btn" onClick={save} disabled={!!busy || outerBusy} title="Freeze the plan as it stands now as a version, without making it the plan">
            {busy === "save" ? "Saving…" : "Save as a version"}
          </button>
        </div>
      </header>

      {versions.length > 0 && (
        <div className="pv-wrap">
          <table className="revtable pvtable">
            <thead>
              <tr>
                <th className="noprint" title="Tick to compare">⇄</th>
                <th>Version</th>
                <th style={{ textAlign: "right" }}>Plan base</th>
                <th style={{ textAlign: "right" }}>Levers</th>
                <th style={{ textAlign: "right" }}>No vol · new</th>
                <th style={{ textAlign: "right" }}>Events</th>
                <th style={{ textAlign: "right" }}>Trade</th>
                <th style={{ textAlign: "right" }}>Gross</th>
                <th>Status</th>
                <th className="noprint" />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const isChosen = chosen?.id === v.id;
                const d = drift(v);
                const same = Math.abs(d) <= Math.max(v.total * 0.002, 5) && v.adjustments.length === now.adjustments.length && (v.plan ? v.plan.events === (now.plan?.events ?? 0) : true);
                return (
                  <tr key={v.id} className={isChosen ? "pv-chosen" : undefined}>
                    <td className="noprint"><input type="checkbox" checked={picked.includes(v.id)} onChange={() => toggle(v.id)} aria-label={`compare ${versionTitle(v)}`} /></td>
                    <td>
                      {renaming?.id === v.id ? (
                        <input
                          className="pv-rename" autoFocus value={renaming.name} maxLength={80}
                          onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") rename(v.id, renaming.name); if (e.key === "Escape") setRenaming(null); }}
                          onBlur={() => rename(v.id, renaming.name)}
                        />
                      ) : (
                        <b>
                          {v.name ?? <span className="dim" style={{ fontWeight: 500 }}>unnamed</span>}
                          <button className="pv-pen noprint" title="Name this version" onClick={() => setRenaming({ id: v.id, name: v.name ?? "" })} disabled={!!busy}>✎</button>
                        </b>
                      )}
                      <div className="dim">
                        v{v.seq} · {v.label} · {v.takenAt.slice(0, 16).replace("T", " ")} · {v.fromReview ? "submitted from here" : "saved as a candidate"}
                        {v.note ? ` · “${v.note}”` : ""}
                      </div>
                    </td>
                    <td className="num"><b>{fmtK(v.total)}</b>{v.base !== v.total && <div className="dim">unadj. {fmtK(v.base)}</div>}</td>
                    <td className="num">{v.adjustments.length}</td>
                    <td className="num">{v.distCounts.out} · {v.distCounts.added}</td>
                    <td className="num">{v.plan ? v.plan.events : <span className="dim">—</span>}</td>
                    <td className="num">{v.plan ? money(v.plan.spend) : <span className="dim">—</span>}</td>
                    <td className="num">{v.plan?.totals ? money(v.plan.totals.gross) : <span className="dim" title="Build the plan had not been submitted for these events when the version was taken">—</span>}</td>
                    <td>
                      {isChosen
                        ? <span className="minichip on yes" title={`Chosen as the plan ${chosen!.at.slice(0, 16).replace("T", " ")}${chosen!.note ? ` — ${chosen!.note}` : ""}`}>● the plan</span>
                        : <span className="dim">candidate</span>}
                      {!same && <div className="dim pv-drift" title={`The plan as it stands now is ${fmtK(now.total)} units${Math.abs(d) > 0.5 ? ` (${fmtD(-d, fmtK)} from this version)` : ""}`}>differs from now</div>}
                    </td>
                    <td className="noprint" style={{ whiteSpace: "nowrap" }}>
                      {!isChosen && (
                        <button className="btn" onClick={() => choose(v)} disabled={!!busy || outerBusy || locked}
                          title={locked ? "The plan is locked — reopen it from the bar above to choose another version" : "Submit this version as the plan for approval"}>
                          {busy === "choose:" + v.id ? "Choosing…" : "Make this the plan"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {err && <div className="dim" style={{ color: "var(--bad)", padding: "6px 16px" }}>{err}</div>}
        </div>
      )}

      {cols.length >= 2 && (
        <div className="pv-cmp noprint">
          <div className="pv-cmphead">
            <b>Compare</b>
            <span className="dim">deltas read against <b>{cols[0].title}</b> (the earliest ticked)</span>
            <label className="pv-now"><input type="checkbox" checked={withNow} onChange={(e) => setWithNow(e.target.checked)} /> include the plan as it stands now</label>
          </div>
          <table className="revtable pvcmp">
            <thead>
              <tr>
                <th />
                {cols.map((c) => (
                  <th key={c.key} style={{ textAlign: "right" }}>
                    {c.title}
                    <div className="dim" style={{ fontWeight: 500 }}>{c.sub}</div>
                    {c.version && chosen?.id !== c.version.id && (
                      <button className="btn pv-pick" onClick={() => choose(c.version!)} disabled={!!busy || outerBusy || locked}
                        title={locked ? "Reopen the plan to choose another version" : "Make this version the plan"}>Make this the plan</button>
                    )}
                    {c.version && chosen?.id === c.version.id && <div><span className="minichip on yes">● the plan</span></div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label="Full-year plan base · units" cols={cols} get={(f) => f.total} fmt={fmtK} good="up" />
              <Row label="Unadjusted base" cols={cols} get={(f) => f.base} fmt={fmtK} good="none" />
              {brands.map((b) => <Row key={b} label={`· ${b}`} cols={cols} get={(f) => brandOf(f, b)} fmt={fmtK} good="up" />)}
              <Row label="Levers on the base" cols={cols} get={(f) => f.adjustments.length} fmt={(n) => String(Math.round(n))} good="none" />
              <Row label="No-volume items" cols={cols} get={(f) => f.distCounts.out} fmt={(n) => String(Math.round(n))} good="none" />
              <Row label="New items" cols={cols} get={(f) => f.distCounts.added} fmt={(n) => String(Math.round(n))} good="none" />
              <Row label="Promotion events" cols={cols} get={(f) => (f.plan ? f.plan.events : null)} fmt={(n) => String(Math.round(n))} good="none" />
              <Row label="Trade spend" cols={cols} get={spend} fmt={money} good="down" />
              <Row label="Gross sales plan · at list" cols={cols} get={gross} fmt={money} good="up" />
              <Row label="Gross margin · after trade" cols={cols} get={margin} fmt={money} good="up" />
            </tbody>
          </table>
          {cols.some((c) => c.facts.plan && !c.facts.plan.totals) && (
            <div className="dim" style={{ padding: "4px 16px 8px", fontSize: 12 }}>
              ◇ Gross sales and margin show only where Build the plan had been submitted for that version&apos;s events — the figures need the whole planner.
            </div>
          )}
          {cols.slice(1).map((c, i) => {
            // a column that matches an earlier one says so instead of repeating its differences
            const twin = cols.slice(0, i + 1).find((o) => sameFacts(o.facts, c.facts));
            return twin
              ? <div key={c.key} className="pv-diff"><b>{cols[0].title} → {c.title}</b><div className="dim">{c.title} holds the same plan as {twin.title}{twin.key === cols[0].key ? "" : " — see above"}.</div></div>
              : <Differences key={c.key} from={cols[0]} to={c} />;
          })}
        </div>
      )}
    </section>
  );
}
