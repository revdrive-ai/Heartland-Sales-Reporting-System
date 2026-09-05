import type { NielsenWeeklyRow } from "@/lib/types/db";
import type { PriceRow } from "@/lib/repo";

/* Key-insight detection — measured shifts in a selection of NIQ weekly rows
   that should move a plan: per-item distribution and base-price changes
   (latest 8 weeks vs the same weeks a year ago), likely delistings,
   promo-support swings, dated list-price changes near the data edge, and
   residual base-volume breaks. Shared by the Base & Lift Lab and the Sales
   Dashboard; ranked by how much weekly base volume each shift moves. */

const DAY = 86400000;
const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
const yearAgoWeek = (w: string) => new Date(utcOf(w) - 364 * DAY).toISOString().slice(0, 10);

export type Insight = {
  kind: "distribution" | "price" | "volume" | "promo" | "delisted" | "listprice";
  severity: "good" | "bad" | "info";
  title: string;
  detail: string;
  impact: number; // |Δ weekly base units| — the ranking key
};

export function detectInsights(opts: {
  rows: NielsenWeeklyRow[];        // the selection — must cover the latest 8 weeks and their year-ago weeks
  allWeeks: string[];              // the full NIQ week axis
  latestWeek: string;
  itemName: (upc: string) => string;
  priceRows?: PriceRow[];          // dated list prices, for list-price flags
  selUpcs?: Set<string>;           // limit list-price flags to these items
}): Insight[] {
  const { rows, allWeeks, latestWeek, itemName, priceRows, selUpcs } = opts;
  const insights: Insight[] = [];

  const recent8 = new Set(allWeeks.slice(-8));
  const recent6 = new Set(allWeeks.slice(-6));
  const ya8 = new Set([...recent8].map(yearAgoWeek));
  const short = (u: string) => {
    const n = itemName(u);
    return n.length > 42 ? n.slice(0, 41) + "…" : n;
  };

  type S = { bu: number; u: number; bd: number; acvN: number; acvSum: number };
  const mk = (): S => ({ bu: 0, u: 0, bd: 0, acvN: 0, acvSum: 0 });
  const cur = new Map<string, S>(), prior = new Map<string, S>();
  const recent6Units = new Map<string, number>();
  const weekAcv = new Map<string, number>(); // week → max %ACV promo across the selection
  for (const r of rows) {
    weekAcv.set(r.week_ending, Math.max(weekAcv.get(r.week_ending) ?? 0, r.acv_any_promo ?? 0));
    const side = recent8.has(r.week_ending) ? cur : ya8.has(r.week_ending) ? prior : null;
    if (recent6.has(r.week_ending)) recent6Units.set(r.upc, (recent6Units.get(r.upc) ?? 0) + (r.units ?? 0));
    if (!side) continue;
    const s = side.get(r.upc) ?? mk();
    s.bu += r.base_units ?? 0; s.u += r.units ?? 0; s.bd += r.base_dollars ?? 0;
    if (r.acv_dist !== null) { s.acvSum += r.acv_dist; s.acvN += 1; }
    side.set(r.upc, s);
  }
  const brandWk = [...cur.values()].reduce((a, s) => a + s.bu, 0) / 8;

  const upcs = new Set([...cur.keys(), ...prior.keys()]);
  for (const u of upcs) {
    const c = cur.get(u) ?? mk(), p = prior.get(u) ?? mk();
    const cw = c.bu / 8, pw = p.bu / 8;                      // weekly base units now vs YA
    if (Math.max(cw, pw) < Math.max(brandWk * 0.02, 25)) continue; // immaterial items stay quiet
    const impact = Math.abs(cw - pw);
    const basePct = pw > 0 ? ((cw - pw) / pw) * 100 : null;
    const cAcv = c.acvN ? c.acvSum / c.acvN : null, pAcv = p.acvN ? p.acvSum / p.acvN : null;
    const cPrice = c.bu > 0 ? c.bd / c.bu : null, pPrice = p.bu > 0 ? p.bd / p.bu : null;
    const pricePct = cPrice !== null && pPrice !== null && pPrice > 0 ? ((cPrice - pPrice) / pPrice) * 100 : null;

    // likely delisted: real volume a year ago, none measured in 6 weeks
    if (pw >= 30 && (recent6Units.get(u) ?? 0) === 0) {
      insights.push({
        kind: "delisted", severity: "bad", impact: pw,
        title: `${short(u)} looks delisted`,
        detail: `No measured volume in the last 6 weeks against ~${Math.round(pw)} base units/wk a year ago. If it's gone for good, take it out of the plan — a distribution adjustment of −100% on this item in the plan view.`,
      });
      continue;
    }
    let explained = false;
    if (cAcv !== null && pAcv !== null && Math.abs(cAcv - pAcv) >= 10) {
      const down = cAcv < pAcv;
      insights.push({
        kind: "distribution", severity: down ? "bad" : "good", impact,
        title: `Distribution ${down ? "dropped" : "gained"} on ${short(u)}`,
        detail: `%ACV ${down ? "fell" : "rose"} ${Math.round(pAcv)} → ${Math.round(cAcv)} (latest 8 wks vs same wks YA); base is running ${basePct === null ? "n/a" : `${basePct >= 0 ? "+" : ""}${basePct.toFixed(0)}%`} vs YA. The plan projection carries this run-rate forward — ${down ? "volume stays down unless distribution recovers; consider a distribution adjustment" : "the gain is already in the forward base"}.`,
      });
      explained = true;
    }
    if (pricePct !== null && Math.abs(pricePct) >= 3) {
      const up = pricePct > 0;
      insights.push({
        kind: "price", severity: basePct !== null && basePct < -5 ? "bad" : "info", impact,
        title: `Base price ${up ? "up" : "down"} ${Math.abs(pricePct).toFixed(0)}% on ${short(u)}`,
        detail: `Measured base price moved $${pPrice!.toFixed(2)} → $${cPrice!.toFixed(2)} (latest 8 wks vs YA)${basePct === null ? "" : `, with base volume ${basePct >= 0 ? "+" : ""}${basePct.toFixed(0)}% over the same comparison`}. ${up && basePct !== null && basePct < -5 ? "The volume response is showing — check the elasticity assumption in the plan." : "Watch whether base volume holds at the new price."}`,
      });
      explained = true;
    }
    if (!explained && basePct !== null && Math.abs(basePct) >= 20) {
      insights.push({
        kind: "volume", severity: basePct < 0 ? "bad" : "good", impact,
        title: `Base volume ${basePct < 0 ? "down" : "up"} ${Math.abs(basePct).toFixed(0)}% on ${short(u)}`,
        detail: `~${Math.round(pw)} → ~${Math.round(cw)} base units/wk (latest 8 wks vs same wks YA) with no distribution or price move to explain it. The projection inherits this level — a trend adjustment in the plan view corrects it if you know better.`,
      });
    }
  }

  // promo support swing on the whole selection (last 13 wks vs YA)
  const last13 = allWeeks.slice(-13);
  const pwNow = last13.filter((w) => (weekAcv.get(w) ?? 0) >= 10).length;
  const pwYA = last13.map(yearAgoWeek).filter((w) => (weekAcv.get(w) ?? 0) >= 10).length;
  if (Math.abs(pwNow - pwYA) >= 4) {
    insights.push({
      kind: "promo", severity: pwNow < pwYA ? "bad" : "good", impact: brandWk * 0.5,
      title: `Promo support ${pwNow < pwYA ? "down" : "up"}: ${pwNow} promoted weeks in the last 13 vs ${pwYA} a year ago`,
      detail: pwNow < pwYA
        ? "NIQ is seeing less shelf support than last year — actuals will trail year-ago promoted periods until the event calendar refills. Check the promotion book for this window."
        : "More measured shelf support than last year — expect actuals to run ahead of base in these weeks.",
    });
  }

  // dated list-price changes near the data edge (±90 days)
  if (priceRows && selUpcs) {
    const edge = utcOf(latestWeek);
    const seenFg = new Set<string>();
    for (const r of priceRows) {
      const change = seenFg.has(r.fg);
      seenFg.add(r.fg);
      if (!change || !r.upc || !selUpcs.has(r.upc)) continue;
      if (Math.abs(utcOf(r.effective_from) - edge) > 90 * DAY) continue;
      insights.push({
        kind: "listprice", severity: "info", impact: brandWk * 0.4,
        title: `List price change on ${short(r.upc)} effective ${r.effective_from}`,
        detail: `${r.unit_price !== null ? `New unit list price $${r.unit_price.toFixed(2)}. ` : ""}The gross-dollars view bends at this date — watch base volume on both sides to read the response, and check the plan's price assumption.`,
      });
    }
  }

  return insights.sort((a, b) => b.impact - a.impact);
}
