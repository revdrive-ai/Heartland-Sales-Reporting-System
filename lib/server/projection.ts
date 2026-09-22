/* The rest-of-year projection: last year's shape at this year's run-rate.

   A source year that has not finished landing has to be projected to its
   end before a plan can be built on it. The projection used to be the
   latest-52-week average base shaped by a monthly seasonality index. For a
   brand that is stable that is fine; for a brand that has moved inside the
   window it is stale by construction — the average still carries the weeks
   from before the move, so a brand that has halved projects at something
   like its old level, and the seam between measured and projected reads as
   a cliff.

   Now: each unmeasured week takes the aligned week from the last year that
   IS fully measured — two years back (728 days) for a forward plan year
   whose source year is still landing, one year back (364 days) for the
   in-flight year itself — and scales it by how this year is running against
   last year over the latest TREND_WEEKS measured weeks. Last year's shape,
   this year's level.

   The ratio is each item's own where the item is big enough to read — an
   item that stopped selling in March projects at nothing for the autumn,
   which a brand-wide ratio would not do — and the brand's where it is not:
   an item with little or no year-ago volume (launched since, or a sliver of
   the brand) takes the brand's ratio rather than a ratio of two small
   numbers.

   An item that was not on file for the whole of the shape year (launched
   since) has no shape to carry — a launch ramp is not a season — so it
   takes its own run-rate over the latest TREND_WEEKS weeks, seasonally
   adjusted, shaped by the brand's month index; the index itself is built
   from items that still sell. An item with no volume in the latest 52 weeks
   projects at nothing: it is not on the shelf.

   Every place a base is projected — the plan base in the Base Business
   Review, the planner, the frozen snapshot and the export, and the in-flight
   year's forecast in the Monthly Forecast Review, the Sales Dashboard's FY
   mode and the LE — projects through here, so they agree to the unit. */

export const TREND_WEEKS = 13;
const DAY = 86400000;

export const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
/** The aligned week `days` back (364 keeps Saturdays aligned; 728 is two years). */
export const alignedWeek = (w: string, days = 364) => new Date(utcOf(w) - days * DAY).toISOString().slice(0, 10);

export type Trend = { ratio: number; cur: number; prior: number };

/** The latest TREND_WEEKS measured weeks against the same weeks a year
    earlier, on a weekly series. ratio is 1 when there is no year-ago volume
    to compare against. */
export function trendOf(weekly: Map<string, number> | undefined, measuredWeeks: string[], n = TREND_WEEKS): Trend {
  const recent = measuredWeeks.slice(-n);
  let cur = 0, prior = 0;
  for (const w of recent) {
    cur += weekly?.get(w) ?? 0;
    prior += weekly?.get(alignedWeek(w)) ?? 0;
  }
  return { ratio: prior > 0 ? cur / prior : 1, cur, prior };
}

/** The brand's trend ratio — the level the projection runs at where an item
    cannot be read on its own. */
export const trendRatio = (weekly: Map<string, number>, measuredWeeks: string[], n = TREND_WEEKS) =>
  trendOf(weekly, measuredWeeks, n).ratio;

/** An item's own ratio when its year-ago volume is at least this share of
    the brand's — enough to read — else the brand's. */
const OWN_RATIO_MIN_SHARE = 0.05;
export function itemRatio(im: Map<string, number> | undefined, measuredWeeks: string[], brand: Trend): number {
  const t = trendOf(im, measuredWeeks);
  return t.prior > 0 && t.prior >= OWN_RATIO_MIN_SHARE * brand.prior ? t.ratio : brand.ratio;
}

/** One item's value in a source-year week that has not been measured yet. */
export function projectItemWeek(o: {
  im: Map<string, number> | undefined;  // the item's weekly series
  w: string;                            // the plan-year week
  firstWeek: string | undefined;        // the item's first week on file
  ratio: number;                        // the item's trend ratio (its own, or the brand's)
  a52: number;                          // the item's latest-52-week average
  engine: (number | null)[];            // the brand's month index (live items); null = no weeks for that month
  measuredWeeks: string[];              // every measured week at the division, ascending
  /** which fully-measured year carries the shape: 2 for a forward plan
      year (its source year is still landing), 1 for the in-flight year */
  shapeYearsBack?: 1 | 2;
}): number {
  if (!o.im) return 0;
  const month = (wk: string) => +wk.slice(5, 7) - 1;
  const back = o.shapeYearsBack ?? 2;
  /* Shape: the same week `back` years ago, if the item was on file from the
     start of that year — a whole year of shape, not a ramp. */
  const shapeYearStart = `${+o.w.slice(0, 4) - back}-01-07`;
  if (o.firstWeek !== undefined && o.firstWeek <= shapeYearStart) {
    return Math.max(0, (o.im.get(alignedWeek(o.w, 364 * back)) ?? 0) * o.ratio);
  }
  /* No shape of its own: this year's run-rate — the latest TREND_WEEKS weeks,
     de-seasonalised against the index of those same months — put through
     the brand's index. A newer item that has gone quiet in those weeks falls
     back to its 52-week average, so a seasonal item is not written off for
     one quiet quarter. */
  let sum = 0, idx = 0;
  for (const rw of o.measuredWeeks.slice(-TREND_WEEKS)) {
    sum += o.im.get(rw) ?? 0;
    idx += o.engine[month(rw)] ?? 1;
  }
  const level = sum > 0 && idx > 0 ? sum / idx : o.a52;
  return Math.max(0, level * (o.engine[month(o.w)] ?? 1));
}
