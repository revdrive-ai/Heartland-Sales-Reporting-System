import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { isAllowedEmail } from "@/lib/auth/domain";
import { isAdminEmail } from "@/lib/auth/admin";
import { navItemFor } from "@/lib/nav";
import { MODE_COOKIE, MODE_HEADER, serializeModePref, type ModePref } from "@/lib/mode";
import { parseWorkPath, processPath, WORK_PREFIX } from "@/lib/process";

/* Every request passes through here. It refreshes the Supabase session
   cookies, decides whether the request may proceed at all, and turns a
   process URL into the view that renders it.

   Open without a session:
     /login and /api/auth/*   — the sign-in flow itself
     /api/cron/*              — the scheduled LE lock, which authenticates
                                with CRON_SECRET rather than a user session
     static assets
   Everything else — every page, and every other API route — requires a
   signed-in user whose address is on the allowed domain.

   Then, for a signed-in user:
     /work/...   a process step. Rewritten onto the existing view that
                 renders it, keeping the pretty URL in the browser.
     /base, /planner, …   the raw views: the full map, admins only.
     /start      the front door, everyone. */

const OPEN_PREFIXES = ["/login", "/api/auth", "/api/cron", "/auth/signout"];

const isOpen = (p: string) => OPEN_PREFIXES.some((o) => p === o || p.startsWith(o + "/"));

const toStart = (req: NextRequest) => {
  const url = req.nextUrl.clone();
  url.pathname = "/start";
  url.search = "";
  return NextResponse.redirect(url);
};

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  let res = NextResponse.next({ request: req });

  const env = supabasePublicEnv();
  if (!env) {
    /* Auth isn't configured. Fail CLOSED for everything except the login
       page, which explains the problem, so a half-configured deployment is
       never an open one. */
    if (isOpen(pathname)) return res;
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?e=unconfigured";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });

  // getUser() revalidates against Supabase — never trust the cookie alone
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? null;
  const allowed = isAllowedEmail(email);

  if (data.user && !allowed) {
    // an account outside the domain: end the session rather than serve it
    await supabase.auth.signOut();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?e=domain";
    return NextResponse.redirect(url);
  }

  if (isOpen(pathname)) {
    // already signed in and landing on the login page — go to the front door
    if (allowed && pathname === "/login") return toStart(req);
    return res;
  }

  if (!allowed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // come back to where they were headed once signed in
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  /* A process step. The browser keeps /work/plan/2027/distribution; the
     server renders /base with the distribution modal opened. Rewriting
     rather than redirecting means no route duplication and no second copy
     of the six hundred lines of data assembly in app/base/page.tsx. */
  if (pathname === WORK_PREFIX || pathname.startsWith(WORK_PREFIX + "/")) {
    const loc = parseWorkPath(pathname);
    if (!loc) return toStart(req);
    // /work/plan/2027 with no step named: send it to the canonical first step
    // so every step of a process has exactly one URL
    if (!loc.explicit) {
      const url = req.nextUrl.clone();
      url.pathname = processPath(loc.proc.kind, loc.step.key, loc.year);
      return NextResponse.redirect(url);
    }

    const pref: ModePref = { kind: loc.proc.kind, planYear: loc.year };
    const mode = serializeModePref(pref);

    const dest = req.nextUrl.clone();
    dest.pathname = `/${loc.step.view}`;
    if (loc.step.open) dest.searchParams.set("hhopen", loc.step.open);

    /* The URL names the mode, and the page rendering THIS request has to see
       it — a cookie set now would only be read on the next one. */
    const headers = new Headers(req.headers);
    headers.set(MODE_HEADER, mode);

    const out = NextResponse.rewrite(dest, { request: { headers } });
    // carry over anything Supabase refreshed while we were checking the user
    for (const c of res.cookies.getAll()) out.cookies.set(c);
    // and leave the mode behind, so the next plain navigation agrees
    out.cookies.set(MODE_COOKIE, mode, { path: "/", maxAge: 31536000, sameSite: "lax" });
    return out;
  }

  /* The raw views are the whole map — admins only. An account person who
     types /base or follows an old bookmark goes to the front door; the same
     screen reached as a process step rewrites above and is unaffected. */
  const view = pathname.split("/")[1] ?? "";
  if (navItemFor(view) && !isAdminEmail(email)) return toStart(req);

  return res;
}

export const config = {
  // everything except Next's own assets and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
