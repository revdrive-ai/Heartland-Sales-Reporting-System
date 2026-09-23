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
   distribution doc is saved per customer x year and BaseView reads it.

   LE is the same shape over the in-flight year: a read of where the year
   stands, the Base Business Review, the promotions, then the versions screen
   where the cycle is locked. Its question — did anything move — is asked
   once a MONTH rather than once a year, because an estimate is taken every
   cycle against the same year. */

/** A modal on the underlying view that a step opens on arrival. */
export type StepModal = "distribution" | "newitem";

/* The plan's last step is a read-back. Everything the four steps before it
   wrote — the distribution answers, the new items, the levers, the events —
   is shown together for the one account, and only then is the Plan of Record
   taken. Signing off used to sit inside step 4 as a side action on the
   planner; a plan is submitted once, deliberately, from a page that shows
   what is being submitted, not from a button beside the calendar. */

export type ProcessStep = {
  key: string;
  label: string;
  /** The one line of instruction shown in the step footer. */
  blurb: string;
  /** Route segment of the existing view that renders this step. */
  view: string;
  open?: StepModal;
  /** This step asks a question in the rail rather than advancing blindly. */
  chooser?: "new-items" | "le-changes";
  /** How long the page below is held while this step is on screen.

      "step"   — the whole time, answered or not. The answer's work happens in
                 a modal that sits above the scrim, so there is never anything
                 on the page itself to reach for.
      "answer" — until the question has an answer. One of the answers IS the
                 page (adjust the estimate on the planner), so holding past
                 the answer would hold them off the work they just chose. */
  holdsUntil?: "step" | "answer";
  /** Its work belongs to one customer, so it cannot start until the top bar
      names one. Everything a plan year is built from — the distribution
      answers, the new items, the adjustments, the events and the sign-off —
      is recorded against a customer, so the whole plan is worked one account
      at a time. */
  perAccount?: true;
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
  /** Why this process is worked one account at a time — shown while the top
      bar names more than one. Set on any process with per-account steps. */
  accountWhy?: string;
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
    detail: "Four steps: see where the year stands, adjust the base, adjust the promotions, then review and lock the month.",
    icon: "refresh",
    needsYear: false,
    accountWhy:
      "An estimate is taken one account at a time — the forecast you are adjusting is that customer's, and each month's version locks against it",
    steps: [
      {
        key: "stand",
        label: "Where the year stands",
        blurb: "Actuals through the NIQ edge plus the estimate to year-end, against the plan and last year — what this month starts from.",
        view: "stand",
        perAccount: true,
      },
      {
        key: "lebase",
        label: "Adjust the base",
        blurb: "Say whether anything moved this month. If it did, work the base business below for the months still to come — the promotions are the next step.",
        view: "base",
        chooser: "le-changes",
        /* Choosing to adjust hands the page back, so the hold ends with the
           answer rather than with the step. */
        holdsUntil: "answer",
        perAccount: true,
      },
      {
        key: "promos",
        label: "Adjust the promotions",
        blurb: "Confirm, change, cancel or add the promotions still to run this year. The Telus book stays as booked; the estimate carries your changes.",
        view: "planner",
        perAccount: true,
      },
      {
        key: "lock",
        label: "Review & lock",
        blurb: "Read the full year back against the plan, last year and the last estimate, then lock this cycle's version.",
        view: "le",
        perAccount: true,
      },
    ],
  },
  {
    kind: "plan",
    label: "Plan a new year",
    tagline: "Build next year",
    detail: "Five steps: confirm distribution, add new items, review the base business, build the promotion plan, then review and submit.",
    icon: "calendar",
    needsYear: true,
    accountWhy:
      "A plan is built one account at a time — the distribution answers, the new items, the adjustments, the events and the sign-off all belong to a customer",
    steps: [
      {
        key: "distribution",
        label: "Review distribution",
        blurb: "Confirm which of last year's items carry volume into the plan year at this customer.",
        view: "base",
        open: "distribution",
        perAccount: true,
      },
      {
        key: "new-items",
        label: "Add new items",
        blurb: "Anything launching in the plan year — or say there are none, and move on.",
        view: "base",
        chooser: "new-items",
        /* Both answers are settled in the rail or in the add-item modal, so
           the page below is held for as long as this is the step. */
        holdsUntil: "step",
        perAccount: true,
      },
      {
        key: "base",
        label: "Base Business Review",
        blurb: "Review the plan-year base. It already reflects the distribution and new-item decisions above.",
        view: "base",
        perAccount: true,
      },
      {
        key: "planner",
        label: "Build the plan",
        blurb: "Lay the promotion calendar on that base — events, lift and trade spend for the year.",
        view: "planner",
        perAccount: true,
      },
      {
        key: "submit",
        label: "Review & submit the plan",
        blurb: "Read back everything entered for this account, then submit it as the Plan of Record.",
        view: "review",
        perAccount: true,
      },
    ],
  },
];

export const WORK_PREFIX = "/work";


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

/* The rail's "Add a new item" and the add form live in different trees — the
   rail is drawn by the layout, the form by the page — so the button asks for
   the form with an event rather than a navigation. A navigation would have to
   change the URL to fire twice, and "open the form again" is not a different
   place. */
export const ADD_ITEM_EVENT = "hh:add-item";

/* Starting over ends on step 1 with the list open, even when step 1 is the
   step it started from — a navigation to the URL you are already on does
   nothing, so the rail asks for the list rather than relying on arriving. */
export const OPEN_DISTRIBUTION_EVENT = "hh:open-distribution";
