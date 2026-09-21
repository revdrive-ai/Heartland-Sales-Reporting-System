import LoginForm from "@/components/auth/LoginForm";

/* The sign-in page. It renders outside the app shell — no sidebar, no scope
   bar — because none of that is available until there is a session. */

export const metadata = { title: "Sign in — Heartland Trade Platform" };

const ERRORS: Record<string, string> = {
  domain: "That account isn't on an allowed email domain, so it was signed out.",
  unconfigured: "Sign-in isn't configured on this deployment yet. Contact the administrator.",
  expired: "Your session expired. Sign in again.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; e?: string }>;
}) {
  const sp = await searchParams;
  /* Only ever return to a path on this site. Backslashes are rejected too:
     browsers normalise "/\evil.com" to "//evil.com", which is protocol-
     relative and would leave the site. */
  const raw = sp.next ?? "";
  const next =
    raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/base";
  return <LoginForm next={next} initialError={sp.e ? ERRORS[sp.e] : undefined} />;
}
