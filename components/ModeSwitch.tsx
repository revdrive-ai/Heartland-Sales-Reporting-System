"use client";

import { usePathname, useRouter } from "next/navigation";
import { MODE_PARAMS, writeModeCookie, type ModeKind, type WorkMode } from "@/lib/mode";

/* "Working on" — the segmented mode switch in the top bar: Analyze · LE —
   FY<edge> · Plan — FY<next>. Picking one persists the preference and
   re-renders the current page in that year; the page-level year selectors
   are gone, so this is the only place the year is chosen. */

export default function ModeSwitch({ mode }: { mode: WorkMode }) {
  const router = useRouter();
  const pathname = usePathname();

  const go = (kind: ModeKind, planYear?: number) => {
    writeModeCookie({ kind, planYear: planYear ?? mode.planYear });
    // read the live query at click time — no useSearchParams, so static
    // pages need no Suspense boundary around the top bar
    const p = new URLSearchParams(window.location.search);
    for (const k of MODE_PARAMS) p.delete(k);
    const q = p.toString();
    router.push(pathname + (q ? `?${q}` : ""));
    router.refresh();
  };

  const seg = (kind: ModeKind, label: string, title: string) => (
    <button
      type="button"
      className={mode.kind === kind ? "cur" : undefined}
      onClick={() => go(kind)}
      title={title}
      aria-pressed={mode.kind === kind}
    >
      {label}
    </button>
  );

  return (
    <div className="modeswitch" title="What you're working on — every tab opens in this year">
      <span className="lbl">Working on:</span>
      <div className="modeseg" role="group" aria-label="Working mode">
        {seg("analyze", "Analyze", "Measured history — rolling windows and prior total years")}
        {seg("le", `LE — FY${mode.leYear}`, `The in-flight year: actuals through the NIQ data edge plus the forecast to year-end — where the monthly Latest Estimates are taken`)}
        {seg("plan", `Plan — FY${mode.planYear}`, `Next year's plan: distribution verification, plan adjustments, the plan builder and Plan of Record sign-off`)}
        {mode.kind === "plan" && mode.planYears.length > 1 && (
          <select
            className="modeyear"
            value={String(mode.planYear)}
            onChange={(e) => go("plan", +e.target.value)}
            title="Which forward year to plan"
            aria-label="Plan year"
          >
            {mode.planYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
