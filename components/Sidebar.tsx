"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { navFor } from "@/lib/surface";
import { ICONS } from "@/lib/icons";
import { MODE_PARAMS, writeModeCookie, type ModeKind, type WorkMode } from "@/lib/mode";

/* The sidebar opens with "Working on" — the one year decision (Analyze · LE ·
   Plan), made before anything else and highlighted green while it holds. The
   workflow groups below all render in whichever mode is picked here. */

const MODE_ICON: Record<ModeKind, string> = { analyze: "search", le: "refresh", plan: "calendar" };

export default function Sidebar({ mode }: { mode: WorkMode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = (view: string) =>
    pathname === `/${view}` || (pathname === "/" && view === "reporting");

  const go = (kind: ModeKind, planYear?: number) => {
    writeModeCookie({ kind, planYear: planYear ?? mode.planYear });
    // drop any stale year in the URL so a bookmarked link can't fight this
    const p = new URLSearchParams(window.location.search);
    for (const k of MODE_PARAMS) p.delete(k);
    const q = p.toString();
    router.push(pathname + (q ? `?${q}` : ""));
    router.refresh();
  };

  const modeItem = (kind: ModeKind, label: string, sub: string, title: string) => (
    <button
      type="button"
      className={"navitem modeitem" + (mode.kind === kind ? " on" : "")}
      onClick={() => go(kind)}
      title={title}
      aria-pressed={mode.kind === kind}
    >
      <span className="ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[MODE_ICON[kind]] ?? "" }} />
      <span className="ml">
        {label}
        <span className="sub">{sub}</span>
      </span>
      {mode.kind === kind && <span className="dot" aria-hidden="true">●</span>}
    </button>
  );

  return (
    <aside className="side">
      <div className="navgroup modes">
        <h4>Working on</h4>
        {modeItem("analyze", "Analyze", "measured history", "Measured history — rolling windows and prior total years")}
        {modeItem("le", "Latest Estimate", `FY${mode.leYear} · actuals + forecast`,
          `The in-flight year: actuals through the NIQ data edge plus the forecast to year-end — where the monthly Latest Estimates are taken`)}
        {modeItem("plan", "Plan", `FY${mode.planYear} · build next year`,
          `Next year's plan: distribution verification, plan adjustments, the plan builder and Plan of Record sign-off`)}
        {mode.kind === "plan" && mode.planYears.length > 1 && (
          <div className="planyear">
            <span>Plan year</span>
            <select
              value={String(mode.planYear)}
              onChange={(e) => go("plan", +e.target.value)}
              aria-label="Plan year"
              title="Which forward year to plan"
            >
              {mode.planYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {navFor().map((g) => (
        <div className="navgroup" key={g.heading}>
          <h4>{g.heading}</h4>
          {g.items.map((it) => (
            <Link
              key={it.view}
              href={`/${it.view}`}
              className={"navitem" + (active(it.view) ? " active" : "")}
              title={it.title}
              style={{ textDecoration: "none" }}
            >
              <span
                className="ic"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: ICONS[it.icon] ?? "" }}
              />
              {" "}{it.label}{" "}
              {it.tag ? <span className="tag">{it.tag}</span> : null}
              {it.badge ? <span className="badge">{it.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
      <div className="sidefoot">
        <div className="t">TELUS transition</div>
        <div className="d">Running in parallel. New platform validated against TELUS each sprint.</div>
        <span className="transition-pill">● Sprint 2 · Reporting live</span>
      </div>
    </aside>
  );
}
