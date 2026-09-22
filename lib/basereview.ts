/* The Base Business Review's own completion record, per customer × plan year.

   Reviewing the base used to leave no trace, so the step could never tick.
   Now the review card on that screen reads back what the two steps before
   it recorded and what has been done to the base, and is submitted from
   there. The record carries a summary of what was reviewed — how many
   items were taken out and added, how many levers, and the plan base before
   and after them — so the card can say when the plan has moved since.

   Neutral module: the browser writes it through lib/repo/client, the server
   reads it in lib/server/modeStatus and the review page. */

export type BaseReviewSummary = {
  out: number;          // items marked No volume
  added: number;        // new items
  adjustments: number;  // levers on the base
  base: number;         // plan base, all Heartland brands, units
  adjusted: number;     // …after the levers and the new items
};

export type BaseReview = {
  verified_at: string | null;
  summary?: BaseReviewSummary;
};

export const BASE_REVIEW_EMPTY: BaseReview = { verified_at: null };

export function readBaseReview(raw: unknown): BaseReview {
  if (!raw || typeof raw !== "object") return BASE_REVIEW_EMPTY;
  const r = raw as Partial<BaseReview>;
  const s = r.summary;
  return {
    verified_at: typeof r.verified_at === "string" ? r.verified_at : null,
    ...(s && typeof s === "object"
      ? { summary: { out: +s.out || 0, added: +s.added || 0, adjustments: +s.adjustments || 0, base: +s.base || 0, adjusted: +s.adjusted || 0 } }
      : {}),
  };
}
