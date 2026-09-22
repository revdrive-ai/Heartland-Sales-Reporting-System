"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { parseWorkPath, processPath } from "@/lib/process";

/* The plan's read-back, and the one place it is submitted from.

   Each section is one of the steps before this, in the order they were
   worked, and each says what that step recorded for THIS account — the
   whole account, not the brand the planner happened to be on. Anything a
   step still owes is called out at the top with a link back to it, and the
   submit button waits on the two things a plan cannot go without: the
   distribution answers and the new-items answer. Everything else is shown so
   it can be checked, not gated on.

   Submitting takes the Plan of Record — the same append-only version the
   sign-off card used to take from inside the planner. A second submit is a
   revision, kept alongside the first, never over it. */

export type ReviewData = {
  year: number;
  customers: number;
  scopeLabel: string;
  account: null | {
    code: string;
    name: string;
    dataEdge: string;
    distribution: {
      verifiedAt: string | null;
      kept: number;
      out: { upc: string; name: string; brand: string }[];
    };
    newItems: {
      answered: boolean;
      none: boolean;
      additions: {
        name: string; brand: string; manual: boolean;
        proxyName: string; proxyPct: number; estAcv: number | null;
        shipDate: string; shelfDate: string; loadin: number;
      }[];
    };
    adjustments: {
      id: string; brand: string; item: string | null;
      kind: "distribution" | "price" | "trend"; pct: number; from: string; to: string; note: string;
    }[];
    /** when the Base Business Review was submitted from its own card, if it has been */
    baseReviewedAt: string | null;
    base: null | { total: number; adjusted: number; byBrand: { brand: string; base: number; adjusted: number }[] };
    events: {
      count: number; spend: number; manual: number; carried: number;
      rows: { id: string; title: string; brand: string; perf: string; start: string; end: string;
              spend: number; lift: number | null; origin: string }[];
    };
    versions: { seq: number; kind: "por" | "le"; label: string; takenAt: string; note: string; total: number; fromReview: boolean }[];
    signedOff: boolean;
    /** a version was taken from THIS page — the only thing that reads as submitted */
    submitted: boolean;
  };
};

const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}K` : Math.round(n).toLocaleString());
const fmt$ = (n: number) => `$${fmtK(n)}`;
const KIND: Record<string, string> = { distribution: "Distribution", price: "Base price", trend: "Trend" };

export default function ReviewView({ data }: { data: ReviewData }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = parseWorkPath(pathname);
  /* Links back to a step stay inside the corridor when this page is a step;
     reached any other way there is no corridor to point into. */
  const stepHref = (key: string) => (loc ? processPath(loc.proc.kind, key, loc.year) : null);

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const a = data.account;
  if (!a) {
    return (
      <div className="view active">
        <div className="pagehead">
          <div><h1>Review &amp; submit — Plan {data.year}</h1></div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div className="note" style={{ marginTop: 0, fontSize: 13 }}>
            ◇ A plan is submitted one account at a time. The top bar is on <b>{data.scopeLabel}</b>
            {data.customers ? <>, which is {data.customers} accounts</> : null} — pick one under <b>Account</b> and
            this page reads that account&apos;s plan back.
          </div>
        </div>
      </div>
    );
  }

  const owed: { step: string; text: string }[] = [];
  if (!a.distribution.verifiedAt) owed.push({ step: "distribution", text: "Distribution has not been verified for this account" });
  if (!a.newItems.answered) owed.push({ step: "new-items", text: "The new-items question has not been answered" });
  if (!a.baseReviewedAt) owed.push({ step: "base", text: "The Base Business Review has not been submitted" });
  const ready = owed.length === 0;
  /* "Submitted" is a submission from this page. A version taken elsewhere
     (the sign-off card, the LE screen) is listed with the others, but it is
     not the plan being submitted, so it does not close the step. */
  const sub = a.versions.find((v) => v.fromReview) ?? null;
  const elsewhere = a.versions.filter((v) => !v.fromReview);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/plansnap/${a.code}/${data.year}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim(), from: "review" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      setNote("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not submit");
    } finally {
      setBusy(false);
    }
  };

  const Owed = ({ step, text }: { step: string; text: string }) => {
    const href = stepHref(step);
    return (
      <li>
        {text}
        {href && <> — <Link href={href}>go to that step →</Link></>}
      </li>
    );
  };

  return (
    <div className="view active">
      <div className="pagehead">
        <div>
          <h1>Review &amp; submit — Plan {data.year}</h1>
          <p>
            Everything entered for <b>{a.name}</b> in the four steps before this, read back in the order it was
            built. Check it, then submit it as the Plan of Record — the frozen v1 the in-year estimates are measured
            against.
          </p>
        </div>
        <div className="actions">
          <span className="pill">NIQ through {a.dataEdge}</span>
          {sub
            ? <span className="pill" style={{ borderColor: "var(--good)", color: "var(--good)" }}>✓ Submitted · {sub.takenAt.slice(0, 10)}</span>
            : <span className="pill" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>not yet submitted</span>}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="k-top"><span className="k-label">Full-year plan base</span></div>
          <div className="k-val">{a.base ? fmtK(a.base.adjusted) : "—"}</div>
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>
            {a.base && a.base.adjusted !== a.base.total ? `unadjusted ${fmtK(a.base.total)} · ` : ""}units · all Heartland brands
          </div>
        </div>
        <div className={"kpi" + (a.distribution.verifiedAt ? "" : " alert")}>
          <div className="k-top"><span className="k-label">Distribution</span></div>
          <div className="k-val" style={a.distribution.verifiedAt ? undefined : { color: "var(--bad)" }}>
            {a.distribution.verifiedAt ? "Verified" : "Unverified"}
          </div>
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>
            {a.distribution.kept} carried · {a.distribution.out.length} no volume · {a.newItems.additions.length} new
          </div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Plan adjustments</span></div>
          <div className="k-val">{a.adjustments.length}</div>
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>levers on the base</div>
        </div>
        <div className="kpi">
          <div className="k-top"><span className="k-label">Promotion events</span></div>
          <div className="k-val">{a.events.count}</div>
          <div className="k-sub" style={{ color: "var(--ink-3)" }}>{fmt$(a.events.spend)} planned trade</div>
        </div>
      </div>

      {owed.length > 0 && (
        <div className="card revowed">
          <b>Still to do before this plan can be submitted</b>
          <ul>{owed.map((o) => <Owed key={o.step} {...o} />)}</ul>
        </div>
      )}

      <div className="revgrid">
        {/* 1 · distribution */}
        <section className="card revsec">
          <header>
            <span className="n">1</span>
            <div>
              <b>Review distribution</b>
              <span>
                {a.distribution.verifiedAt
                  ? `Verified ${a.distribution.verifiedAt.slice(0, 10)} · ${a.distribution.kept} items carry volume into ${data.year}, ${a.distribution.out.length} do not`
                  : "Not verified yet — every item is carried by default until it is"}
              </span>
            </div>
            {stepHref("distribution") && <Link className="btn" href={stepHref("distribution")!}>Open →</Link>}
          </header>
          {a.distribution.out.length > 0 && (
            <ul className="revlist">
              {a.distribution.out.map((o) => (
                <li key={o.upc}><span className="minichip on no">No volume</span> {o.name} <span className="dim">· {o.brand}</span></li>
              ))}
            </ul>
          )}
        </section>

        {/* 2 · new items */}
        <section className="card revsec">
          <header>
            <span className="n">2</span>
            <div>
              <b>Add new items</b>
              <span>
                {a.newItems.none
                  ? `Recorded: no new items for ${data.year}`
                  : a.newItems.additions.length
                    ? `${a.newItems.additions.length} new item${a.newItems.additions.length === 1 ? "" : "s"} riding into the ${data.year} base`
                    : "Not answered yet"}
              </span>
            </div>
            {stepHref("new-items") && <Link className="btn" href={stepHref("new-items")!}>Open →</Link>}
          </header>
          {a.newItems.additions.length > 0 && (
            <ul className="revlist">
              {a.newItems.additions.map((n, i) => (
                <li key={i}>
                  <b>{n.name}</b> <span className="dim">· {n.brand}{n.manual ? " · by hand" : ""}</span>
                  <div className="dim">
                    {n.proxyPct}% of {n.proxyName}{n.estAcv !== null ? ` · ${n.estAcv}% ACV` : ""} · ships {n.shipDate} · on shelf {n.shelfDate}
                    {n.loadin > 0 ? ` · pipeline fill ${Math.round(n.loadin).toLocaleString()} u (not in the base)` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3 · base business review */}
        <section className="card revsec">
          <header>
            <span className="n">3</span>
            <div>
              <b>Base Business Review</b>
              <span>
                {a.baseReviewedAt ? `Submitted ${a.baseReviewedAt.slice(0, 10)} · ` : "Not submitted yet · "}
                {a.adjustments.length
                  ? `${a.adjustments.length} lever${a.adjustments.length === 1 ? "" : "s"} on the plan base`
                  : "no adjustments — the plan base is the carried base"}
              </span>
            </div>
            {stepHref("base") && <Link className="btn" href={stepHref("base")!}>Open →</Link>}
          </header>
          {a.base && a.base.byBrand.length > 0 && (
            <table className="revtable">
              <thead><tr><th>Brand</th><th style={{ textAlign: "right" }}>Plan base</th><th style={{ textAlign: "right" }}>Adjusted</th><th style={{ textAlign: "right" }}>Δ</th></tr></thead>
              <tbody>
                {a.base.byBrand.map((b) => {
                  const d = b.base > 0 ? ((b.adjusted - b.base) / b.base) * 100 : 0;
                  return (
                    <tr key={b.brand}>
                      <td><b>{b.brand}</b></td>
                      <td className="num">{Math.round(b.base).toLocaleString()}</td>
                      <td className="num">{Math.round(b.adjusted).toLocaleString()}</td>
                      <td className="num" style={{ color: d < 0 ? "var(--bad)" : d > 0 ? "var(--good)" : "var(--ink-3)" }}>
                        {d === 0 ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {a.adjustments.length > 0 && (
            <ul className="revlist">
              {a.adjustments.map((x) => (
                <li key={x.id}>
                  <b style={{ color: x.pct >= 0 ? "var(--good)" : "var(--bad)" }}>{x.pct >= 0 ? "+" : "−"}{Math.abs(x.pct)}%</b>
                  {" "}{KIND[x.kind]} · {x.item ?? `all ${x.brand} items`}
                  <div className="dim">{x.from} → {x.to}{x.note ? ` · ${x.note}` : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 4 · build the plan */}
        <section className="card revsec">
          <header>
            <span className="n">4</span>
            <div>
              <b>Build the plan</b>
              <span>
                {a.events.count
                  ? `${a.events.count} event${a.events.count === 1 ? "" : "s"} · ${fmt$(a.events.spend)} planned trade · ${a.events.manual} entered, ${a.events.carried} carried from the book`
                  : "No promotion events on the calendar yet"}
              </span>
            </div>
            {stepHref("planner") && <Link className="btn" href={stepHref("planner")!}>Open →</Link>}
          </header>
          {a.events.rows.length > 0 && (
            <table className="revtable">
              <thead><tr><th>Event</th><th>Brand</th><th>Window</th><th style={{ textAlign: "right" }}>Lift</th><th style={{ textAlign: "right" }}>Trade $</th></tr></thead>
              <tbody>
                {a.events.rows.slice(0, 40).map((e) => (
                  <tr key={e.id}>
                    <td><b>{e.title || e.perf}</b> <span className="dim">· {e.perf}{e.origin !== "manual" ? " · carried" : ""}</span></td>
                    <td>{e.brand}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{e.start} → {e.end}</td>
                    <td className="num">{e.lift === null ? "—" : `${e.lift}%`}</td>
                    <td className="num">{e.spend.toLocaleString()}</td>
                  </tr>
                ))}
                {a.events.rows.length > 40 && (
                  <tr><td colSpan={5} className="dim">… and {a.events.rows.length - 40} more on the planner</td></tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* 5 · submit */}
      <section className={"card revsubmit" + (ready ? " ready" : "")}>
        <div>
          <b>{sub ? `Plan ${data.year} submitted for ${a.name}` : `Submit Plan ${data.year} for ${a.name}`}</b>
          <span>
            {sub
              ? <>Submitted {sub.takenAt.slice(0, 16).replace("T", " ")} UTC as v{sub.seq} · {fmtK(sub.total)} units{sub.note ? <> · &ldquo;{sub.note}&rdquo;</> : null}.
                 Submitting again records a revision alongside it — versions are never overwritten.</>
              : ready
                ? <>Freezes the plan base above as a version{elsewhere.length ? "" : " — v1, the Plan of Record"}. The monthly Latest Estimates are then read against it.</>
                : <>Finish the step{owed.length === 1 ? "" : "s"} listed above first. The button opens once the distribution is verified, the new-items question is answered and the base review is submitted.</>}
          </span>
          {elsewhere.length > 0 && !sub && (
            <span className="dim" style={{ marginTop: 4 }}>
              ◇ {elsewhere.length === 1 ? "A version was" : `${elsewhere.length} versions were`} taken for this account outside this step
              (the sign-off card or the LE screen). {elsewhere.length === 1 ? "It is" : "They are"} listed below and kept, but the plan has not been
              submitted from here.
            </span>
          )}
          {a.versions.length > 0 && (
            <ul className="revlist" style={{ marginTop: 8 }}>
              {a.versions.map((v) => (
                <li key={v.seq}>
                  <b>v{v.seq}</b> {v.label} · {v.takenAt.slice(0, 10)} · {fmtK(v.total)} units
                  {v.fromReview
                    ? <span className="minichip on yes" style={{ marginLeft: 6 }}>submitted here</span>
                    : <span className="dim"> · taken from the {v.kind === "por" ? "sign-off card" : "LE screen"}</span>}
                  {v.note ? <span className="dim"> · {v.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="revact">
          <input
            placeholder={sub ? "Revision note (optional)" : "Submission note (optional) — travels with the version"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!ready || busy}
          />
          <button
            className={"btn" + (ready ? " primary" : "")}
            onClick={submit}
            disabled={!ready || busy}
            title={ready ? (sub ? "Take a revised version of the plan" : "Submit this account's plan") : "Finish the steps listed above first"}
          >
            {busy ? "Submitting…" : sub ? "Submit a revision" : "Submit the plan"}
          </button>
          {err && <span className="dim" style={{ color: "var(--bad)" }}>{err}</span>}
        </div>
      </section>
    </div>
  );
}
