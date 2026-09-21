/* The public Supabase connection. Both values are safe in the browser: the
   anon key is meant to be published and carries no privileges beyond what
   RLS allows. The service-role key is never referenced here — it stays in
   lib/server/appstate.ts, server-side only. */

export function supabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
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
