import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { isAllowedEmail } from "@/lib/auth/domain";

/* Every request passes through here. It refreshes the Supabase session
   cookies and decides whether the request may proceed at all.

   Open without a session:
     /login and /api/auth/*   — the sign-in flow itself
     /api/cron/*              — the scheduled LE lock, which authenticates
                                with CRON_SECRET rather than a user session
     static assets
   Everything else — every page, and every other API route — requires a
   signed-in user whose address is on the allowed domain. */

const OPEN_PREFIXES = ["/login", "/api/auth", "/api/cron", "/auth/signout"];

const isOpen = (p: string) => OPEN_PREFIXES.some((o) => p === o || p.startsWith(o + "/"));

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
    // already signed in and landing on the login page — go to the app
    if (allowed && pathname === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/base";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return res;
  }

  if (!allowed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // come back to where they were headed once signed in
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // everything except Next's own assets and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
