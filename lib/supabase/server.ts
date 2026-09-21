import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicEnv } from "./env";
import { isAllowedEmail } from "@/lib/auth/domain";

/* Server-side Supabase, reading the session from cookies. Server components
   may not write cookies, so the setAll handler is a no-op there — the
   middleware is what refreshes them on each request. */
export async function supabaseServer() {
  const env = supabasePublicEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // called from a server component — the middleware already refreshed
        }
      },
    },
  });
}

export type SessionUser = { id: string; email: string };

/** The signed-in user, but only when the address still passes the domain
    rule — an account that somehow exists outside it is treated as signed
    out everywhere. */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email || !isAllowedEmail(data.user.email)) return null;
  return { id: data.user.id, email: data.user.email };
}
