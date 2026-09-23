"use client";

import { useState } from "react";
import type { ReviewData } from "./ReviewView";

/* Share the plan by email — the Review & submit read-back, sent from the
   user's OWN mail app.

   The platform has no mail server of its own, and a web page cannot hand a
   file to someone's mail app, so this does the three things a browser can:

     · Open in my email — a mailto: draft with the to/cc/subject filled in
       and the summary as its body. Mail apps cap how long that link can be,
       so a long event list is cut short there and says so.
     · Copy formatted summary — the same summary as a formatted HTML block
       (headings, the brand and event tables), to paste into the draft in
       place of the plain text. Nothing is cut short.
     · Save as PDF to attach — the print layout, through the browser's own
       Print → Save as PDF, for the full letter-size sheet. */

type Account = NonNullable<ReviewData["account"]>;
type Sub = { seq: number; takenAt: string } | null;
type Owed = { text: string }[];

const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}K` : Math.round(n).toLocaleString());
const fmt$ = (n: number) => `$${fmtK(n)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* mailto: links past ~2,000 characters are refused or truncated by some
   mail apps (Outlook on Windows among them), so the draft is kept under it. */
const MAILTO_MAX = 1900;

const money = (v: number) => {
  const x = Math.abs(v);
  const t = x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${Math.round(x / 1e3).toLocaleString()}K` : `$${Math.round(x)}`;
  return v < 0 ? `-${t}` : t;
};

/** The plan financials row — gross sales, margin after trade, trade spend —
    each against the prior year; null until Build the plan is submitted. */
function finLines(a: Account): [string, string, string][] | null {
  const t = a.totals;
  if (!t) return null;
  const vs = (now: number, prior: number) =>
    `${prior ? `${now >= prior ? "+" : "-"}${Math.abs((now / prior - 1) * 100).toFixed(1)}%` : "n/a"} vs FY${t.priorYear} ${money(prior)}`;
  const m = t.gross - t.spend, mp = t.grossPrior - t.spendPrior;
  const pct = (x: number, g: number) => (g > 0 ? `${((x / g) * 100).toFixed(1)}%` : "n/a");
  return [
    ["Gross sales plan", money(t.gross), `${vs(t.gross, t.grossPrior)}; target ${money(t.grossTarget)}`],
    ["Gross margin after trade", `${money(m)} (${pct(m, t.gross)} of gross)`, vs(m, mp)],
    ["Trade spend plan", money(t.spend), `${vs(t.spend, t.spendPrior)}; fund ${money(t.fund)}`],
  ];
}

function statusLine(sub: Sub) {
  return sub ? `Submitted ${sub.takenAt.slice(0, 10)} as v${sub.seq}` : "Not yet submitted";
}

function stepLines(a: Account, year: number) {
  return {
    dist: a.distribution.verifiedAt
      ? `Verified ${a.distribution.verifiedAt.slice(0, 10)} · ${a.distribution.kept} items carry volume into ${year}, ${a.distribution.out.length} do not`
      : "Not verified yet",
    items: a.newItems.none
      ? `No new items for ${year}`
      : a.newItems.additions.length
        ? `${a.newItems.additions.length} new item${a.newItems.additions.length === 1 ? "" : "s"}`
        : "Not answered yet",
    base: `${a.baseReviewedAt ? `Submitted ${a.baseReviewedAt.slice(0, 10)}` : "Not submitted yet"} · ${
      a.adjustments.length ? `${a.adjustments.length} lever${a.adjustments.length === 1 ? "" : "s"} on the plan base` : "no adjustments"}`,
    plan: `${a.planBuiltAt ? `Submitted ${a.planBuiltAt.slice(0, 10)}` : "Not submitted yet"} · ${a.events.count} event${
      a.events.count === 1 ? "" : "s"} · ${fmt$(a.events.spend)} planned trade`,
  };
}

/** The plain-text body. `maxEvents` limits the event list (for the mailto: cap). */
function plainBody(a: Account, year: number, sub: Sub, owed: Owed, note: string, maxEvents: number) {
  const s = stepLines(a, year);
  const L: string[] = [];
  if (note.trim()) L.push(note.trim(), "");
  L.push(`PLAN ${year} — ${a.name}`, `${statusLine(sub)} · NIQ through ${a.dataEdge}`, "");
  const fin = finLines(a);
  if (fin) {
    L.push(...fin.map(([k, v, d]) => `${k}: ${v} (${d})`));
    if (a.totalsStale) L.push("(events have changed since these were taken)");
    L.push("");
  }
  L.push(
    `Full-year plan base: ${a.base ? `${fmtK(a.base.adjusted)} units` : "—"}${a.base && a.base.adjusted !== a.base.total ? ` (unadjusted ${fmtK(a.base.total)})` : ""}`,
    `Distribution: ${a.distribution.verifiedAt ? "Verified" : "Unverified"} · ${a.distribution.out.length} no volume · ${a.newItems.additions.length} new`,
    `Plan adjustments: ${a.adjustments.length}`,
    `Promotion events: ${a.events.count} · ${fmt$(a.events.spend)} planned trade`,
    "",
  );
  if (owed.length) L.push("Still to do:", ...owed.map((o) => `  - ${o.text}`), "");
  L.push(`1. Review distribution — ${s.dist}`);
  for (const o of a.distribution.out) L.push(`    No volume: ${o.name} (${o.brand})`);
  L.push(`2. Add new items — ${s.items}`);
  for (const n of a.newItems.additions) L.push(`    ${n.name} (${n.brand}) · on shelf ${n.shelfDate}`);
  L.push(`3. Base Business Review — ${s.base}`);
  for (const b of a.base?.byBrand ?? []) L.push(`    ${b.brand}: ${Math.round(b.base).toLocaleString()} → ${Math.round(b.adjusted).toLocaleString()} units`);
  L.push(`4. Build the plan — ${s.plan}`);
  /* All of them when they fit; when the draft's length cap means only some
     can go, the largest by trade dollars — the ones a reader asks about —
     still in calendar order. */
  const cut = maxEvents < a.events.rows.length;
  const rows = cut
    ? a.events.rows.slice().sort((x, y) => y.spend - x.spend).slice(0, maxEvents).sort((x, y) => x.start.localeCompare(y.start))
    : a.events.rows;
  if (cut && rows.length) L.push(`    Largest ${rows.length} of ${a.events.rows.length} by trade $:`);
  for (const e of rows) L.push(`    ${e.start} → ${e.end} · ${e.title || e.perf} · $${e.spend.toLocaleString()}`);
  if (cut) {
    L.push(`    ... and ${a.events.rows.length - rows.length} more event${a.events.rows.length - rows.length === 1 ? "" : "s"} (full list on the printed plan)`);
  }
  /* Plain ASCII: in a mailto: link every "→" or "·" costs nine characters
     once encoded, which would crowd events out of the draft. */
  return L.join("\n").replace(/ → /g, " to ").replace(/ · /g, " | ").replace(/ — /g, " - ").replace(/…/g, "...");
}

/** The formatted version, for pasting into the draft. */
function htmlBody(a: Account, year: number, sub: Sub, owed: Owed, note: string) {
  const s = stepLines(a, year);
  const th = 'style="text-align:left;padding:4px 10px;border-bottom:1px solid #ccc;font-size:11px;color:#555"';
  const td = 'style="padding:4px 10px;border-bottom:1px solid #eee"';
  const tdn = 'style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right"';
  const h = (n: number, t: string, line: string) =>
    `<h3 style="margin:16px 0 4px;font-size:14px">${n} · ${esc(t)}</h3><div style="color:#555;font-size:12px">${esc(line)}</div>`;
  const out: string[] = [];
  out.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1d23">');
  if (note.trim()) out.push(`<p>${esc(note.trim()).replace(/\n/g, "<br>")}</p>`);
  out.push(`<h2 style="margin:0 0 2px;font-size:17px">Plan ${year} — ${esc(a.name)}</h2>`,
    `<div style="color:#555;font-size:12px">${esc(statusLine(sub))} · NIQ through ${esc(a.dataEdge)}</div>`);
  out.push(`<table style="border-collapse:collapse;margin:10px 0"><tr>${[
    ["Full-year plan base", a.base ? `${fmtK(a.base.adjusted)} units` : "—"],
    ["Distribution", a.distribution.verifiedAt ? "Verified" : "Unverified"],
    ["Plan adjustments", String(a.adjustments.length)],
    ["Promotion events", `${a.events.count} · ${fmt$(a.events.spend)}`],
  ].map(([k, v]) => `<td style="padding:6px 14px 6px 0"><div style="font-size:11px;color:#555">${k}</div><b style="font-size:15px">${esc(v)}</b></td>`).join("")}</tr></table>`);
  const fin = finLines(a);
  if (fin) {
    out.push(`<table style="border-collapse:collapse;margin:0 0 10px"><tr>${fin.map(([k, v, d]) =>
      `<td style="padding:6px 16px 6px 0;vertical-align:top"><div style="font-size:11px;color:#555">${esc(k)}</div><b style="font-size:15px">${esc(v)}</b><div style="font-size:11px;color:#555">${esc(d)}</div></td>`).join("")}</tr></table>`);
    if (a.totalsStale) out.push('<div style="font-size:11px;color:#e08a00">Events have changed since these were taken.</div>');
  }
  if (owed.length) out.push(`<p style="background:#fff8e6;padding:8px 10px;border:1px solid #e08a00;border-radius:6px"><b>Still to do</b><br>${owed.map((o) => esc(o.text)).join("<br>")}</p>`);
  out.push(h(1, "Review distribution", s.dist));
  if (a.distribution.out.length) out.push(`<ul>${a.distribution.out.map((o) => `<li>No volume: ${esc(o.name)} · ${esc(o.brand)}</li>`).join("")}</ul>`);
  out.push(h(2, "Add new items", s.items));
  if (a.newItems.additions.length) out.push(`<ul>${a.newItems.additions.map((n) => `<li>${esc(n.name)} · ${esc(n.brand)} · on shelf ${n.shelfDate}</li>`).join("")}</ul>`);
  out.push(h(3, "Base Business Review", s.base));
  if (a.base?.byBrand.length) {
    out.push(`<table style="border-collapse:collapse;margin-top:6px"><tr><th ${th}>Brand</th><th ${th}>Plan base</th><th ${th}>Adjusted</th></tr>${
      a.base.byBrand.map((b) => `<tr><td ${td}><b>${esc(b.brand)}</b></td><td ${tdn}>${Math.round(b.base).toLocaleString()}</td><td ${tdn}>${Math.round(b.adjusted).toLocaleString()}</td></tr>`).join("")}</table>`);
  }
  out.push(h(4, "Build the plan", s.plan));
  if (a.events.rows.length) {
    out.push(`<table style="border-collapse:collapse;margin-top:6px"><tr><th ${th}>Event</th><th ${th}>Brand</th><th ${th}>Window</th><th ${th}>Lift</th><th ${th}>Trade $</th></tr>${
      a.events.rows.map((e) => `<tr><td ${td}>${esc(e.title || e.perf)}</td><td ${td}>${esc(e.brand)}</td><td ${td}>${e.start} → ${e.end}</td><td ${tdn}>${e.lift === null ? "—" : `${e.lift}%`}</td><td ${tdn}>${e.spend.toLocaleString()}</td></tr>`).join("")}</table>`);
  }
  out.push("</div>");
  return out.join("");
}

const splitAddrs = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const badAddrs = (s: string) => splitAddrs(s).filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

export default function ShareEmail({ a, year, sub, owed }: { a: Account; year: number; sub: Sub; owed: Owed }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const subj = subject || `Plan ${year} · ${a.name} — ${sub ? "submitted plan" : "plan for review"}`;
  const bad = [...badAddrs(to), ...badAddrs(cc)];

  /* The longest body that keeps the whole mailto: link under the cap —
     trimming events from the end until it fits. */
  const mailto = () => {
    const head = `mailto:${splitAddrs(to).map(encodeURIComponent).join(",")}?`;
    const q = (body: string) => [
      cc.trim() ? `cc=${splitAddrs(cc).map(encodeURIComponent).join(",")}` : "",
      `subject=${encodeURIComponent(subj)}`,
      `body=${encodeURIComponent(body)}`,
    ].filter(Boolean).join("&");
    let n = a.events.rows.length;
    let body = plainBody(a, year, sub, owed, note, n);
    while (n > 0 && (head + q(body)).length > MAILTO_MAX) body = plainBody(a, year, sub, owed, note, --n);
    return { href: head + q(body), cut: a.events.rows.length - n };
  };

  const openMail = () => {
    const { href, cut } = mailto();
    window.location.href = href;
    setMsg(cut
      ? `Draft opened. Mail apps limit how long that draft can be, so ${cut} event${cut === 1 ? " was" : "s were"} left off the list — paste the formatted summary or attach the PDF for all of them.`
      : "Draft opened in your email app.");
  };

  const copy = async () => {
    const html = htmlBody(a, year, sub, owed, note);
    const text = plainBody(a, year, sub, owed, note, a.events.rows.length);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setMsg("Formatted summary copied — paste it into the email body (Ctrl/⌘ + V).");
    } catch {
      setMsg("Couldn't reach the clipboard from this browser — use Open in my email instead.");
    }
  };

  const savePdf = () => {
    setOpen(false);
    setMsg(null);
    // let the dialog close before the print layout is taken
    setTimeout(() => window.print(), 80);
  };

  const preview = plainBody(a, year, sub, owed, note, a.events.rows.length);

  return (
    <>
      <button className="btn noprint" onClick={() => { setOpen(true); setMsg(null); }} title="Send this read-back to someone from your own email">
        <span aria-hidden="true">✉</span> Email the plan
      </button>
      {open && (
        <div className="modal open noprint" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="box shareemail" style={{ width: 640 }}>
            <div className="m-head">
              <div>
                <div className="mt">Email the plan</div>
                <div className="ms">Sends the Plan {year} read-back for <b>{a.name}</b> from your own email app.</div>
              </div>
              <button className="x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="m-body">
              <div className="f-row" style={{ marginTop: 10 }}>
                <label htmlFor="se-to">To</label>
                <input id="se-to" type="text" placeholder="name@company.com, another@company.com" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="f-2col">
                <div className="f-row">
                  <label htmlFor="se-cc">Cc</label>
                  <input id="se-cc" type="text" placeholder="optional" value={cc} onChange={(e) => setCc(e.target.value)} />
                </div>
                <div className="f-row">
                  <label htmlFor="se-subj">Subject</label>
                  <input id="se-subj" type="text" placeholder={subj} value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
              </div>
              <div className="f-row">
                <label htmlFor="se-note">Message</label>
                <textarea id="se-note" rows={3} placeholder="Optional — goes above the summary" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {bad.length > 0 && <div className="hint" style={{ color: "var(--bad)", marginTop: -6, marginBottom: 8 }}>Check {bad.length === 1 ? "this address" : "these addresses"}: {bad.join(", ")}</div>}
              <div className="f-row">
                <label>What they&apos;ll get</label>
                <pre className="se-preview">{preview}</pre>
                <div className="hint">
                  A web page can&apos;t attach files to your email. For the letter-size sheet, use <b>Save as PDF to attach</b> and
                  add the file to the draft.
                </div>
              </div>
              {msg && <div className="note" style={{ marginBottom: 10 }}>◇ {msg}</div>}
            </div>
            <div className="m-foot">
              <button className="btn" onClick={savePdf} title="Print → Save as PDF, then attach the file to your email">⬇ Save as PDF to attach</button>
              <button className="btn" onClick={copy} title="Copy the summary with its tables, to paste into the email body">⧉ Copy formatted summary</button>
              <button className="btn primary" style={{ marginLeft: "auto" }} onClick={openMail} disabled={bad.length > 0}
                title="Open a new email in your mail app with this filled in">
                ✉ Open in my email
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
