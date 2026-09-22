# Surfaces — one codebase, two deployments

The platform has 18 views. Not everyone needs 18. A **surface** is a named
subset of them: the same code, the same Supabase project, the same numbers,
with a shorter sidebar and its own URL.

| Surface | Views | Deployment |
| --- | --- | --- |
| `full` | all 18 | `heartland.revdrive.ai` — the default, unchanged |
| `lite` | 3 | a second Vercel project off the same `main` |

Today `lite` shows **Sales Dashboard**, **Monthly Forecast Review** and
**Latest Estimate** — what a reviewer reads, none of what a planner builds in.

Only built views are in it. Objectives & KPIs, Approvals and the Sales
Leader View would all fit the audience, but they are still `PageStub`
placeholders; a surface whose whole point is a short, useful sidebar should
not be padded with pages that say "coming soon". Add them to the list the
day they are real.

**This is focus, not access control.** Both surfaces authenticate the same
way and read the same rows; someone on the lite surface is entitled to every
number in the platform. Hiding a view stops it cluttering the sidebar, not
from being seen. If a screen needs to be genuinely restricted from some
people, that is a different job — row-level policy in Supabase, not this.

## Changing what lite shows

One list, in `lib/surface.ts`:

```ts
const LITE_VIEWS = ["reporting", "forecast", "le"];
```

The names are `view` keys from `lib/nav.ts`. Nothing else needs touching —
the sidebar, the route guard and the landing redirect all read from here.
A group that loses all its items disappears from the sidebar rather than
rendering as an empty heading.

To add a third surface, add a key to `SurfaceKey` and a row to `VIEWS`.

## What reads the surface

| Concern | Where |
| --- | --- |
| Sidebar contents | `components/Sidebar.tsx` → `navFor()` |
| A hidden view typed or bookmarked | `middleware.ts` → `isHiddenView()`, redirects to the surface's home |
| `/` and the post-sign-in landing | `app/page.tsx`, `middleware.ts` → `surfacePath()` |
| The nightly LE lock | `app/api/cron/le-lock/route.ts` — runs on `full` only |

That last one matters: a second Vercel project builds from the same repo, so
it inherits `vercel.json`'s cron. Without the guard both projects would fire
at 00:05 UTC against the same Supabase and could race to write the same
lock version. The lite deployment now answers the cron with a no-op and
needs no `CRON_SECRET`.

## Standing up the lite deployment

1. **Vercel → Add New → Project**, import the same GitHub repo
   (`revdrive-ai/heartland-sales-reporting-system`). Vercel allows several
   projects from one repo; name this one e.g. `heartland-review`.
2. **Production branch: `main`** — the same branch. Both projects redeploy on
   every push, which is the point: one codebase, no drift.
3. **Environment variables** — copy from the existing project:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - the service-role key, if the full project has it (server-only, same value)
   - **`NEXT_PUBLIC_SURFACE` = `lite`** ← the only difference
   - do **not** set `CRON_SECRET`; this project does not lock.
4. **Domain** — add the subdomain you want (e.g. `review.revdrive.ai`) and
   point an A record at `76.76.21.21` at Namecheap, matching how
   `heartland` was set up.
5. **Supabase → Authentication → URL Configuration** — add the new host to
   Redirect URLs (`https://review.revdrive.ai/**`). Sign-in is otherwise
   identical: same domain rule, same codes, same accounts. Someone who can
   sign in to one can sign in to the other.

`NEXT_PUBLIC_SURFACE` is inlined at build time, so changing it takes a
redeploy, and each project bakes in its own value — the sidebar, middleware
and cron on a given deployment can never disagree about which surface they
are.

## Checking which surface a deployment is

`GET /api/health` returns `"surface": "full" | "lite"` alongside the backend
and writability check. The sidebar says the same thing at a glance: the lite
surface has two groups, the full one has five.
