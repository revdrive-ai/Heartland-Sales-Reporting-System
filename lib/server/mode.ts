import { cookies, headers } from "next/headers";
import { listMarkets, listWeekEndings } from "@/lib/repo";
import { MODE_COOKIE, MODE_HEADER, parseModeCookie, resolveMode, type WorkMode } from "@/lib/mode";

/** The NIQ data-edge year across the divisions on file — the year LE mode
    works on. Cached for the process; the data changes with a deploy. */
let edgeYearCache: number | null = null;
export async function getDataEdgeYear(): Promise<number> {
  if (edgeYearCache) return edgeYearCache;
  let latest = "";
  for (const m of await listMarkets()) {
    const w = await listWeekEndings(m.code);
    const last = w[w.length - 1];
    if (last && last > latest) latest = last;
  }
  edgeYearCache = latest ? +latest.slice(0, 4) : new Date().getUTCFullYear();
  return edgeYearCache;
}

/** Read the working mode (server side). Every workflow page calls this and
    derives its year from the result.

    A process URL names its mode, so the middleware puts it on the request
    header when it rewrites /work/... onto the underlying view; that wins over
    the cookie, which may still hold whatever the last visit chose. Outside a
    process there is no header and the cookie is the answer.

    Neither is a trust boundary and neither needs to be: the mode picks which
    year a page renders, nothing more, and hh-mode is written from the browser
    anyway (writeModeCookie). A forged header buys exactly what a forged
    cookie buys, which is a different year on a page you could already open.
    Who may open which page is decided in middleware.ts, not here. */
export async function getMode(): Promise<WorkMode> {
  let raw: string | undefined;
  try { raw = (await headers()).get(MODE_HEADER) ?? undefined; } catch {}
  if (!raw) {
    try { raw = (await cookies()).get(MODE_COOKIE)?.value; } catch {}
  }
  return resolveMode(parseModeCookie(raw), await getDataEdgeYear());
}
