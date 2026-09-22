"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getDistVerification, saveDistVerification } from "@/lib/repo/client";
import { ADD_ITEM_EVENT } from "@/lib/process";

/* The two answers to step 2, in the rail where the step is.

   There is no "continue" button on this step because there is nothing to
   continue past: either there are new items or there are not, and both
   answers move the plan on. Saying there are none is recorded per customer,
   which is what lets the step read as done.

   ONE ACCOUNT AT A TIME, like starting over. The answer is recorded per
   customer and a new item is added to one customer's plan, so neither is a
   question that can be answered for a territory. Until the top bar names a
   single account the step says so instead of offering a button that would
   answer for thirteen. */

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

  const one = markets.length === 1;

  /* The answer belongs to one customer. A customer that already has items is
     left alone — "none" would contradict what is already there. */
  const none = async () => {
    if (!one) return;
    setBusy(true);
    try {
      const code = markets[0];
      const doc = await getDistVerification(code, year);
      if (!doc.additions.length) {
        await saveDistVerification(code, year, { ...doc, no_additions: new Date().toISOString() });
      }
      router.push(nextHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!one) {
    return (
      <div className="pickfirst">
        ◇ <span>
          The top bar is on <b>{scopeLabel}</b>
          {markets.length ? <>, which is {markets.length} accounts</> : null}. New items are added to one
          account&apos;s plan and &ldquo;none this year&rdquo; is recorded against one account, so this step is
          answered one at a time — that is what &ldquo;of {markets.length || 13} accounts&rdquo; above counts.
          Pick one under <b>Account</b> in the top bar.
        </span>
      </div>
    );
  }

  return (
    <div className="stepchoices">
      <button className="gatepick go" onClick={none} disabled={busy}>
        <b>{added ? `Done — ${added} added` : `No new items for ${year}`}</b>
        <span>
          {busy
            ? "Recording…"
            : added
              ? `They ride into the ${year} base. On to Base & Lift.`
              : `Recorded for ${scopeLabel}, and Base & Lift opens next.`}
        </span>
      </button>
      <button
        className="gatepick"
        onClick={() => window.dispatchEvent(new CustomEvent(ADD_ITEM_EVENT))}
        disabled={busy}
      >
        <b>Add a new item</b>
        <span>Added to {scopeLabel} — pick from the list of every item in the system, or enter one by hand.</span>
      </button>
    </div>
  );
}
