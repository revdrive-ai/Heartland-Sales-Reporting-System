import Link from "next/link";
import { ICONS } from "@/lib/icons";
import { processPath, type WorkLocation } from "@/lib/process";
import type { ModeStatus } from "@/lib/server/modeStatus";
import ProcRemember from "./ProcRemember";

/* The corridor. Inside a process there is no sidebar — just this: which
   process, which year, the steps of THIS process and nothing else, and what
   the current step is asking for.

   Completion is only claimed where the platform actually knows. Distribution
   verification, the new-items answer and Plan of Record sign-off are all
   recorded per customer, so those steps can say "9 of 13". Reviewing the
   base leaves no trace, so that step shows progress instead of a tick
   rather than pretending. */

type StepState = { done: boolean; note?: string };

function stateOf(stepKey: string, status: ModeStatus | null): StepState {
  if (!status) return { done: false };
  const t = status.totals;
  switch (stepKey) {
    case "distribution":
      return t.verified === t.customers && t.customers > 0
        ? { done: true, note: `all ${t.customers} accounts` }
        : { done: false, note: `${t.verified} of ${t.customers} accounts` };
    case "new-items": {
      /* Answered either way — items added, or "none this year" recorded at
         the step's gate. Zero additions is a legitimate answer, which is why
         the count alone could never decide this. */
      const added = status.customers.reduce((a, c) => a + c.distver.added, 0);
      return t.newItems === t.customers && t.customers > 0
        ? { done: true, note: added ? `${added} added` : "none this year" }
        : { done: false, note: `${t.newItems} of ${t.customers} answered` };
    }
    case "planner":
      return t.signed === t.customers && t.customers > 0
        ? { done: true, note: `signed off` }
        : { done: false, note: `${t.events} event${t.events === 1 ? "" : "s"} · ${t.signed} of ${t.customers} signed` };
    case "estimate":
      return { done: false, note: `${t.taken} of ${t.customers} accounts locked` };
    default:
      return { done: false };
  }
}

export default function ProcessRail({
  loc,
  status,
  scopeLabel,
}: {
  loc: WorkLocation;
  status: ModeStatus | null;
  scopeLabel: string;
}) {
  const { proc, step, index, year } = loc;
  const prev = index > 0 ? proc.steps[index - 1] : null;
  const next = index < proc.steps.length - 1 ? proc.steps[index + 1] : null;
  const many = proc.steps.length > 1;

  return (
    <>
      <ProcRemember at={{ kind: proc.kind, step: step.key, planYear: year }} />
      <div className={"prail " + proc.kind}>
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
          {many && (
            <span className="pcount">
              Step {index + 1} of {proc.steps.length}
            </span>
          )}
        </div>

        {many && (
          <ol className="psteps">
            {proc.steps.map((s, i) => {
              const st = stateOf(s.key, status);
              const cls =
                i === index ? "on" : st.done ? "done" : i < index ? "past" : "ahead";
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

        <div className="prail-foot">
          <span className="pblurb">{step.blurb}</span>
          <span className="pnav">
            {prev && (
              <Link className="btn" href={processPath(proc.kind, prev.key, year)}>
                ← {prev.label}
              </Link>
            )}
            {next && (
              <Link className="btn primary" href={processPath(proc.kind, next.key, year)}>
                {next.label} →
              </Link>
            )}
            {!next && many && (
              <Link className="btn primary" href="/start">
                Done for now →
              </Link>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
