"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reopenPlan } from "@/lib/repo/client";

/* The plan lock in the rail — see lib/planlock.

   A submitted plan is read-only: this banner says so on every step, and on
   the working steps the rail holds the page beneath (a transparent hold,
   rendered beside the step scrim so it never covers this bar — the plan
   stays readable, nothing on it takes a click). Review & submit stays live
   for printing and sharing, but its submit waits on a reopen too.
   Reopening asks why, records it, and hands the plan back; the next
   submission from Review & submit locks it again. */

export default function PlanLock({
  year, market, scopeLabel, submittedAt,
}: {
  year: number;
  market: string;
  scopeLabel: string;
  submittedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reopen = async () => {
    setBusy(true);
    try {
      await reopenPlan(market, year, note.trim());
      setOpen(false);
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="planlock">
        <span className="pl-ic" aria-hidden="true">🔒</span>
        <span className="pl-text">
          <b>Plan {year} for {scopeLabel} is submitted and locked.</b>{" "}
          {submittedAt ? `Submitted ${submittedAt.slice(0, 10)}. ` : ""}Nothing in it changes until it is reopened; a submission from Review &amp; submit locks it again.
        </span>
        <button className="btn" onClick={() => setOpen(true)}>Reopen the plan…</button>
      </div>
      {open && (
        <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="box" style={{ width: 520 }}>
            <div className="m-head">
              <div>
                <div className="mt">Reopen Plan {year} — {scopeLabel}</div>
                <div className="ms">The plan of record stays on file as it was submitted. Reopening lets the steps be edited again; submit from Review &amp; submit to lock the revision.</div>
              </div>
              <button className="x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="m-body">
              <div className="f-row" style={{ marginTop: 10 }}>
                <label htmlFor="pl-note">Why</label>
                <input id="pl-note" type="text" placeholder="e.g. retailer moved the Q2 window" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
                <div className="hint">Recorded with the reopen, so the revision has a reason on file.</div>
              </div>
            </div>
            <div className="m-foot">
              <button className="btn" onClick={() => setOpen(false)}>Keep it locked</button>
              <button className="btn primary" style={{ marginLeft: "auto" }} onClick={reopen} disabled={busy || !note.trim()}>
                {busy ? "Reopening…" : "Reopen the plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
