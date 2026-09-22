import type { ModeKind } from "@/lib/mode";

/* Processes — the front door's answer to "what did you come here to do".

   A process is a named sequence of steps over views that already exist. Like
   lib/nav.ts this is data, not components: the front door, the step rail, the
   middleware rewrite and the resume cookie all read from PROCESSES, so adding
   a step is one entry here rather than a route, a link and a special case.

   The three processes are the working modes (lib/mode.ts) promoted from a
   sidebar widget to the front door, which is where a once-a-session decision
   belongs. Entering one sets the mode cookie, so every view downstream opens
   in the right year without being told.

   Steps 1-3 of Plan all render the SAME view. Only the modal differs, and
   step 3 is that view with the modals shut — which is the point: by then it
   is showing a base that already reflects the two steps before it. The
   distribution doc is saved per customer x year and BaseView reads it. */

/** A modal on the underlying view that a step opens on arrival. */
export type StepModal = "distribution" | "newitem";

export type ProcessStep = {
  key: string;
  label: string;
  /** The one line of instruction shown in the step footer. */
  blurb: string;
  /** Route segment of the existing view that renders this step. */
  view: string;
  open?: StepModal;
};

export type ProcessDef = {
  kind: ModeKind;
  label: string;
  tagline: string;
  /** What the person will be doing, shown on the front door tile. */
  detail: string;
  icon: string; // key into lib/icons
  /** Plan works a forward year, so the front door asks for one first. */
  needsYear: boolean;
  steps: ProcessStep[];
};

export const PROCESSES: ProcessDef[] = [
  {
    kind: "analyze",
    label: "Analyze",
    tagline: "Measured history",
    detail: "Where the business stands on the numbers already measured — rolling windows and prior years.",
    icon: "search",
    needsYear: false,
    steps: [
      {
        key: "dashboard",
        label: "Sales Dashboard",
        blurb: "The measured business for the customers in scope.",
        view: "reporting",
      },
    ],
  },
  {
    kind: "le",
    label: "Latest Estimate",
    tagline: "The in-flight year",
    detail: "Actuals through the data edge plus the forecast to year-end — the monthly estimate.",
    icon: "refresh",
    needsYear: false,
    steps: [
      {
        key: "estimate",
        label: "Update the estimate",
        blurb: "Adjust the in-flight year's promotions and forecast to today's best view.",
        view: "planner",
      },
    ],
  },
  {
    kind: "plan",
    label: "Plan a new year",
    tagline: "Build next year",
    detail: "Four steps: confirm distribution, add new items, review the base, then build the promotion plan.",
    icon: "calendar",
    needsYear: true,
    steps: [
      {
        key: "distribution",
        label: "Review distribution",
        blurb: "Confirm which of last year's items carry volume into the plan year at this customer.",
        view: "base",
        open: "distribution",
      },
      {
        key: "new-items",
        label: "Add new items",
        blurb: "Anything launching in the plan year — or say there are none, and move on.",
        view: "base",
        open: "newitem",
      },
      {
        key: "base",
        label: "Base & Lift",
        blurb: "Review the plan-year base. It already reflects the distribution and new-item decisions above.",
        view: "base",
      },
      {
        key: "planner",
        label: "Build the plan",
        blurb: "Lay the promotion calendar on that base and sign off the Plan of Record.",
        view: "planner",
      },
    ],
  },
];

export const WORK_PREFIX = "/work";

/* The rewrite hides the process URL from the page, but the layout still has
   to know it is inside a process to draw the rail instead of the sidebar.
   The middleware puts the original pathname here on the way through. */
export const WORK_HEADER = "x-hh-work";

export function processFor(kind: string | undefined): ProcessDef | undefined {
  return PROCESSES.find((p) => p.kind === kind);
}

export function stepIndex(proc: ProcessDef, stepKey: string | undefined): number {
  const i = proc.steps.findIndex((s) => s.key === stepKey);
  return i < 0 ? 0 : i;
}

export function stepAt(proc: ProcessDef, stepKey: string | undefined): ProcessStep {
  return proc.steps[stepIndex(proc, stepKey)];
}

/** The canonical URL of one step. Plan carries its year so a link, a
    screenshot and a bookmark all say which year they are about. */
export function processPath(kind: ModeKind, stepKey?: string, year?: number): string {
  const proc = processFor(kind);
  if (!proc) return WORK_PREFIX;
  const step = stepKey && proc.steps.some((s) => s.key === stepKey) ? stepKey : proc.steps[0].key;
  return proc.needsYear
    ? `${WORK_PREFIX}/${kind}/${year}/${step}`
    : `${WORK_PREFIX}/${kind}/${step}`;
}

export type WorkLocation = {
  proc: ProcessDef;
  step: ProcessStep;
  index: number;
  year?: number;
  /** True when the URL named a step; false when it defaulted to the first. */
  explicit: boolean;
};

/** Read /work/plan/2027/distribution (or /work/analyze/dashboard) back into
    a process, a year and a step. Returns null for anything else. */
export function parseWorkPath(pathname: string): WorkLocation | null {
  const segs = pathname.split("/").filter(Boolean);
  if (segs[0] !== WORK_PREFIX.slice(1)) return null;
  const proc = processFor(segs[1]);
  if (!proc) return null;

  let year: number | undefined;
  let stepKey: string | undefined;
  if (proc.needsYear) {
    const y = Number(segs[2]);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
    year = y;
    stepKey = segs[3];
  } else {
    stepKey = segs[2];
  }
  if (segs.length > (proc.needsYear ? 4 : 3)) return null;

  const explicit = !!stepKey && proc.steps.some((s) => s.key === stepKey);
  if (stepKey && !explicit) return null; // a named step that doesn't exist
  return { proc, step: stepAt(proc, stepKey), index: stepIndex(proc, stepKey), year, explicit };
}

/* ── Where someone left off ──────────────────────────────────────────────
   Position is personal, so it rides in a cookie rather than the shared
   app_state documents. The WORK itself — distribution decisions, plan
   adjustments, events — is shared per customer x year and already persisted
   server-side; this only remembers which door to reopen. */

export const PROC_COOKIE = "hh-proc";

export type ProcResume = { kind: ModeKind; step: string; planYear?: number };

export function parseProcCookie(raw: string | undefined): ProcResume | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<ProcResume>;
    const proc = processFor(v.kind);
    if (!proc || typeof v.step !== "string") return null;
    if (!proc.steps.some((s) => s.key === v.step)) return null;
    if (proc.needsYear && typeof v.planYear !== "number") return null;
    return { kind: proc.kind, step: v.step, planYear: v.planYear };
  } catch {
    return null;
  }
}

export function serializeProcCookie(r: ProcResume): string {
  return encodeURIComponent(JSON.stringify(r));
}

/** Client side: remember this step as the place to come back to. */
export function writeProcCookie(r: ProcResume) {
  try {
    document.cookie = `${PROC_COOKIE}=${serializeProcCookie(r)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

/** The URL a resume point reopens. */
export function resumePath(r: ProcResume): string {
  return processPath(r.kind, r.step, r.planYear);
}

/* The URL that shows `view` without leaving the corridor.

   Inside a process the browser is on /work/plan/2027/base while the page
   that actually renders is /base. Anything that navigates to the bare view
   route drops the person out of the process — the sidebar reappears, and
   someone who is not an admin is bounced to the front door.

   Returns null when the target has no step in the current process, which is
   the caller's cue to leave the link out rather than break the corridor. For
   staying on the SAME page with a new query, use the pathname directly:
   there may be several steps over one view, and only the current one is
   right. */
export function viewUrlWithin(pathname: string, view: string, query?: string): string | null {
  const q = query ? `?${query}` : "";
  const loc = parseWorkPath(pathname);
  if (!loc) return `/${view}${q}`;
  const step = loc.proc.steps.find((s) => s.view === view);
  return step ? processPath(loc.proc.kind, step.key, loc.year) + q : null;
}
