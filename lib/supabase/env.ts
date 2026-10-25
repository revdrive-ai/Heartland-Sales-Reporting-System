/* The Supabase connection — the ONE place the app reads it from the
   environment. Three variables, nothing else, and no project URL or key
   anywhere in code:

     NEXT_PUBLIC_SUPABASE_URL        the project URL (one variable for auth
                                     AND data, so they can never point at two
                                     different projects)
     NEXT_PUBLIC_SUPABASE_ANON_KEY   the public/anon key — safe in the
                                     browser; RLS lets it read nothing
     SUPABASE_SERVICE_ROLE_KEY       server-side only — bypasses RLS. Read by
                                     route handlers and server modules only,
                                     never by anything a browser bundle imports.

   Which project the app talks to is therefore entirely a deployment setting
   (.env.local in dev, project environment variables on the host). */

const trimUrl = (u: string) => u.replace(/\/+$/, "");

/** The public connection (URL + anon key), or null when auth isn't configured. */
export function supabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: trimUrl(url), anonKey };
}

/** Same, but throws where a caller cannot proceed without it. */
export function requireSupabasePublicEnv(): { url: string; anonKey: string } {
  const env = supabasePublicEnv();
  if (!env) {
    throw new Error(
      "Supabase auth is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return env;
}

/** The service-role connection (URL + service key) for server code, or null
    when the deployment has no Supabase data backend. Import only from
    server-only modules and route handlers. */
export function supabaseServiceEnv(): { url: string; serviceKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: trimUrl(url), serviceKey };
}

/** Headers PostgREST wants for a service-role request. */
export function serviceHeaders(serviceKey: string): Record<string, string> {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}
