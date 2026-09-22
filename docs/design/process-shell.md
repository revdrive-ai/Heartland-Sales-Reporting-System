# Process shell — a front door instead of a sidebar

_Design plan. Nothing here is built yet._

## The problem

The tool today is a **map**: 18 views in a sidebar, all reachable at all
times, in whatever order. That is the right shape for the person who built
it and the wrong shape for an account person who has one job to do this
week.

The change is from a map to a **front door plus a corridor**. Someone signs
in, picks the work they came to do, and is stepped through it. The sidebar
does not disappear — it becomes the Admin view of the same system.

## The front door

`/start` — no sidebar, no mode strip, no workflow chrome. Four choices:

| Choice | Opens | Year |
| --- | --- | --- |
| **Analyze** | Sales Dashboard, as it is today | measured history |
| **Latest Estimate** | Promotion Planner, LE variant | the in-flight NIQ year |
| **Plan a new year** | year picker → step 1 of 4 | the chosen forward year |
| **Admin** | today's app, full sidebar, all 18 views | whatever the admin picks |

The first three are the `Analyze · Latest Estimate · Plan` group that lives
in the sidebar today. This is not a new concept being invented — it is the
existing one (`lib/mode.ts`, the `hh-mode` cookie) promoted from a sidebar
widget to the front door, which is where a once-a-session decision belongs.
Choosing a process sets the mode cookie, so every view downstream already
opens in the right year with no further work.

Admin is a fourth tile, shown only to admins.

## The processes

A process is a named sequence of steps over views that already exist. The
model mirrors `lib/nav.ts` — data, not components:

```ts
type ProcessStep = {
  key: string;        // "distribution"
  label: string;      // "Review distribution"
  blurb: string;      // one line of what this step is for
  view: string;       // which existing view renders it
  open?: string;      // a modal on that view to open on arrival
  done?: DoneSignal;  // how we know it's finished
};
type Process = { key: ModeKind; label: string; steps: ProcessStep[] };
```

### Analyze — 1 step

| # | Step | View |
| --- | --- | --- |
| 1 | Sales Dashboard | `reporting`, unchanged |

Not really a process yet. It becomes one when there is more data to analyze.

### Latest Estimate — 1 step, for now

| # | Step | View |
| --- | --- | --- |
| 1 | Update the estimate | `planner`, LE variant |

### Plan a new year — 4 steps

| # | Step | View | Modal on arrival | Finished when |
| --- | --- | --- | --- | --- |
| 0 | Pick the plan year | front door | — | a year is chosen |
| 1 | Review distribution | `base` | **Verify distribution** | `distVer.verifiedAt` is set — **a real signal today** |
| 2 | Add new items | `base` | **Add new item** | needs an explicit "no new items this year" — zero additions is a valid answer, so the count alone can't say |
| 3 | Base & Lift for the plan year | `base` | — | needs an explicit Continue |
| 4 | Build the promotion plan | `planner`, plan variant | — | Plan of Record signed — **a real signal today** |

Steps 1–3 all land on the same view. Only the modal differs, and step 3 is
that view with the modals closed — which is exactly right, because by then
it is showing a base that already reflects the two steps before it. Nothing
needs to be recomputed or passed along; the distribution doc is saved per
customer × year and `BaseView` already reads it.

Two of the four steps have a genuine completion signal today. The other two
need an explicit acknowledgement. Worth being honest about that rather than
inventing a fake progress bar.

## What the corridor looks like

Inside a process, the left sidebar is gone. In its place:

- **Top bar** — unchanged. Brand, the five customer-scope selectors, Ask
  Heartland, avatar, sign out. Scope still matters (distribution is per
  customer), so the selectors stay.
- **Process header** — the process name, the year, and a way back to the
  front door.
- **Step rail** — the steps of *this* process only, current one marked, done
  ones ticked, later ones reachable but visibly ahead. Horizontal, under the
  header, where the mode strip is now.
- **Footer bar** — Back / Continue, with the step's one-line instruction.

`components/ModeStrip.tsx` already computes almost exactly the progress the
rail needs — distribution verified *x of y*, Plan of Record signed *x of y*,
adjustment and event counts, per customer. It becomes the data source for
the rail rather than a separate strip.

## Routing

Pretty, linkable URLs for each step:

```
/start
/work/analyze
/work/le
/work/plan/2027/distribution
/work/plan/2027/new-items
/work/plan/2027/base
/work/plan/2027/planner
```

`app/base/page.tsx` is ~600 lines of data assembly and `app/planner/page.tsx`
is similar. There are two ways to reuse them:

**A — middleware rewrite (recommended for phase 1).** Middleware maps
`/work/plan/2027/distribution` to `/base?...&open=distribution` with
`NextResponse.rewrite`. The browser keeps the pretty URL, the existing page
renders, nothing is duplicated, and the existing views are untouched.
`AppShell` reads `usePathname()`, sees `/work/`, and renders the rail instead
of the sidebar. `middleware.ts` already has the guard hook to hang this on.

**B — extract the loaders.** Pull the data assembly out of the page files
into `lib/server/baseData.ts` and `plannerData.ts`, then give each step its
own real page. Cleaner, and unavoidable in phase 2 when the LE planner and
the plan planner genuinely diverge — but it is a real refactor of two large
files, and doing it before the layout is agreed risks refactoring toward the
wrong shape.

Recommendation: **A now, B when the views actually fork.** The pretty URLs
are identical either way, so switching later changes no links.

## Who is an admin

A `public.app_admins` table keyed by email, same shape as the existing
`public.signup_email_domains` — so adding an admin is one SQL insert, no
deploy. `currentUser()` gains `isAdmin`; the layout and the front door read
it. Everyone else is an account person.

Non-admins are kept out of the raw view routes by the guard already in
`middleware.ts`: `/base` typed directly redirects to `/start`, while
`/work/plan/2027/base` rewrites through fine. Admin is a role, not a
separate deployment.

## What this supersedes

Worth saying plainly, so we don't end up maintaining three ways to hide a
screen:

- **The `lite` surface** (`lib/surface.ts`, shipped 2026-09-22) was the
  build-time answer to "a simpler version": a shorter sidebar on a second
  deployment. This is the better answer — the account person gets no sidebar
  at all, and it is one deployment with a role instead of two projects to
  keep in step. **Recommend retiring the `lite` preset** and keeping the
  route-guard mechanics, which this reuses. The cron guard stays useful
  regardless.
- **`components/WelcomeModal.tsx`** — the five-step loop overlay. The front
  door says the same thing better, and permanently. Retire it.
- **The sidebar's "Working on" group** — moves to the front door. The
  sidebar keeps it only in Admin.

## Phasing

**Phase 1 — the layout.** Front door, process model, step rail, routing,
role gate. Every view renders exactly as it does today; only the chrome
around them changes. This is the phase that answers "is the general layout
correct", and it should be judged on that alone.

**Phase 2 — the views per process.** The LE-variant planner and the
plan-variant planner diverge. Base & Lift gets its plan-cycle treatment.
This is where option B above gets done.

**Phase 3 — the steps get real.** Enhanced New Item modal, step gating,
per-user progress persisted in `lib/server/appstate.ts`, and whatever the
spreadsheets turn out to demand.

## Open decisions

1. **Admin list** — who besides randy@revdrive.ai?
2. **Can an account person leave a process mid-way?** Assumed yes: the front
   door is always one click away and progress is saved per customer × year,
   so nothing is lost. Say if it should be stricter than that.
3. **Retire the `lite` surface?** Recommended above; it is three days old and
   nothing depends on it.
4. **Does Analyze need the scope selectors**, or does it open on the whole
   book and let the user narrow from inside?
