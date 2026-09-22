"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ICONS } from "@/lib/icons";
import { PROCESSES, processFor, processPath, resumePath, type ProcResume } from "@/lib/process";
import { writeModeCookie, type WorkMode } from "@/lib/mode";

/* The front door. One question — what did you come here to do — and the
   three answers, which are the working modes that used to live in the
   sidebar. No sidebar, no workflow chrome, nothing to read past.

   Admins get a fourth way in: the whole map, as the tool has always been. */

export default function FrontDoor({
  mode,
  admin,
  resume,
}: {
  mode: WorkMode;
  admin: boolean;
  resume: ProcResume | null;
}) {
  const router = useRouter();
  const [planYear, setPlanYear] = useState(mode.planYear);

  const enter = (kind: (typeof PROCESSES)[number]["kind"], year?: number) => {
    // write the mode before navigating so the first paint is already right;
    // the middleware sets the same value on the way through
    writeModeCookie({ kind, planYear: year ?? mode.planYear });
    router.push(processPath(kind, undefined, year));
    /* And refresh: the front door and the process share a root layout, which
       Next therefore does not re-render across this navigation — the rail
       would open with the counts this page computed, which for Analyze is
       none at all. */
    router.refresh();
  };

  const resumeProc = resume ? processFor(resume.kind) : undefined;
  const resumeStep = resumeProc?.steps.find((s) => s.key === resume?.step);
  const resumeIsMidway = !!resumeProc && !!resumeStep && resumeProc.steps.length > 1;

  const yearOf = (kind: string) =>
    kind === "plan" ? planYear : kind === "le" ? mode.leYear : undefined;

  return (
    <div className="front">
      <div className="front-head">
        <h1>What are you working on?</h1>
        <p>
          Pick the work and the platform steps you through it. Everything else stays out of the way
          until you need it.
        </p>
      </div>

      {resume && resumeProc && resumeStep && (
        <button className="resume" onClick={() => { router.push(resumePath(resume)); router.refresh(); }}>
          <span className="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS.clock ?? "" }} />
          <span className="rt">
            <b>Pick up where you left off</b>
            <span className="rd">
              {resumeProc.label}
              {resumeProc.needsYear && resume.planYear ? ` ${resume.planYear}` : ""}
              {resumeIsMidway
                ? ` · step ${resumeProc.steps.findIndex((s) => s.key === resume.step) + 1} of ${resumeProc.steps.length} — ${resumeStep.label}`
                : ` · ${resumeStep.label}`}
            </span>
          </span>
          <span className="go">Continue →</span>
        </button>
      )}

      <div className="tiles">
        {PROCESSES.map((p) => (
          <div className="tile" key={p.kind}>
            <button className="tile-hit" onClick={() => enter(p.kind, yearOf(p.kind))}>
              <span className="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[p.icon] ?? "" }} />
              <span className="tl">
                <b>{p.label}</b>
                <span className="tag">{p.tagline}</span>
              </span>
              <span className="td">{p.detail}</span>
              <span className="steps">
                {p.steps.length === 1 ? "1 screen" : `${p.steps.length} steps`}
              </span>
            </button>
            {/* every tile carries a footer, so the three line up: the year
                this work is about, and for Plan the choice of which */}
            {p.needsYear ? (
              <label className="tile-year">
                Plan year
                <select
                  value={String(planYear)}
                  onChange={(e) => setPlanYear(+e.target.value)}
                  aria-label="Plan year"
                >
                  {mode.planYears.map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="tile-year static">
                {p.kind === "le" ? `FY${mode.leYear}` : "Rolling windows · prior years"}
              </div>
            )}
          </div>
        ))}
      </div>

      {admin && (
        <div className="adminrow">
          <button className="adminbtn" onClick={() => { router.push("/reporting"); router.refresh(); }}>
            <span className="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS.map ?? "" }} />
            <span className="at">
              <b>Admin</b>
              <span>Every view, the full sidebar — the platform as it has always been.</span>
            </span>
            <span className="go">Open →</span>
          </button>
        </div>
      )}
    </div>
  );
}
