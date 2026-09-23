/* The estimate's promotion changes, per customer × in-flight year.

   The Telus book is the record of what was booked, and it is never edited
   here. The Latest Estimate lays its own view over it: a booked promotion
   can be CANCELLED (it will not run — no lift, no spend from the edge on),
   CHANGED (a new window, a new expected lift, a new spend), or a promotion
   the book does not have can be ADDED. The forecast and the trade line both
   read the book through this overlay, so "book vs estimate" is always
   there to show.

   Only windows still to run can be touched: a promotion that has ended
   before the NIQ edge is in the actuals already, and changing it would
   change nothing — the page says so and leaves it read-only.

   Neutral module: the browser writes it through lib/repo/client, the server
   reads it in lib/server/fyForecast, lib/server/leRollup and modeStatus. */

export type LeOverlayChange = {
  start?: string;
  end?: string;
  spend?: number;
  /** expected % lift over base; null = let the forecast read it from history */
  lift_pct?: number | null;
  note?: string;
  at: string;
};

export type LeAddedEvent = {
  id: string;
  brand: string;        // NIQ brand name (SPLENDA, SLIMFAST, JAVA HOUSE)
  title: string;
  perf: string;         // performance type
  start: string;
  end: string;
  spend: number;
  lift_pct: number | null;
  note: string;
  at: string;
};

export type LeOverlay = {
  cancelled: Record<string, { at: string; note: string }>;  // by Telus promo_id
  changes: Record<string, LeOverlayChange>;                  // by Telus promo_id
  added: LeAddedEvent[];
};

export const LE_OVERLAY_EMPTY: LeOverlay = { cancelled: {}, changes: {}, added: [] };

export function readLeOverlay(raw: unknown): LeOverlay {
  if (!raw || typeof raw !== "object") return LE_OVERLAY_EMPTY;
  const r = raw as Partial<LeOverlay>;
  const cancelled: LeOverlay["cancelled"] = {};
  for (const [k, v] of Object.entries(r.cancelled ?? {})) {
    if (v && typeof v === "object") cancelled[k] = { at: String((v as { at?: string }).at ?? ""), note: String((v as { note?: string }).note ?? "") };
  }
  const changes: LeOverlay["changes"] = {};
  for (const [k, v] of Object.entries(r.changes ?? {})) {
    if (!v || typeof v !== "object") continue;
    const c = v as Partial<LeOverlayChange>;
    changes[k] = {
      ...(typeof c.start === "string" ? { start: c.start } : {}),
      ...(typeof c.end === "string" ? { end: c.end } : {}),
      ...(typeof c.spend === "number" ? { spend: c.spend } : {}),
      ...(c.lift_pct === null || typeof c.lift_pct === "number" ? { lift_pct: c.lift_pct } : {}),
      ...(typeof c.note === "string" ? { note: c.note } : {}),
      at: String(c.at ?? ""),
    };
  }
  const added: LeAddedEvent[] = Array.isArray(r.added)
    ? r.added.filter((a): a is LeAddedEvent => !!a && typeof a === "object" && typeof (a as LeAddedEvent).id === "string" && typeof (a as LeAddedEvent).start === "string")
      .map((a) => ({
        id: a.id, brand: String(a.brand ?? ""), title: String(a.title ?? ""), perf: String(a.perf ?? ""),
        start: a.start, end: String(a.end ?? a.start), spend: +a.spend || 0,
        lift_pct: a.lift_pct === null || a.lift_pct === undefined ? null : +a.lift_pct, note: String(a.note ?? ""), at: String(a.at ?? ""),
      }))
    : [];
  return { cancelled, changes, added };
}

/** How many promotions the estimate has changed, cancelled or added. */
export function overlayCount(o: LeOverlay): number {
  return Object.keys(o.cancelled).length + Object.keys(o.changes).length + o.added.length;
}
