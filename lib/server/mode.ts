import { cookies } from "next/headers";
import { listMarkets, listWeekEndings } from "@/lib/repo";
import { MODE_COOKIE, parseModeCookie, resolveMode, type WorkMode } from "@/lib/mode";

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

/** Read the working mode from the hh-mode cookie (server side). Every
    workflow page calls this and derives its year from the result. */
export async function getMode(): Promise<WorkMode> {
  let raw: string | undefined;
  try { raw = (await cookies()).get(MODE_COOKIE)?.value; } catch {}
  return resolveMode(parseModeCookie(raw), await getDataEdgeYear());
}
