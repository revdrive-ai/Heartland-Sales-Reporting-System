import { NAV, navItemFor, type NavGroup } from "@/lib/nav";

/* One codebase, two deployments.

   `NEXT_PUBLIC_SURFACE` decides how much of the platform a deployment shows.
   Both surfaces read the same Supabase project and the same numbers — this
   is about focus, not access. Someone on the lite surface is entitled to see
   everything; they just don't need the screens a planner builds in, and a
   shorter sidebar is the whole point of giving them their own URL.

   Because the variable is NEXT_PUBLIC_, Next inlines it at build time, so
   each Vercel project bakes in its own value and the sidebar, the middleware
   and the landing redirect all agree without passing anything around. */

export type SurfaceKey = "full" | "lite";

/* The lite surface: what a reviewer reads, none of what a planner builds in.
   Only built views belong here — Objectives, Approvals and the Sales Leader
   View are still PageStubs, and a surface whose whole point is a short,
   useful sidebar should not be padded with placeholders. Add them here when
   they are real.

   This list is the only thing to edit to change what the lite deployment
   shows — the sidebar, the route guard and the landing page all follow it.
   Names are `view` keys from lib/nav.ts. */
const LITE_VIEWS = ["reporting", "forecast", "le"];

/** null means "every view in NAV". */
const VIEWS: Record<SurfaceKey, readonly string[] | null> = {
  full: null,
  lite: LITE_VIEWS,
};

export const SURFACE: SurfaceKey =
  process.env.NEXT_PUBLIC_SURFACE === "lite" ? "lite" : "full";

function allowed(s: SurfaceKey): ReadonlySet<string> | null {
  const list = VIEWS[s];
  return list ? new Set(list) : null;
}

/** Is `view` one this surface shows? Unknown views are left to Next's 404. */
export function isViewAllowed(view: string, s: SurfaceKey = SURFACE): boolean {
  const set = allowed(s);
  return !set || set.has(view);
}

/** NAV with hidden views removed, and any group thereby emptied dropped. */
export function navFor(s: SurfaceKey = SURFACE): NavGroup[] {
  const set = allowed(s);
  if (!set) return NAV;
  return NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => set.has(i.view)) }))
    .filter((g) => g.items.length > 0);
}

/** Where this surface sends someone who hasn't asked for a particular view. */
export function homeFor(s: SurfaceKey = SURFACE): string {
  return navFor(s)[0]?.items[0]?.view ?? "reporting";
}

/* `path` if this surface shows it, otherwise the surface's own home. Keeps a
   hardcoded destination honest without changing it on the full surface. */
export function surfacePath(path: string, s: SurfaceKey = SURFACE): string {
  const view = path.replace(/^\/+/, "").split(/[/?#]/)[0];
  return isViewAllowed(view, s) ? path : `/${homeFor(s)}`;
}

/* True only for a path this surface deliberately hides — a known view that
   isn't in its list. Anything unknown returns false and 404s as usual. */
export function isHiddenView(view: string, s: SurfaceKey = SURFACE): boolean {
  return !!navItemFor(view) && !isViewAllowed(view, s);
}
