/* The global working mode — the one decision a user makes about WHICH year
   they are working, made once in the top bar and honored by every workflow
   tab. It replaces the year/window choices that used to sit on each page.

     analyze  measured history: rolling windows, prior total years
     le       the in-flight (NIQ data-edge) year — actuals + forecast, the
              monthly Latest Estimates
     plan     a forward year — the plan builder, distribution verification,
              Plan of Record sign-off

   The preference persists in the hh-mode cookie (like the customer scope in
   hh-scope) so server-rendered pages open in the right year on first paint. */

export type ModeKind = "analyze" | "le" | "plan";

export type ModePref = { kind: ModeKind; planYear?: number };

export type WorkMode = {
  kind: ModeKind;
  leYear: number;       // the data-edge year
  planYear: number;     // the forward year plan mode works on
  planYears: number[];  // forward years on offer (data edge + 1, + 2)
};

export const MODE_COOKIE = "hh-mode";

/* A process URL (/work/plan/2027/...) names its own mode, and that has to
   reach the page rendering this very request — a cookie set now would only
   be read on the next one. The middleware therefore sets this request header
   on the rewrite and getMode() prefers it over the cookie. */
export const MODE_HEADER = "x-hh-mode";

/** Query keys the mode decides — dropped from the URL when the mode changes
    so a stale ?win= or ?yr= can't fight the top bar. */
export const MODE_PARAMS = ["win", "yr"];

export function resolveMode(pref: ModePref | null | undefined, dataEdgeYear: number): WorkMode {
  const planYears = [dataEdgeYear + 1, dataEdgeYear + 2];
  const kind: ModeKind = pref?.kind === "le" || pref?.kind === "plan" ? pref.kind : "analyze";
  const planYear = pref?.planYear && planYears.includes(pref.planYear) ? pref.planYear : planYears[0];
  return { kind, leYear: dataEdgeYear, planYear, planYears };
}

export function parseModeCookie(raw: string | undefined): ModePref | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<ModePref>;
    if (v.kind !== "analyze" && v.kind !== "le" && v.kind !== "plan") return null;
    return { kind: v.kind, planYear: typeof v.planYear === "number" ? v.planYear : undefined };
  } catch {
    return null;
  }
}

export function modeLabel(m: WorkMode): string {
  return m.kind === "le" ? `LE — FY${m.leYear}` : m.kind === "plan" ? `Plan — FY${m.planYear}` : "Analyze";
}

export function serializeModePref(pref: ModePref): string {
  return encodeURIComponent(JSON.stringify(pref));
}

/** Client side: persist the preference (the server reads it on the next render). */
export function writeModeCookie(pref: ModePref) {
  try {
    document.cookie = `${MODE_COOKIE}=${serializeModePref(pref)}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}
