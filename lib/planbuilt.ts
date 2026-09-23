/* Build the plan's own completion record, per customer × plan year.

   Building the plan leaves events behind but had no finish line, so the
   step could never tick. Now it is submitted from the events card — the
   button at the end of the row with + New event — which records when, how
   many events the plan held and the plan's money at the time, and moves on
   to Review & submit. Submitting again restamps it.

   Neutral module: the browser writes it through lib/repo/client, the server
   reads it in lib/server/modeStatus and the review page. */

/** The plan's money, as Build the plan showed it when it was submitted —
    the numbers its Trade spend and Gross sales cards are built from, which
    need the whole planner (volumes, dated list prices, repricing) and so are
    frozen here for Review & submit to read rather than recomputed there. */
export type PlanTotals = {
  gross: number;        // plan gross sales: base + each event's lift, at the dated list price
  grossPrior: number;   // the source year's gross sales (measured + LE) at list price
  grossTarget: number;  // the gross sales target on the planner (default prior + 2%)
  spend: number;        // trade committed by the plan's events
  spendPrior: number;   // the source year's booked (Telus planned) trade
  fund: number;         // the trade fund set on the planner
  priorYear: number;    // which year "prior" is
  sig: string;          // fingerprint of the events the numbers were taken from
};

export type PlanBuilt = {
  built_at: string | null;
  events?: number;      // events on this account's plan when it was submitted
  totals?: PlanTotals;
};

/** A fingerprint of an account's events — which ones, their windows and
    lifts — so the review can tell when the plan has moved since the totals
    were taken. Order-free. */
export function planSig(events: { id: string; start: string; end: string; lift_pct: number | null; spend: number }[]): string {
  const src = events.map((e) => `${e.id}|${e.start}|${e.end}|${e.lift_pct ?? ""}|${Math.round(e.spend)}`).sort().join(";");
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return `${events.length}:${h.toString(36)}`;
}

export const PLAN_BUILT_EMPTY: PlanBuilt = { built_at: null };

export function readPlanBuilt(raw: unknown): PlanBuilt {
  if (!raw || typeof raw !== "object") return PLAN_BUILT_EMPTY;
  const r = raw as Partial<PlanBuilt>;
  const t = r.totals;
  return {
    built_at: typeof r.built_at === "string" ? r.built_at : null,
    ...(r.events != null ? { events: +r.events || 0 } : {}),
    ...(t && typeof t === "object"
      ? { totals: {
          gross: +t.gross || 0, grossPrior: +t.grossPrior || 0, grossTarget: +t.grossTarget || 0,
          spend: +t.spend || 0, spendPrior: +t.spendPrior || 0, fund: +t.fund || 0,
          priorYear: +t.priorYear || 0, sig: typeof t.sig === "string" ? t.sig : "",
        } }
      : {}),
  };
}
