/* The NIQ week calendar, in one place.

   Weeks end on Saturday. A year holds the Saturdays that fall inside it —
   52 most years, 53 when the year starts on a Saturday (or on a Friday in a
   leap year): 2022, 2028, 2033, 2039. Nothing here numbers weeks; every
   week is its Saturday's date, so a 53-week year simply has one more row.

   "A year ago" is the same Saturday 364 days back — the same weekday, the
   same position in the year — which is how retail calendars restate the
   year after a 53-week year (its week 1 reads against the old week 2, and
   so on). The one week that has no year-ago partner is the 53rd itself:
   364 days back lands on the same year's week 1, so comparableYearAgo()
   says null there and a comparison leaves it out. */

export const DAY = 86400000;
export const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The same weekday 364 days earlier — the year-ago week for every purpose. */
export const yearAgoWeek = (w: string) => iso(utcOf(w) - 364 * DAY);
/** The same weekday 364 days later. */
export const yearAheadWeek = (w: string) => iso(utcOf(w) + 364 * DAY);

/** The year-ago week when it lies in the prior year; null for a 53rd week,
    which has no partner and should be left out of any year-on-year read. */
export function comparableYearAgo(w: string): string | null {
  const ya = yearAgoWeek(w);
  return ya.slice(0, 4) < w.slice(0, 4) ? ya : null;
}

/** The prior-year week that stands in for w when last year's SHAPE is
    carried forward: the same weekday 364 days back, or, for a 53rd week,
    the prior year's final week (371 days back) — a week has to come from
    somewhere, and the year's last week is the nearest like-for-like.
    `years` steps back that many years the same way. */
export function priorYearWeek(w: string, years = 1): string {
  let out = w;
  for (let i = 0; i < years; i++) out = comparableYearAgo(out) ?? iso(utcOf(out) - 371 * DAY);
  return out;
}

/** Every week-ending Saturday of a calendar year, in order. */
export function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) out.push(iso(t));
  return out;
}

export const weeksInYear = (year: number) => saturdaysOfYear(year).length;
export const is53WeekYear = (year: number) => weeksInYear(year) === 53;
