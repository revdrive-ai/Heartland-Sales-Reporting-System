"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ICONS } from "@/lib/icons";
import { parseWorkPath, processPath, writeProcCookie } from "@/lib/process";
import StepChoices from "./StepChoices";
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
   actually knows: distribution verification, the new-items answer and Plan
   of Record sign-off are all recorded per customer, so those steps can say
   "9 of 13" — and they count the customers the TOP BAR has in scope, not
   every customer on file. Reviewing the base leaves no trace, so that step
   shows progress rather than a tick it has not earned. */

export type RailStatus = {
  customers: number;
  verified: number;   // distribution verified
  newItems: number;   // new-items question answered either way
  added: number;      // items added across those customers
  signed: number;     // Plan of Record signed
  events: number;
  taken: number;      // LE: locked for the due cycle
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
    case "planner":
      return all && s.signed === s.customers
        ? { done: true, note: "signed off" }
        : { done: false, note: `${s.events} event${s.events === 1 ? "" : "s"} · ${s.signed} of ${s.customers} signed` };
    case "estimate":
      return { done: false, note: `${s.taken} of ${s.customers} accounts locked` };
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
  const needsChoice =
    step.chooser === "new-items" && oneAccount && !!status && status.newItems < status.customers;
  const hold = needsAccount || needsChoice;
  const prev = index > 0 ? proc.steps[index - 1] : null;
  const next = index < proc.steps.length - 1 ? proc.steps[index + 1] : null;
  const many = proc.steps.length > 1;

  return (
    <>
    {hold && <div className="stepscrim" aria-hidden="true" />}
    <div className={"prail " + proc.kind + (hold ? " needs" : "")}>
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
        {hold && <span className="pneeds">{needsAccount ? "Pick an account" : "Choose one to continue"}</span>}
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

      {/* A step that asks a question owns its own way forward, and the step
          BEFORE one loses its next button: "Add new items →" presumed the
          answer, which is why it read as broken — it walked you past the
          question rather than to it. A plain step keeps its button. */}
      {needsAccount ? (
        <div className="prail-foot chooser">
          <span className="pblurb">{step.blurb}</span>
          <div className="pickfirst">
            ◇ <span>
              The top bar is on <b>{scopeLabel}</b>
              {inScope.length ? <>, which is {inScope.length} accounts</> : null}. This step belongs to one
              account — distribution is confirmed per account and a new item joins one account&apos;s plan — so
              pick one under <b>Account</b> in the top bar. It is the only thing still lit.
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
      ) : (
        <div className="prail-foot">
          <span className="pblurb">{step.blurb}</span>
          <span className="pnav">
            {prev && (
              <Link className="btn" href={processPath(proc.kind, prev.key, year)}>
                ← {prev.label}
              </Link>
            )}
            {next && !next.chooser && (
              <Link className="btn primary" href={processPath(proc.kind, next.key, year)}>
                {next.label} →
              </Link>
            )}
            {!next && many && <Link className="btn" href="/start">Done for now →</Link>}
          </span>
        </div>
      )}
    </div>
    </>
  );
}
