"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ICONS } from "@/lib/icons";
import { parseWorkPath, processPath, writeProcCookie } from "@/lib/process";
import StepChoices from "./StepChoices";
import LeChoices from "./LeChoices";
import type { LeAnswer } from "@/lib/lecycle";
import StepReset from "./StepReset";

/* The corridor. Inside a process there is no sidebar — just this: which
   process, which year, the steps of THIS process and nothing else, and what
   the current step is asking for.

   It reads its own position from the pathname rather than being handed one.
   Steps of a process mostly render the same underlying view, so moving
   between them is a navigation the root layout is not re-rendered for; a
   rail built server-side would keep pointing at the step you left.

   Counts come from the last server render, which is refreshed whenever
   something is written. Completion is only claimed where the platform
   actually knows: distribution verification, the new-items answer and the
   Plan of Record submission are all recorded per customer, so those steps can say
   "9 of 13" — and they count the customers the TOP BAR has in scope, not
   every customer on file. The base review is submitted from its own card on
   that screen, so it ticks too; building the plan leaves events but no
   finish line, so that step shows progress rather than a tick. */

export type RailStatus = {
  customers: number;
  verified: number;   // distribution verified
  newItems: number;   // new-items question answered either way
  added: number;      // items added across those customers
  signed: number;     // Plan of Record signed (from anywhere)
  submitted: number;  // submitted from the Review & submit step — the only thing step 5 ticks on
  baseReviewed: number; // the Base Business Review submitted from its own card
  events: number;
  taken: number;      // LE: locked for the due cycle
  leAnswered: number; // LE: answered "did anything move" for the due cycle
  /** LE: that answer itself, but only when the top bar is on one account —
      which is the only time the question is asked. */
  leAnswer: LeAnswer | null;
  adjustments: number;
  /** LE: the due cycle — its key, which the answer is filed under, and the
      label to call it by. */
  cycle: string;
  cycleLabel: string;
  year: number;
};

type StepState = { done: boolean; note?: string };

function stateOf(stepKey: string, s: RailStatus | null): StepState {
  if (!s) return { done: false };
  const all = s.customers > 0;
  switch (stepKey) {
    case "distribution":
      return all && s.verified === s.customers
        ? { done: true, note: s.customers === 1 ? "verified" : `all ${s.customers} accounts` }
        : { done: false, note: `${s.verified} of ${s.customers} accounts` };
    case "new-items":
      return all && s.newItems === s.customers
        ? { done: true, note: s.added ? `${s.added} added` : "none this year" }
        : { done: false, note: `${s.newItems} of ${s.customers} answered` };
    case "base":
      return all && s.baseReviewed === s.customers
        ? { done: true, note: s.customers === 1 ? "reviewed" : `all ${s.customers} accounts` }
        : { done: false, note: `${s.baseReviewed} of ${s.customers} reviewed` };
    case "planner":
      /* Building the plan leaves events behind but has no finish line of its
         own — the finish line is the submit step after it. So this shows
         progress, never a tick. */
      return { done: false, note: `${s.events} event${s.events === 1 ? "" : "s"}` };
    case "submit":
      /* Only a submission made FROM this step counts. A Plan of Record
         taken from the sign-off card or the LE screen is a real version,
         but nobody submitted the plan — so the pill stays open. */
      return all && s.submitted === s.customers
        ? { done: true, note: s.customers === 1 ? "submitted" : `all ${s.customers} accounts` }
        : { done: false, note: `${s.submitted} of ${s.customers} submitted` };
    case "adjust": {
      if (!all || s.leAnswered < s.customers) return { done: false, note: `${s.leAnswered} of ${s.customers} answered` };
      /* Answered is not the same as unchanged: "adjusting" with nothing moved
         yet is a month in progress, and calling that "nothing changed" would
         put words in their mouth. */
      const note =
        s.leAnswer === "none"
          ? "nothing changed"
          : s.adjustments
            ? `${s.adjustments} adjustment${s.adjustments === 1 ? "" : "s"}`
            : s.leAnswer === "adjusting"
              ? "adjusting"
              : `all ${s.customers} accounts`;
      return { done: true, note };
    }
    case "lock":
      return all && s.taken === s.customers
        ? { done: true, note: `${s.cycleLabel} locked` }
        : { done: false, note: `${s.taken} of ${s.customers} accounts locked` };
    default:
      return { done: false };
  }
}

export default function ProcessRail({
  status,
  scopeLabel,
  inScope,
}: {
  status: RailStatus | null;
  scopeLabel: string;
  inScope: string[];
}) {
  const pathname = usePathname();
  const loc = parseWorkPath(pathname);

  /* Remember this step as the place to come back to. Position is personal, so
     it lives in a cookie; the work itself is already saved per customer ×
     year, which is what makes leaving midway safe. */
  const kind = loc?.proc.kind, stepKey = loc?.step.key, year = loc?.year;
  useEffect(() => {
    if (kind && stepKey) writeProcCookie({ kind, step: stepKey, planYear: year });
  }, [kind, stepKey, year]);

  /* A click on the held page is not a dead click: it scrolls the rail into
     view and flashes it, so the thing that was clicked answers with the
     thing that has to happen first. The chart chips below the scrim look
     live — dimmed, but live — and a button that swallows a click in silence
     reads as broken. */
  const railRef = useRef<HTMLDivElement>(null);
  /* Publish the rail's bottom edge as --rail-bottom, so a card further down
     the page can keep its header stuck right under the steps while its body
     scrolls. The rail is sticky at the top bar's height and its own height
     changes with the step (a chooser footer is taller), so it is measured. */
  useEffect(() => {
    const el = railRef.current;
    const root = document.documentElement;
    if (!el) return;
    const put = () => root.style.setProperty("--rail-bottom", `${60 + el.getBoundingClientRect().height}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--rail-bottom"); };
  });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerClick = () => {
    const el = railRef.current;
    if (!el) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    el.classList.remove("flash");
    // restart the animation even if it is mid-run
    void el.offsetWidth;
    el.classList.add("flash");
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => el.classList.remove("flash"), 1400);
  };

  if (!loc) return null;
  const { proc, step, index } = loc;
  /* A step that asks a question holds the page until it is answered. The
     work below is not browsable yet — it is about to change depending on
     the answer — so it is dimmed and made inert rather than left looking
     usable. The top bar stays live: scope is what the answer applies to.
     A per-account step holds the page the same way before an account is
     even chosen. That is not a trap: the top bar sits above the scrim, so
     the one thing left to do is the one thing still lit. */
  const oneAccount = inScope.length === 1;
  const needsAccount = !!step.perAccount && !oneAccount;
  /* On a step that asks a question the page is dimmed the whole time it is
     the step being shown, answered or not: the two choices are what this
     step is, and the work below belongs to the steps either side of it.
     The urging — the ring, the pulse, the "choose one" badge — is only for
     while the question is still open. */
  const onChooser = !!step.chooser && oneAccount;
  const answered = !status
    ? false
    : step.chooser === "le-changes"
      ? status.leAnswered >= status.customers
      : status.newItems >= status.customers;
  const unanswered = onChooser && !!status && !answered;
  /* How long the hold lasts is the step's to say. Plan's question is settled
     in the rail or in a modal above the page, so it holds for the whole step;
     the estimate's "adjust" answer hands the planner back, so that one holds
     only until it is answered. */
  const hold = needsAccount || (onChooser && (step.holdsUntil !== "answer" || unanswered));
  const urge = needsAccount || unanswered;
  const next = index < proc.steps.length - 1 ? proc.steps[index + 1] : null;
  const many = proc.steps.length > 1;

  return (
    <>
    {hold && (
      <div
        className="stepscrim"
        aria-hidden="true"
        onClick={answerClick}
        title={needsAccount ? "Pick an account in the top bar first" : "Choose one of the two options above first"}
      />
    )}
    <div ref={railRef} className={"prail " + proc.kind + (urge ? " needs" : "")}>
      <div className="prail-top">
        <Link href="/start" className="pback" title="Back to the front door — your place is saved">
          ← All work
        </Link>
        <span className="ptitle">
          <span className="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[proc.icon] ?? "" }} />
          {proc.label}
          {year ? <b> {year}</b> : proc.kind === "le" && status ? <b> FY{status.year}</b> : null}
        </span>
        <span className="pscope" title="The customers this step applies to — change them in the top bar">
          {scopeLabel}
        </span>
        {urge && <span className="pneeds">{needsAccount ? "Pick an account" : "Choose one to continue"}</span>}
        {many && <span className="pcount">Step {index + 1} of {proc.steps.length}</span>}
        {year && (
          <StepReset
            year={year}
            markets={inScope}
            scopeLabel={scopeLabel}
            restartHref={processPath(proc.kind, proc.steps[0].key, year)}
          />
        )}
      </div>

      {many && (
        <ol className="psteps">
          {proc.steps.map((s, i) => {
            const st = stateOf(s.key, status);
            const cls = i === index ? "on" : st.done ? "done" : i < index ? "past" : "ahead";
            return (
              <li key={s.key} className={cls}>
                <Link href={processPath(proc.kind, s.key, year)}>
                  <span className="n" aria-hidden="true">{st.done ? "✓" : i + 1}</span>
                  <span className="sl">
                    {s.label}
                    {st.note && <span className="sn">{st.note}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {/* The step chips above are the navigation — every step is one click,
          back or forward — so a plain step's footer is its one line of
          instruction and nothing else. The prev/next pills that used to sit
          here said the same thing twice, and "Add new items →" once presumed
          the answer to the question it walked past. The last step keeps a
          way out: "Done for now" is the only thing that says finished. */}
      {needsAccount ? (
        <div className="prail-foot chooser">
          <span className="pblurb">{step.blurb}</span>
          <div className="pickfirst">
            ◇ <span>
              The top bar is on <b>{scopeLabel}</b>
              {inScope.length ? <>, which is {inScope.length} accounts</> : null}. {proc.accountWhy} — so pick one
              under <b>Account</b> in the top bar. It is the only thing still lit.
            </span>
          </div>
        </div>
      ) : step.chooser === "new-items" && year ? (
        <div className="prail-foot chooser">
          <span className="pblurb">{step.blurb}</span>
          <StepChoices
            year={year}
            markets={inScope}
            scopeLabel={scopeLabel}
            nextHref={processPath(proc.kind, next?.key ?? step.key, year)}
            added={status?.added ?? 0}
          />
        </div>
      ) : step.chooser === "le-changes" && status ? (
        <div className="prail-foot chooser">
          <span className="pblurb">{step.blurb}</span>
          <LeChoices
            year={status.year}
            cycle={status.cycle}
            cycleLabel={status.cycleLabel}
            markets={inScope}
            scopeLabel={scopeLabel}
            nextHref={processPath(proc.kind, next?.key ?? step.key)}
            answer={status.leAnswer}
            adjustments={status.adjustments}
          />
        </div>
      ) : (
        <div className="prail-foot">
          <span className="pblurb">{step.blurb}</span>
          {!next && many && (
            <span className="pnav">
              <Link className="btn" href="/start">Done for now →</Link>
            </span>
          )}
        </div>
      )}
    </div>
    </>
  );
}
