import { cookies } from "next/headers";
import { resolveScope, SCOPE_COOKIE, type ResolvedScope, type Scope } from "@/lib/scope";

/** Read the global customer scope from the hh-scope cookie (server side).
    Every data page calls this and intersects its reads with the result. */
export async function getScope(): Promise<ResolvedScope> {
  let s: Scope = {};
  try {
    const raw = (await cookies()).get(SCOPE_COOKIE)?.value;
    if (raw) s = JSON.parse(decodeURIComponent(raw)) as Scope;
  } catch {}
  return resolveScope(s);
}
