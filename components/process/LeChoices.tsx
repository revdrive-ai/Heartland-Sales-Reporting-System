"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setLeCycleAnswer } from "@/lib/repo/client";
import type { LeAnswer } from "@/lib/lecycle";

/* The two answers to the estimate's middle step, in the rail where the step
   is — the LE counterpart of StepChoices.

   The difference from the plan's new-items question is where the work goes.
   "Add a new item" opens a form over the page, so the page stays held. Here,
   "Adjust the estimate" IS the page: the planner underneath is the tool, and
   the answer's job is to hand it back. So this one records the answer and
   then gets out of the way — the rail lifts its hold, the chosen card stays
   marked, and the way on to the lock step appears.

   Asked per CYCLE, not per year: an estimate is taken every month against
   the same in-flight year, so next month asks again.

   ONE ACCOUNT AT A TIME, like the rest of the estimate. The answer is
   recorded against a customer, so it is not a question a territory can
   answer; the rail does not render this until the top bar names one, and
   `one` is the belt to that braces. */

export default function LeChoices({
  year,
  cycle,
  cycleLabel,
  markets,
  scopeLabel,
  nextHref,
  answer,
  adjustments,
}: {
  year: number;
  cycle: string;
  cycleLabel: string;
  markets: string[];
  scopeLabel: string;
  nextHref: string;
  answer: LeAnswer | null;
  adjustments: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const one = markets.length === 1;

  const record = async (a: LeAnswer, go?: string) => {
    if (!one) return;
    setBusy(true);
    try {
      await setLeCycleAnswer(markets[0], year, cycle, a);
      /* "Nothing changed" is finished business, so it moves on. "Adjusting"
         stays put: the planner it just unlocked is on this very step. */
      if (go) router.push(go);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stepchoices">
      <button
        className={"gatepick go" + (answer === "none" ? " chosen" : "")}
        onClick={() => record("none", nextHref)}
        disabled={busy}
      >
        <b>{answer === "none" ? `Nothing changed — recorded` : `Nothing changed this month`}</b>
        <span>
          {busy
            ? "Recording…"
            : answer === "none"
              ? `${cycleLabel} stands on the forecast already on record for ${scopeLabel}.`
              : `The forecast on record still stands for ${scopeLabel}, and the lock step opens next.`}
        </span>
      </button>
      <button
        className={"gatepick" + (answer === "adjusting" ? " chosen" : "")}
        onClick={() => record("adjusting")}
        disabled={busy}
      >
        <b>{answer === "adjusting" ? "Adjusting — the planner is yours" : "Adjust the estimate"}</b>
        <span>
          {answer === "adjusting"
            ? `${adjustments ? `${adjustments} adjustment${adjustments === 1 ? "" : "s"} on ${scopeLabel} so far` : `Nothing moved on ${scopeLabel} yet`}. Lock the month when ${cycleLabel} is where you want it.`
            : `Work the promotions and the forecast on the planner below — it unlocks as soon as you choose this.`}
        </span>
      </button>
      {answer === "adjusting" && (
        <Link className="btn primary lechoose-on" href={nextHref}>
          Lock the month →
        </Link>
      )}
    </div>
  );
}
