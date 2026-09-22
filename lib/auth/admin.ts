/* Who sees the full tool.

   Admin is a role, not a separate build: the same deployment serves the
   account person a front door with no sidebar and the admin the whole map.

   For this demo there is exactly one admin, so the list is a constant. The
   moment there are two, this should become a `public.app_admins` table in
   the shape of `public.signup_email_domains` (migration 00013), so adding
   someone is one SQL insert rather than a deploy. Nothing else needs to
   change — every caller already goes through isAdminEmail. */

const ADMINS = ["randy@revdrive.ai"];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMINS.includes(email.trim().toLowerCase());
}
