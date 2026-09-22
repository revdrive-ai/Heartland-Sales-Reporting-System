import { cookies } from "next/headers";
import { getMode } from "@/lib/server/mode";
import { currentUser } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/auth/admin";
import { PROC_COOKIE, parseProcCookie } from "@/lib/process";
import FrontDoor from "@/components/start/FrontDoor";

/* The front door. Everyone lands here — the middleware sends them, and it is
   where sign-in ends up. */

export const metadata = { title: "Heartland Trade Platform" };

export default async function Page() {
  const [mode, user, jar] = await Promise.all([getMode(), currentUser(), cookies()]);
  return (
    <FrontDoor
      mode={mode}
      admin={isAdminEmail(user?.email)}
      resume={parseProcCookie(jar.get(PROC_COOKIE)?.value)}
    />
  );
}
