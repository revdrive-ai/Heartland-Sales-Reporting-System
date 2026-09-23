import { getPriceList, getPromoOverlays, listItems, listWeekEndings, priceAsOf, type PriceRow } from "@/lib/repo";
import { fyWeeklyByItem } from "@/lib/server/fyForecast";
import { getSnapshots, type PlanSnapshotVersion } from "@/lib/server/planSnapshot";
import { getState } from "@/lib/server/appstate";
import { overlayCount, readLeOverlay } from "@/lib/leovl";

/* The Latest Estimate's roll-up for ONE account × in-flight year — the four
   numbers the estimate is worked in (units, gross sales at list, trade
   spend, margin after trade), each by month, against three yardsticks:

     plan     the year's plan. For this demo it is last year's NIQ units
              plus 1.5%, month by month, priced at this year's list price.
     LY       last year's NIQ actuals on the aligned weeks (364 days back).
     last LE  the version most recently locked for this account.

   "This year" is measured actuals through the NIQ edge, then the forecast
   (lib/server/fyForecast: last year's shape at this year's run-rate × the
   expected lift of each promotion window, with the LE's base adjustments
   and promotion changes applied). Gross is units × the list price in force
   that week; where an item has no list price it adds nothing to gross.

   Trade is the account's Telus book for the year — planned dollars spread
   across each promotion's days — since Telus actuals lag too far to use.
   There is no FY2025 book on file, so trade and margin have no LY.

   Margin here is AFTER TRADE — gross sales less trade spend. There is no
   product cost in the data yet. */

export const PLAN_GROWTH = 0.015;

const DAY = 86400000;
const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
const yearAgoWeek = (w: string) => new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);
const zero = () => Array(12).fill(0) as number[];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Spread a promotion's dollars evenly over its days, clipped to the year. */
export function spreadByMonth(into: number[], amount: number, startISO: string, endISO: string, year: number) {
  if (!amount) return;
  const s = Math.max(utcOf(startISO), Date.UTC(year, 0, 1));
  const e = Math.min(utcOf(endISO), Date.UTC(year, 11, 31));
  if (e < s) return;
  const perDay = amount / ((e - s) / DAY + 1);
  for (let t = s; t <= e; t += DAY) into[new Date(t).getUTCMonth()] += perDay;
}

export type Monthly = number[]; // 12 calendar months

export type BrandRoll = {
  actU: Monthly; fcU: Monthly; lyU: Monthly; planU: Monthly;
  act$: Monthly; fc$: Monthly; ly$: Monthly; plan$: Monthly;
};

export type LeRollup = {
  year: number;
  priorYear: number;
  edge: string;            // the NIQ data edge (last measured week)
  edgeMonth: number;       // 0-11: the month the edge falls in
  edgeComplete: boolean;   // every week of that month is measured
  brands: Record<string, BrandRoll>;
  totals: BrandRoll;       // all Heartland brands
  trade: { book: Monthly; est: Monthly; bookTotal: number; estTotal: number };
  /** year to date: the measured weeks, and last year on the same weeks */
  ytd: { units: number; gross: number; lyUnits: number; lyGross: number };
  brandYtd: Record<string, { units: number; lyUnits: number }>;
  lastLE: null | {
    label: string; cycle: string | null; takenAt: string;
    units: Monthly; total: number;
    gross: number | null; trade: number | null;   // stored from the money the version froze, when it did
  };
  planGrowth: number;
  promoChanges: number;    // promotions cancelled, changed or added by the estimate
};

/** The full-year figure: actuals to date plus the estimate to go. */
export const fy = (b: BrandRoll) => ({
  units: sum(b.actU) + sum(b.fcU),
  gross: sum(b.act$) + sum(b.fc$),
  lyUnits: sum(b.lyU), lyGross: sum(b.ly$),
  planUnits: sum(b.planU), planGross: sum(b.plan$),
});

export async function leRollup(mkt: string, year: number): Promise<LeRollup> {
  const [items, allWeeks, prices, versions] = await Promise.all([
    listItems(), listWeekEndings(mkt), getPriceList(), getSnapshots(mkt, year),
  ]);
  const latest = allWeeks[allWeeks.length - 1];
  const fyWeeks = saturdaysOfYear(year);
  const brands = [...new Set(items.filter((i) => i.is_own).map((i) => i.brand))].sort();

  // the list price in force for an item on a date — cached per item × week.
  // The price list starts with this year's prices, so a week before its
  // first record (all of last year) takes that first record: LY gross is
  // then last year's units at the same list, which is the like-for-like
  // read the year-on-year comparison wants.
  const priceCache = new Map<string, number>();
  const earliest = new Map<string, number>();
  for (const r of prices as PriceRow[]) {
    if (!r.upc || r.unit_price == null) continue;
    const cur = earliest.get(r.upc);
    if (cur === undefined || r.effective_from < (prices as PriceRow[]).find((x) => x.upc === r.upc && x.unit_price === cur)!.effective_from) earliest.set(r.upc, r.unit_price);
  }
  const priceOn = (upc: string, w: string) => {
    const k = `${upc}|${w}`;
    const hit = priceCache.get(k);
    if (hit !== undefined) return hit;
    const p = priceAsOf(prices as PriceRow[], w, { upc })?.unit_price ?? earliest.get(upc) ?? 0;
    priceCache.set(k, p);
    return p;
  };

  const blank = (): BrandRoll => ({ actU: zero(), fcU: zero(), lyU: zero(), planU: zero(), act$: zero(), fc$: zero(), ly$: zero(), plan$: zero() });
  const out: Record<string, BrandRoll> = {};
  const totals = blank();
  const ytd = { units: 0, gross: 0, lyUnits: 0, lyGross: 0 };
  const brandYtd: LeRollup["brandYtd"] = {};

  for (const brand of brands) {
    const byItem = await fyWeeklyByItem(mkt, brand, fyWeeks, allWeeks, latest);
    if (!byItem.size) continue;
    const b = blank();
    const by = { units: 0, lyUnits: 0 };
    for (const [upc, series] of byItem) {
      for (const s of series) {
        const m = +s.w.slice(5, 7) - 1;
        const price = priceOn(upc, s.w);
        const lyPrice = priceOn(upc, yearAgoWeek(s.w));
        if (s.measured) { b.actU[m] += s.tyU; b.act$[m] += s.tyU * price; }
        else { b.fcU[m] += s.tyU; b.fc$[m] += s.tyU * price; }
        b.lyU[m] += s.priorU; b.ly$[m] += s.priorU * lyPrice;
        // the plan: last year's units up 1.5%, at this year's price
        b.planU[m] += s.priorU * (1 + PLAN_GROWTH); b.plan$[m] += s.priorU * (1 + PLAN_GROWTH) * price;
        if (s.measured) { ytd.units += s.tyU; ytd.gross += s.tyU * price; ytd.lyUnits += s.priorU; ytd.lyGross += s.priorU * lyPrice; }
        if (s.measured) { by.units += s.tyU; by.lyUnits += s.priorU; }
      }
    }
    out[brand] = b;
    brandYtd[brand] = by;
    (Object.keys(b) as (keyof BrandRoll)[]).forEach((k) => b[k].forEach((v, i) => { totals[k][i] += v; }));
  }

  // trade: the Telus book for this account, spread over each promotion's
  // days. Corporate (all-Albertsons) promotions lift every division's volume
  // but their dollars are booked once, at corporate — counting them here
  // would book them thirteen times over, so the money stays the account's own.
  const book = zero(), est = zero();
  const ovl = readLeOverlay(await getState(`leovl:${mkt}:${year}`).catch(() => undefined));
  for (const o of await getPromoOverlays({ market_code: mkt, from: `${year}-01-01`, to: `${year}-12-31` })) {
    if (o.corporate) continue;
    spreadByMonth(book, o.planned_amount, o.start_date, o.end_date, year);
    /* The estimate's view of the same dollars: a cancelled promotion keeps
       only what it spent up to the edge; a changed one spends its new amount
       over its new window. */
    if (ovl.cancelled[o.promo_id]) {
      // the days already run keep their share of the dollars; the rest is not spent
      const days = (utcOf(o.end_date) - utcOf(o.start_date)) / DAY + 1;
      const ran = Math.max(0, Math.min(days, (utcOf(latest) - utcOf(o.start_date)) / DAY + 1));
      if (ran > 0) spreadByMonth(est, o.planned_amount * (ran / days), o.start_date, latest < o.end_date ? latest : o.end_date, year);
      continue;
    }
    const c = ovl.changes[o.promo_id];
    spreadByMonth(est, c?.spend ?? o.planned_amount, c?.start ?? o.start_date, c?.end ?? o.end_date, year);
  }
  for (const a of ovl.added) spreadByMonth(est, a.spend, a.start, a.end, year);

  const edgeMonth = +latest.slice(5, 7) - 1;
  const monthWeeks = fyWeeks.filter((w) => +w.slice(5, 7) - 1 === edgeMonth);
  const edgeComplete = monthWeeks.length > 0 && monthWeeks.every((w) => w <= latest);

  const last: PlanSnapshotVersion | undefined = versions[versions.length - 1];
  const lastLE = last
    ? {
        label: last.label, cycle: last.cycle ?? null, takenAt: last.taken_at,
        units: Object.values(last.byBrand).reduce((acc, v) => { v.adjusted.forEach((x, i) => { acc[i] += x; }); return acc; }, zero()),
        total: last.totals.adjusted,
        gross: last.money?.gross ?? null,
        trade: last.money?.trade ?? null,
      }
    : null;

  return {
    year, priorYear: year - 1, edge: latest, edgeMonth, edgeComplete,
    brands: out, totals,
    trade: { book, est, bookTotal: sum(book), estTotal: sum(est) },
    promoChanges: overlayCount(ovl),
    ytd, brandYtd, lastLE, planGrowth: PLAN_GROWTH,
  };
}
