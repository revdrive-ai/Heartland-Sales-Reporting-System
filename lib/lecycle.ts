/* The estimate's monthly answer, per customer × year.

   A Latest Estimate is taken every month against the same in-flight year, so
   "did anything move this month" is not one answer for the year — it is a new
   answer each cycle. The doc is keyed customer × year like the rest of the
   planner's work and holds one entry per cycle, which is what lets next
   month's step ask again rather than read as already done.

   Neutral by design: the browser writes it through lib/repo/client and the
   server reads it in lib/server/modeStatus, so the shape lives somewhere
   neither of them owns. */

export type LeAnswer =
  /** nothing moved — the forecast on record still stands */
  | "none"
  /** they are working the cycle: the planner is theirs for the rest of it */
  | "adjusting";

export type LeCycleDoc = { answers: Record<string, { answer: LeAnswer; at: string }> };

export const LE_CYCLE_EMPTY: LeCycleDoc = { answers: {} };

export function readLeCycle(raw: unknown): LeCycleDoc {
  if (!raw || typeof raw !== "object") return LE_CYCLE_EMPTY;
  const a = (raw as Partial<LeCycleDoc>).answers;
  if (!a || typeof a !== "object") return LE_CYCLE_EMPTY;
  const out: LeCycleDoc["answers"] = {};
  for (const [k, v] of Object.entries(a)) {
    if (v && typeof v === "object" && ((v as { answer?: string }).answer === "none" || (v as { answer?: string }).answer === "adjusting")) {
      out[k] = { answer: (v as { answer: LeAnswer }).answer, at: String((v as { at?: string }).at ?? "") };
    }
  }
  return { answers: out };
}

/** This cycle's answer, or null when the month has not been answered yet. */
export function leAnswerFor(doc: LeCycleDoc, cycle: string): LeAnswer | null {
  return doc.answers[cycle]?.answer ?? null;
}
