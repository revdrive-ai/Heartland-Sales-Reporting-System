"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabasePublicEnv } from "./env";

/* The browser Supabase client. Verifying the emailed code through this
   client is what writes the session cookies that the middleware and every
   server component then read. */
export function supabaseBrowser() {
  const { url, anonKey } = requireSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
