"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CROSSWALK } from "@/lib/scope";
import {
  getDistVerification, saveDistVerification,
  getPlanAdjustments, deletePlanAdjustment,
  getPlanEvents, replacePlanEvents,
  type PlanEvent,
} from "@/lib/repo/client";
import { DV_EMPTY } from "@/lib/distver";
import { OPEN_DISTRIBUTION_EVENT } from "@/lib/process";

/* Start over — for when a step was answered wrongly and unpicking it one
   decision at a time is worse than beginning again.

   ONE ACCOUNT AT A TIME. The process is worked account by account — the
   steps count "9 of 13" for a reason — so clearing is too. With the top bar
   on a territory or a parent this does nothing but say so; narrow to one
   account and it clears that account.

   It clears what the PROCESS entered there, and nothing else:

     · the distribution answers, the new items and the "none this year" answer
     · the plan adjustments
     · promotion events someone entered by hand

   It deliberately leaves two things. Carried events are the Telus book read
   in, not anyone's entry, and deleting them would throw away data rather
   than a mistake. Locked versions and the Plan of Record are the record of
   what was signed off and when — a mistake in the plan is corrected by
   taking a new version, not by erasing the old one. */

type Counts = { decisions: number; out: number; additions: number; answered: boolean;
                verified: number; adjustments: number; events: number };

const telusIdsFor = (marketCodes: string[]) => {
  const set = new Set<string>();
  for (const r of CROSSWALK) {
    if (r.market_code && marketCodes.includes(r.market_code)) {
      for (const id of r.telus_customer_ids) set.add(id);
    }
  }
  return set;
};

const isMine = (e: PlanEvent, ids: Set<string>) =>
  e.origin === "manual" && !!e.customer_id && ids.has(e.customer_id);

export default function StepReset({
  year,
  markets,
  scopeLabel,
  restartHref,
}: {
  year: number;
  markets: string[];
  scopeLabel: string;
  restartHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);

  /* Count before asking: "clear 18 answers, 2 new items and 3 adjustments"
     is a decision someone can make; "clear everything" is a leap. */
  const ask = async () => {
    setOpen(true);
    setCounts(null);
    if (markets.length !== 1) return;
    const ids = telusIdsFor(markets);
    const c: Counts = { decisions: 0, out: 0, additions: 0, answered: false, verified: 0, adjustments: 0, events: 0 };
    for (const code of markets) {
      const dv = await getDistVerification(code, year);
      const vals = Object.values(dv.decisions);
      c.decisions += vals.length;
      c.out += vals.filter((d) => d === "out").length;
      c.additions += dv.additions.length;
      c.answered = c.answered || !!dv.no_additions;
      if (dv.verified_at) c.verified += 1;
      c.adjustments += (await getPlanAdjustments(code, year)).length;
    }
    c.events = (await getPlanEvents(year)).filter((e) => isMine(e, ids)).length;
    setCounts(c);
  };

  const clear = async () => {
    setBusy(true);
    try {
      const ids = telusIdsFor(markets);
      for (const code of markets) {
        await saveDistVerification(code, year, { ...DV_EMPTY });
        for (const a of await getPlanAdjustments(code, year)) {
          await deletePlanAdjustment(a.id, code, year);
        }
      }
      const all = await getPlanEvents(year);
      const keep = all.filter((e) => !isMine(e, ids));
      if (keep.length !== all.length) await replacePlanEvents(year, keep);
      setOpen(false);
      router.push(restartHref);
      router.refresh();
      /* Land with the list open. Starting over from step 1 navigates to the
         URL it is already on, which does nothing on its own. */
      window.dispatchEvent(new CustomEvent(OPEN_DISTRIBUTION_EVENT));
    } finally {
      setBusy(false);
    }
  };

  const nothing = counts && !counts.decisions && !counts.additions && !counts.answered
    && !counts.verified && !counts.adjustments && !counts.events;
  const one = markets.length === 1;

  return (
    <>
      <button
        className="pstartover"
        onClick={ask}
        title={one
          ? `Clear what has been entered for ${scopeLabel} in Plan ${year} and begin at step 1`
          : "Clear one account's work — narrow the top bar to a single account first"}
      >
        Start over
      </button>

      {open && (
        <div className="modal open">
          <div className="box" style={{ width: 560 }}>
            <div className="m-head">
              <div>
                <div className="mt">Start Plan {year} over</div>
                <div className="ms">
                  {one
                    ? <>Clears what has been entered for <b>{scopeLabel}</b> and begins again at step 1.</>
                    : <>One account at a time.</>}
                </div>
              </div>
              <button className="x" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="m-body" style={{ padding: "14px 20px", display: "block" }}>
              {!one ? (
                <div className="note">
                  ◇ <span>
                    The top bar is on <b>{scopeLabel}</b>, which is {markets.length} accounts. The plan is worked
                    one account at a time — that is what &ldquo;0 of {markets.length} accounts&rdquo; on the steps
                    counts — so clearing is too, and a single button should not be able to undo thirteen
                    people&apos;s work. Pick one under <b>Account</b> in the top bar, then come back.
                  </span>
                </div>
              ) : !counts ? (
                <div className="note">Counting what would go…</div>
              ) : nothing ? (
                <div className="note">◇ <span>Nothing has been entered for {scopeLabel} yet — there is nothing to clear.</span></div>
              ) : (<>
                <div className="clearlist">
                  <b>This will be cleared</b>
                  <ul>
                    {(counts.decisions > 0 || counts.verified > 0) && (
                      <li>
                        Distribution answers — <b>{counts.decisions}</b> item{counts.decisions === 1 ? "" : "s"},
                        {" "}{counts.out} set to No volume
                        {counts.verified > 0 && <> · verified on {counts.verified} account{counts.verified === 1 ? "" : "s"}</>}
                      </li>
                    )}
                    {counts.additions > 0 && <li>New items — <b>{counts.additions}</b></li>}
                    {counts.answered && <li>The recorded &ldquo;no new items this year&rdquo; answer</li>}
                    {counts.adjustments > 0 && <li>Plan adjustments — <b>{counts.adjustments}</b></li>}
                    {counts.events > 0 && <li>Promotion events entered by hand — <b>{counts.events}</b></li>}
                  </ul>
                </div>
                <div className="clearlist keep">
                  <b>This is kept</b>
                  <ul>
                    <li>Carried events from the Telus book — data read in, not anyone&apos;s entry</li>
                    <li>Locked versions and the Plan of Record — the record of what was signed off. Correct a
                        signed plan by taking a new version, not by erasing the old one.</li>
                  </ul>
                </div>
              </>)}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn danger" onClick={clear} disabled={!one || busy || !counts || !!nothing}>
                {busy ? "Clearing…" : `Clear and start over`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
