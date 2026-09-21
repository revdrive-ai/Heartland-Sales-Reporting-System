import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabasePublicEnv } from "@/lib/supabase/env";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from "@/lib/auth/domain";

/* Request a sign-in code.

   The domain is checked HERE, before Supabase is asked to send anything, so
   the platform never emails an address outside the company. That is a
   courtesy rather than the lock: the anon key is public, so someone could
   call Supabase directly. The lock is the before-user-created hook in
   supabase/migrations/00013_auth_domain_lock.sql, which refuses to create
   the account, and the middleware, which refuses to serve a session whose
   address is off-domain. */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const env = supabasePublicEnv();
  if (!env) {
    return NextResponse.json(
      { error: "Sign-in is not configured on this deployment." },
      { status: 503 }
    );
  }

  let email = "";
  try {
    const body = (await req.json()) as { email?: string };
    email = (body.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
  }

  if (!isAllowedEmail(email)) {
    return NextResponse.json(
      { error: `Sign-in is limited to @${ALLOWED_EMAIL_DOMAIN} email addresses.` },
      { status: 403 }
    );
  }

  const supabase = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  let message: string | null = null;
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    message = error?.message ?? null;
  } catch (e) {
    message = e instanceof Error ? e.message : "unknown";
  }
  if (message) {
    /* Pass through the messages a person can act on — rate limits, and the
       refusal the signup hook raises — and replace anything else (transport
       failures, JSON parse errors) with something that isn't internals. */
    const actionable = /rate limit|only request this after|seconds|not allowed|disabled|approved company/i.test(message);
    return NextResponse.json(
      { error: actionable ? message.slice(0, 200) : "Could not send the code just now. Try again in a moment." },
      { status: 502 }
    );
  }
  return NextResponse.json({ sent: true }, { headers: { "cache-control": "no-store" } });
}
