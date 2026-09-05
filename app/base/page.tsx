import { getPriceList, getPromoOverlays, getWeeklyFacts, listItems, listMarkets, listWeekEndings } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import ScopeEmpty from "@/components/ScopeEmpty";
import BaseView, { type BaseData, type WeekPoint } from "@/components/base/BaseView";
import type { NielsenWeeklyRow } from "@/lib/types/db";

/* Base & Lift Lab — the Nielsen weekly trend (actual vs NIQ base) for one
   division × brand (or a single item), with the Telus promotion windows
   overlaid and the seasonality-index card beside the chart. Timeframes:
   rolling windows (4/13/26/52 weeks, year-to-date) or a total calendar year —
   including future years, which render as a planning view until their NIQ
   weeks land. Controls travel in the URL. */

const OWN_BRANDS = ["SPLENDA", "SLIMFAST", "JAVA HOUSE"]; // NIQ brands with own-side data
const MONTH_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const ROLLING: Record<string, number> = { "4w": 4, "13w": 13, "26w": 26, "52w": 52 };
const FIRST_PLAN_YEAR = 2024;
const DAY = 86400000;

/** Every NIQ week-ending (Saturday) of a calendar year. */
function saturdaysOfYear(year: number): string[] {
  const out: string[] = [];
  let t = Date.UTC(year, 0, 1);
  while (new Date(t).getUTCDay() !== 6) t += DAY;
  for (; new Date(t).getUTCFullYear() === year; t += 7 * DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mkt?: string; brand?: string; item?: string; metric?: string; win?: string }>;
}) {
  const sp = await searchParams;
  const [allMarkets, gscope, allItems] = await Promise.all([listMarkets(), getScope(), listItems()]);
  const markets = gscope.active ? allMarkets.filter((m) => gscope.marketCodes.includes(m.code)) : allMarkets;
  if (gscope.active && markets.length === 0) {
    return (
      <ScopeEmpty current="base" crumb="Trade Workflow · Step 1" title="Base & Lift Lab"
        label={gscope.label}
        message="No Nielsen trading areas in this scope have data on file — only the 13 ALBSCO divisions are loaded so far." />
    );
  }
  const mkt = markets.some((m) => m.code === sp.mkt) ? sp.mkt!
    : markets.some((m) => m.code === "ALB-JEWEL") ? "ALB-JEWEL" : markets[0].code;
  const brand = OWN_BRANDS.includes(sp.brand ?? "") ? sp.brand! : "SPLENDA";
  // units | dollars (NIQ retail) | gross (units × the dated list price in force)
  const metric = sp.metric === "dollars" ? "dollars" : sp.metric === "gross" ? "gross" : "units";

  // dated list-price lookup per UPC, for the gross metric and the change markers
  const priceRows = await getPriceList();
  const priceHist = new Map<string, { d: string; p: number }[]>();
  for (const r of priceRows) {
    if (!r.upc || r.unit_price === null) continue;
    (priceHist.get(r.upc) ?? priceHist.set(r.upc, []).get(r.upc)!).push({ d: r.effective_from, p: r.unit_price });
  }
  for (const l of priceHist.values()) l.sort((a, b) => a.d.localeCompare(b.d));
  const priceAt = (upc: string, onDate: string): number | null => {
    const l = priceHist.get(upc);
    if (!l) return null;
    let p: number | null = null;
    for (const e of l) { if (e.d > onDate) break; p = e.p; }
    return p;
  };
  // row values in the chosen metric — gross counts only priced items
  const aVal = (r: NielsenWeeklyRow) =>
    metric === "units" ? (r.units ?? 0)
    : metric === "dollars" ? (r.dollars ?? 0)
    : (r.units ?? 0) * (priceAt(r.upc, r.week_ending) ?? 0);
  const bVal = (r: NielsenWeeklyRow) =>
    metric === "units" ? (r.base_units ?? r.units ?? 0)
    : metric === "dollars" ? (r.base_dollars ?? r.dollars ?? 0)
    : (r.base_units ?? r.units ?? 0) * (priceAt(r.upc, r.week_ending) ?? 0);

  const allWeeks = await listWeekEndings(mkt);
  const latestWeek = allWeeks[allWeeks.length - 1];
  const latestDataYear = +latestWeek.slice(0, 4);
  const currentYear = new Date().getUTCFullYear();

  // Total-year choices run 2024 → two years past today, in perpetuity.
  const years: number[] = [];
  for (let y = FIRST_PLAN_YEAR; y <= Math.max(latestDataYear, currentYear) + 2; y++) years.push(y);

  // Timeframe: rolling (4w/13w/26w/52w), year-to-date, or a total year.
  const rawWin = sp.win ?? "52w";
  const win = ROLLING[rawWin] || rawWin === "ytd" || (/^\d{4}$/.test(rawWin) && years.includes(+rawWin))
    ? rawWin : "52w";

  let weeks: string[];
  let winLabel: string;
  let planningYear = false;
  if (ROLLING[win]) {
    weeks = allWeeks.slice(-ROLLING[win]);
    winLabel = `Latest ${ROLLING[win]} weeks`;
  } else if (win === "ytd") {
    weeks = allWeeks.filter((w) => w.startsWith(String(latestDataYear)));
    winLabel = `Year to date (${latestDataYear})`;
  } else {
    const y = +win;
    weeks = allWeeks.filter((w) => w.startsWith(win));
    winLabel = `Total year ${y}`;
    if (weeks.length === 0) {
      weeks = saturdaysOfYear(y); // future year — the expected NIQ week axis
      planningYear = true;
    }
  }
  const from = weeks[0];
  const to = weeks[weeks.length - 1];

  // Every week on file for this division × brand — drives the item list and
  // the seasonality card (which always uses full history, not the window).
  const factsAll = await getWeeklyFacts({ market_code: mkt, brand });
  // Item picker: only items that actually moved volume in the latest 52 weeks
  // at this division × brand — dead/delisted items drop out of the list.
  const recentFrom = allWeeks[Math.max(allWeeks.length - 52, 0)];
  const upcsWithVolume = new Set(
    factsAll.filter((r) => r.week_ending >= recentFrom && (r.units ?? 0) > 0).map((r) => r.upc)
  );
  const items = allItems
    .filter((i) => i.brand === brand && upcsWithVolume.has(i.upc))
    .map((i) => ({ upc: i.upc, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const item = items.some((i) => i.upc === sp.item) ? sp.item! : "ALL";
  const itemName = item === "ALL" ? null : items.find((i) => i.upc === item)!.name;

  const scoped = factsAll.filter((r) => item === "ALL" || r.upc === item);
  const facts = planningYear ? [] : scoped.filter((r) => r.week_ending >= from && r.week_ending <= to);

  // full-history weekly actuals for the selection — feeds the year-ago overlay
  const weekActual = new Map<string, number>();
  for (const r of scoped) {
    weekActual.set(r.week_ending, (weekActual.get(r.week_ending) ?? 0) + aVal(r));
  }
  const yearAgoWeek = (w: string) =>
    new Date(Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10)) - 364 * DAY).toISOString().slice(0, 10);

  // aggregate the selection per week (trend chart)
  const byWeek = new Map<string, WeekPoint>();
  for (const w of weeks) {
    const ly = weekActual.get(yearAgoWeek(w));
    byWeek.set(w, { week: w, actual: planningYear ? null : 0, base: planningYear ? null : 0, actualLY: ly === undefined ? null : Math.round(ly), promoAcv: 0 });
  }
  for (const r of facts) {
    const p = byWeek.get(r.week_ending);
    if (!p) continue;
    p.actual = (p.actual ?? 0) + aVal(r);
    p.base = (p.base ?? 0) + bVal(r);
    p.promoAcv = Math.max(p.promoAcv, r.acv_any_promo ?? 0);
  }
  const points = weeks.map((w) => {
    const p = byWeek.get(w)!;
    return {
      ...p,
      actual: p.actual === null ? null : Math.round(p.actual),
      base: p.base === null ? null : Math.round(p.base),
      promoAcv: Math.round(p.promoAcv * 10) / 10,
    };
  });

  /* Seasonality index over the full history: monthly average weekly base
     units (the promo-stripped series) against the all-weeks average — the
     "engine" curve — plus each year's own actuals-derived index. */
  const weekBase = new Map<string, number>();
  for (const r of scoped) {
    const v = (r.base_units ?? r.units ?? 0);
    weekBase.set(r.week_ending, (weekBase.get(r.week_ending) ?? 0) + v);
  }
  const monthTot = Array(12).fill(0), monthN = Array(12).fill(0);
  const yearly = new Map<number, { tot: number[]; n: number[] }>();
  for (const [w, v] of weekBase) {
    const m = +w.slice(5, 7) - 1;
    const y = +w.slice(0, 4);
    monthTot[m] += v; monthN[m] += 1;
    const yr = yearly.get(y) ?? { tot: Array(12).fill(0), n: Array(12).fill(0) };
    yr.tot[m] += v; yr.n[m] += 1;
    yearly.set(y, yr);
  }
  const grandAvg = [...weekBase.values()].reduce((a, v) => a + v, 0) / Math.max(weekBase.size, 1);
  const idx = (tot: number[], n: number[], avg: number) =>
    tot.map((t, m) => (n[m] > 0 && avg > 0 ? +(t / n[m] / avg).toFixed(3) : null));
  const engine = idx(monthTot, monthN, grandAvg);
  const seasonYears = [...yearly.entries()]
    .filter(([, v]) => v.n.filter((x) => x > 0).length >= 6) // skip heavily partial years
    .sort(([a], [b]) => a - b)
    .map(([y, v]) => {
      const wks = v.n.reduce((a, x) => a + x, 0);
      const avg = v.tot.reduce((a, x) => a + x, 0) / Math.max(wks, 1);
      return { label: String(y), values: idx(v.tot, v.n, avg) };
    });

  /* Plan-year series: for a future year, carry the actual NIQ base from the
     matching weeks a year earlier (364 days — Saturdays stay aligned) as far
     as that source year has actualized, and project the remaining weeks as
     the latest-52-week average base shaped by the seasonality engine. */
  let plan: BaseData["plan"] = null;
  if (planningYear) {
    const weekBaseM = new Map<string, number>(); // weekly base in the chosen metric
    for (const r of scoped) {
      weekBaseM.set(r.week_ending, (weekBaseM.get(r.week_ending) ?? 0) + bVal(r));
    }
    const last52 = allWeeks.slice(-52);
    const avgBase = last52.reduce((a, w) => a + (weekBaseM.get(w) ?? 0), 0) / Math.max(last52.length, 1);
    const actualized: (number | null)[] = [];
    const projected: (number | null)[] = [];
    let nAct = 0;
    for (const w of weeks) {
      const src = yearAgoWeek(w);
      if (src <= latestWeek) {
        actualized.push(Math.round(weekBaseM.get(src) ?? 0));
        projected.push(null);
        nAct++;
      } else {
        actualized.push(null);
        projected.push(Math.round(avgBase * (engine[+w.slice(5, 7) - 1] ?? 1)));
      }
    }
    // Each item's share of the brand base over the latest 52 weeks — the
    // weight an item-level planner adjustment carries in the all-items view.
    const last52Set = new Set(last52);
    const shareTot = new Map<string, number>();
    let shareSum = 0;
    for (const r of factsAll) {
      if (!last52Set.has(r.week_ending)) continue;
      const v = bVal(r);
      shareTot.set(r.upc, (shareTot.get(r.upc) ?? 0) + v);
      shareSum += v;
    }
    const itemShare: Record<string, number> = {};
    for (const [u, v] of shareTot) itemShare[u] = shareSum > 0 ? +(v / shareSum).toFixed(4) : 0;

    plan = {
      sourceYear: +win - 1,
      actualized,
      projected,
      actualizedWeeks: nAct,
      totActualized: actualized.reduce((a: number, v) => a + (v ?? 0), 0),
      totProjected: projected.reduce((a: number, v) => a + (v ?? 0), 0),
      itemShare,
    };
  }

  /* Dated list-price changes touching this selection inside the window — a
     record counts as a change only when an earlier record exists for the same
     item, so the initial list seeding doesn't mark every chart. */
  const selUpcs = new Set(item === "ALL" ? items.map((i) => i.upc) : [item]);
  const seenFg = new Set<string>();
  const priceMarks: { date: string; label: string }[] = [];
  for (const r of priceRows) { // sorted fg → effective_from
    const isChange = seenFg.has(r.fg);
    seenFg.add(r.fg);
    if (!isChange || !r.upc || !selUpcs.has(r.upc)) continue;
    if (r.effective_from < from || r.effective_from > to) continue;
    priceMarks.push({
      date: r.effective_from,
      label: `${r.item.length > 22 ? r.item.slice(0, 21) + "…" : r.item}${r.unit_price !== null ? ` $${r.unit_price.toFixed(2)}` : ""}`,
    });
  }

  const overlays = await getPromoOverlays({ market_code: mkt, brand, from, to });

  /* Lift per promotion window, in the chosen metric.
     Actual lift: (actual − NIQ base) / base summed over the window's weeks on
     file. Predicted lift: the same measure over the matching weeks a year
     earlier — what this window "should" do based on last year — falling back
     to the selection's all-history promoted-week lift (weeks where NIQ saw
     ≥ 10 %ACV promo support) when there is no year-ago data. */
  const utcOf = (w: string) => Date.UTC(+w.slice(0, 4), +w.slice(5, 7) - 1, +w.slice(8, 10));
  const weekBaseFull = new Map<string, number>(); // full-history base, chosen metric
  for (const r of scoped) {
    weekBaseFull.set(r.week_ending, (weekBaseFull.get(r.week_ending) ?? 0) + bVal(r));
  }
  const promoWeeks = new Set<string>();
  for (const r of scoped) if ((r.acv_any_promo ?? 0) >= 10) promoWeeks.add(r.week_ending);
  let pA = 0, pB = 0;
  for (const w of promoWeeks) { pA += weekActual.get(w) ?? 0; pB += weekBaseFull.get(w) ?? 0; }
  const fallbackLift = pB > 0 ? (pA - pB) / pB : null;

  const liftOver = (sISO: string, eISO: string) => {
    const s = utcOf(sISO), e = utcOf(eISO);
    let a = 0, b = 0, n = 0;
    for (const w of allWeeks) {
      const wt = utcOf(w); // a week-ending Saturday covers the 7 days ending that day
      if (s <= wt && e >= wt - 6 * DAY) { a += weekActual.get(w) ?? 0; b += weekBaseFull.get(w) ?? 0; n++; }
    }
    return { lift: n > 0 && b > 0 ? (a - b) / b : null, weeks: n };
  };
  const overlayRows = overlays.map((o) => {
    const act = liftOver(o.start_date, o.end_date);
    const pred = liftOver(yearAgoWeek(o.start_date), yearAgoWeek(o.end_date));
    return {
      ...o,
      pred_lift: pred.lift ?? fallbackLift,
      pred_fallback: pred.lift === null,
      actual_lift: act.lift,
      lift_partial: utcOf(o.end_date) > utcOf(latestWeek),
    };
  });

  /* Lift engine — depth vs unit lift across the selection's promoted weeks,
     full history. Depth and lift are measured per week from the feed:
     depth = 1 − (promoted price ÷ base price), lift = units ÷ base units − 1,
     both unit-based regardless of the chart metric. Each week is classified
     by its dominant merch tactic from the ACV breakouts, so the tactic
     multipliers are measured (β_tactic ÷ β) wherever ≥ 3 reads exist. */
  type EngWk = { u: number; bu: number; d$: number; bd$: number; acv: number; f: number; disp: number; fd: number; tpr: number };
  const engWk = new Map<string, EngWk>();
  for (const r of scoped) {
    const w = engWk.get(r.week_ending) ?? { u: 0, bu: 0, d$: 0, bd$: 0, acv: 0, f: 0, disp: 0, fd: 0, tpr: 0 };
    w.u += r.units ?? 0; w.bu += r.base_units ?? 0;
    w.d$ += r.dollars ?? 0; w.bd$ += r.base_dollars ?? 0;
    w.acv = Math.max(w.acv, r.acv_any_promo ?? 0);
    w.f = Math.max(w.f, r.acv_feature ?? 0);
    w.disp = Math.max(w.disp, r.acv_display ?? 0);
    w.fd = Math.max(w.fd, r.acv_feat_disp ?? 0);
    w.tpr = Math.max(w.tpr, r.acv_tpr ?? 0);
    engWk.set(r.week_ending, w);
  }
  const engPts: { week: string; d: number; l: number; tactic: string }[] = [];
  for (const [week, w] of engWk) {
    if (w.acv < 10 || w.bu <= 0 || w.u <= 0 || w.bd$ <= 0 || w.d$ <= 0) continue;
    const depth = (1 - (w.d$ / w.u) / (w.bd$ / w.bu)) * 100;
    const lift = (w.u / w.bu - 1) * 100;
    if (depth < 1 || depth > 70 || lift < -60) continue; // noise guards
    const cand: [string, number][] = [["Feature + Display", w.fd], ["Display", w.disp], ["Feature", w.f], ["TPR", w.tpr]];
    cand.sort((a, b) => b[1] - a[1]);
    engPts.push({ week, d: +depth.toFixed(1), l: +lift.toFixed(1), tactic: cand[0][1] >= 5 ? cand[0][0] : "Unclassified" });
  }
  let liftEngine: BaseData["liftEngine"] = null;
  if (engPts.length >= 3) {
    // regression through the origin: lift(%) = β × depth(%)
    const fit = (arr: typeof engPts) => {
      let xy = 0, xx = 0, yy = 0;
      for (const p of arr) { xy += p.d * p.l; xx += p.d * p.d; yy += p.l * p.l; }
      const b = xx > 0 ? xy / xx : 0;
      let ss = 0;
      for (const p of arr) ss += (p.l - b * p.d) ** 2;
      return { b, r2: yy > 0 ? Math.max(0, 1 - ss / yy) : 0 };
    };
    const all = fit(engPts);
    const DEFAULT_M: Record<string, number> = { TPR: 0.7, Feature: 1.0, Display: 1.3, "Feature + Display": 1.8 };
    const tactics = (["TPR", "Feature", "Display", "Feature + Display"] as const).map((t) => {
      const g = engPts.filter((p) => p.tactic === t);
      if (g.length >= 3 && all.b > 0) {
        return { name: t, m: +(fit(g).b / all.b).toFixed(2), n: g.length, measured: true };
      }
      return { name: t, m: DEFAULT_M[t], n: g.length, measured: false };
    });
    liftEngine = {
      points: engPts.sort((a, b) => a.d - b.d),
      beta: +all.b.toFixed(1),
      r2: +all.r2.toFixed(2),
      n: engPts.length,
      tactics,
    };
  }

  /* Key insights — measured shifts in the selection that should move the
     plan: per-item distribution and base-price changes (latest 8 weeks vs the
     same weeks a year ago), likely delistings, promo-support swings, dated
     list-price changes, and residual base-volume breaks. Ranked by how much
     weekly base volume each one moves. */
  type Insight = {
    kind: "distribution" | "price" | "volume" | "promo" | "delisted" | "listprice";
    severity: "good" | "bad" | "info";
    title: string;
    detail: string;
    impact: number; // |Δ weekly base units| — the ranking key
  };
  const weekAcv = new Map<string, number>(); // week → max %ACV promo (selection)
  for (const r of scoped) {
    weekAcv.set(r.week_ending, Math.max(weekAcv.get(r.week_ending) ?? 0, r.acv_any_promo ?? 0));
  }
  const insights: Insight[] = [];
  {
    const recent8 = new Set(allWeeks.slice(-8));
    const recent6 = new Set(allWeeks.slice(-6));
    const ya8 = new Set([...recent8].map(yearAgoWeek));
    const itemNameOf = new Map(allItems.map((i) => [i.upc, i.name]));
    const short = (u: string) => {
      const n = itemNameOf.get(u) ?? u;
      return n.length > 42 ? n.slice(0, 41) + "…" : n;
    };
    type S = { bu: number; u: number; bd: number; acvN: number; acvSum: number };
    const mk = (): S => ({ bu: 0, u: 0, bd: 0, acvN: 0, acvSum: 0 });
    const cur = new Map<string, S>(), prior = new Map<string, S>();
    let recent6Units = new Map<string, number>();
    for (const r of scoped) {
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
    const edge = utcOf(latestWeek);
    const seenFg2 = new Set<string>();
    for (const r of priceRows) {
      const change = seenFg2.has(r.fg);
      seenFg2.add(r.fg);
      if (!change || !r.upc || !selUpcs.has(r.upc)) continue;
      if (Math.abs(utcOf(r.effective_from) - edge) > 90 * DAY) continue;
      insights.push({
        kind: "listprice", severity: "info", impact: brandWk * 0.4,
        title: `List price change on ${short(r.upc)} effective ${r.effective_from}`,
        detail: `${r.unit_price !== null ? `New unit list price $${r.unit_price.toFixed(2)}. ` : ""}The gross-dollars view bends at this date — watch base volume on both sides to read the response, and check the plan's price assumption.`,
      });
    }
    insights.sort((a, b) => b.impact - a.impact);
  }

  const totActual = points.reduce((a, p) => a + (p.actual ?? 0), 0);
  const totBase = points.reduce((a, p) => a + (p.base ?? 0), 0);

  /* Year-over-year for the KPI cards: the selected window's weeks against the
     same weeks a year earlier (364 days keeps Saturdays aligned), compared
     over the weeks that have year-ago data on file so partial-history windows
     stay like-for-like. */
  let yoy: BaseData["yoy"] = null;
  if (!planningYear) {
    let curA = 0, lyA = 0, curB = 0, lyB = 0, curPW = 0, lyPW = 0, matched = 0;
    for (const w of weeks) {
      const ya = yearAgoWeek(w);
      if (!weekActual.has(ya) && !weekBaseFull.has(ya)) continue;
      matched++;
      curA += weekActual.get(w) ?? 0; lyA += weekActual.get(ya) ?? 0;
      curB += weekBaseFull.get(w) ?? 0; lyB += weekBaseFull.get(ya) ?? 0;
      if ((weekAcv.get(w) ?? 0) >= 10) curPW++;
      if ((weekAcv.get(ya) ?? 0) >= 10) lyPW++;
    }
    const pctOf = (c: number, l: number) => (l > 0 ? ((c - l) / l) * 100 : null);
    yoy = {
      actual: pctOf(curA, lyA),
      base: pctOf(curB, lyB),
      incremental: lyA - lyB > 0 ? ((curA - curB - (lyA - lyB)) / (lyA - lyB)) * 100 : null,
      promoWeeks: pctOf(curPW, lyPW),
      matchedWeeks: matched,
      totalWeeks: weeks.length,
    };
  }

  const data: BaseData = {
    markets: markets.map((m) => ({ code: m.code, name: m.name })),
    brands: OWN_BRANDS,
    items,
    mkt,
    brand,
    item,
    itemName,
    metric,
    win,
    winLabel,
    years,
    latestDataYear,
    planningYear,
    plan,
    points,
    overlays: overlayRows,
    priceMarks,
    grossCoverage: metric === "gross"
      ? (item === "ALL"
          ? { priced: items.filter((i) => priceHist.has(i.upc)).length, total: items.length }
          : { priced: priceHist.has(item) ? 1 : 0, total: 1 })
      : null,
    season: { labels: MONTH_LABELS, engine, years: seasonYears },
    totals: {
      actual: totActual,
      base: totBase,
      incremental: totActual - totBase,
      niqPromoWeeks: points.filter((p) => p.promoAcv >= 10).length,
    },
    yoy,
    liftEngine,
    insights: insights.slice(0, 6),
    insightsTotal: insights.length,
  };

  return <BaseView data={data} />;
}
