"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDistVerification, saveDistVerification } from "@/lib/repo/client";
import { ADD_ITEM_EVENT } from "@/lib/process";

/* The two answers to step 2, in the rail where the step is.

   There is no "continue" button on this step because there is nothing to
   continue past: either there are new items or there are not, and both
   answers move the plan on. Saying there are none is recorded per customer,
   which is what lets the step read as done. */

export default function StepChoices({
  year,
  markets,
  scopeLabel,
  nextHref,
  added,
}: {
  year: number;
  markets: string[];
  scopeLabel: string;
  nextHref: string;
  added: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  /* Answers for every customer the top bar has in scope — which is the point
     of scoping first. The label says how many, so the reach is never a
     surprise. A customer that already has items is left alone: "none" would
     contradict what is already there. */
  const none = async () => {
    setBusy(true);
    try {
      for (const code of markets) {
        const doc = await getDistVerification(code, year);
        if (doc.additions.length) continue;
        await saveDistVerification(code, year, { ...doc, no_additions: new Date().toISOString() });
      }
      router.push(nextHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const reach = markets.length === 1 ? scopeLabel : `all ${markets.length} accounts in scope`;

  return (
    <div className="stepchoices">
      <button className="gatepick go" onClick={none} disabled={busy || !markets.length}>
        <b>{added ? `Done — ${added} added` : `No new items for ${year}`}</b>
        <span>
          {busy
            ? "Recording…"
            : added
              ? `They ride into the ${year} base. On to Base & Lift.`
              : `Recorded for ${reach}, and Base & Lift opens next.`}
        </span>
      </button>
      <button
        className="gatepick"
        onClick={() => window.dispatchEvent(new CustomEvent(ADD_ITEM_EVENT))}
        disabled={busy}
      >
        <b>Add a new item</b>
        <span>Pick from the list of every item in the system, or enter one by hand.</span>
      </button>
    </div>
  );
}
