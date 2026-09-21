/* Who may sign in.

   Access is limited to one email domain. This constant is the single place
   that decides it — the login form, the OTP request route, the middleware
   and the Supabase signup hook all read the same rule, so there is no way to
   widen access in one layer and forget another. */

export const ALLOWED_EMAIL_DOMAIN = "revdrive.ai";

/** The domain part of an address, lowercased; "" when it isn't an address. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** Whether this address is allowed to sign in at all. */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  // a single @, something before it, and exactly the allowed domain after
  return /^[^@\s]+@[^@\s]+$/.test(e) && domainOf(e) === ALLOWED_EMAIL_DOMAIN;
}
