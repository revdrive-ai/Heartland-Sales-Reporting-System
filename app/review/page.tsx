import { listItems } from "@/lib/repo";
import { getMode } from "@/lib/server/mode";
import { getScope } from "@/lib/server/scope";
import { getModeStatus } from "@/lib/server/modeStatus";
import { getState } from "@/lib/server/appstate";
import { computePlanBase } from "@/lib/server/planSnapshot";
import { readDistVerification } from "@/lib/distver";
import { readBaseReview } from "@/lib/basereview";
import { CROSSWALK } from "@/lib/scope";
import type { PlanAdjustment, PlanEvent } from "@/lib/repo/client";
import ReviewView, { type ReviewData } from "@/components/review/ReviewView";

/* Review & submit — the plan's last step. One account × one plan year, read
   back in the order it was built: the distribution answers, the new items,
   the levers on the base, the events on the calendar — and then the Plan of
   Record is taken from here.

   Nothing on this page is computed a second time. The distribution doc, the
   adjustments, the events and the plan base are the same documents and the
   same construction the four steps before it wrote and showed, so what is
   submitted is exactly what was reviewed. */

const telusIdsFor = (code: string) => {
  const set = new Set<string>();
  for (const r of CROSSWALK) if (r.market_code === code) for (const id of r.telus_customer_ids) set.add(id);
  return set;
};

export default async function Page() {
  const [mode, scope, items] = await Promise.all([getMode(), getScope(), listItems()]);
  /* This is a plan step: it reads the plan year whatever the top bar's mode
     says, so a bookmark or a direct visit still lands on the right year. */
  const plan = { ...mode, kind: "plan" as const };
  const status = await getModeStatus(plan, scope.marketCodes);
  if (!status) throw new Error("mode status unavailable");
  const year = status.year;

  /* One account at a time, like every step before it. With more than one in
     scope the rail is already holding the page; this only has to say so. */
  const one = status.customers.length === 1 ? status.customers[0] : null;
  if (!one) {
    return <ReviewView data={{ year, customers: status.customers.length, scopeLabel: scope.label, account: null }} />;
  }

  const [dvRaw, adjRaw, evRaw, live, brRaw] = await Promise.all([
    getState(`distver:${one.code}:${year}`).catch(() => undefined),
    getState(`adj:${one.code}:${year}`).catch(() => undefined),
    getState(`events:${year}`).catch(() => undefined),
    computePlanBase(one.code, year).catch(() => null),
    getState(`basereview:${one.code}:${year}`).catch(() => undefined),
  ]);
  const baseReview = readBaseReview(brRaw);
  const dv = readDistVerification(dvRaw);
  const adjs = (Array.isArray(adjRaw) ? adjRaw : []) as PlanAdjustment[];
  const ids = telusIdsFor(one.code);
  const events = ((Array.isArray(evRaw) ? evRaw : []) as PlanEvent[])
    .filter((e) => !!e.customer_id && ids.has(e.customer_id))
    .sort((a, b) => a.start.localeCompare(b.start));
  const nameOf = new Map(items.map((i) => [i.upc, i.name]));
  const brandOf = new Map(items.map((i) => [i.upc, i.brand]));

  const out = Object.entries(dv.decisions).filter(([, d]) => d === "out").map(([u]) => u);
  const kept = Object.entries(dv.decisions).filter(([, d]) => d === "in").length;

  const data: ReviewData = {
    year,
    customers: 1,
    scopeLabel: scope.label,
    account: {
      code: one.code,
      name: one.name,
      dataEdge: status.dataEdge,
      distribution: {
        verifiedAt: dv.verified_at,
        kept,
        out: out.map((u) => ({ upc: u, name: nameOf.get(u) ?? u, brand: brandOf.get(u) ?? "" })),
      },
      newItems: {
        answered: !!dv.no_additions || dv.additions.length > 0,
        none: !!dv.no_additions && dv.additions.length === 0,
        additions: dv.additions.map((a) => ({
          name: a.name, brand: a.brand, manual: !!a.manual,
          proxyName: nameOf.get(a.proxy_upc) ?? a.proxy_upc, proxyPct: a.proxy_pct, estAcv: a.est_acv ?? null,
          shipDate: a.ship_date.slice(0, 10), shelfDate: a.shelf_date.slice(0, 10), loadin: a.loadin_units,
        })),
      },
      adjustments: adjs
        .slice()
        .sort((a, b) => a.brand.localeCompare(b.brand) || a.from.localeCompare(b.from))
        .map((a) => ({
          id: a.id, brand: a.brand, item: a.upc === "ALL" ? null : (nameOf.get(a.upc) ?? a.upc),
          kind: a.kind, pct: a.pct, from: a.from, to: a.to, note: a.note,
        })),
      baseReviewedAt: baseReview.verified_at,
      base: live
        ? {
            total: live.totals.base,
            adjusted: live.totals.adjusted,
            byBrand: Object.entries(live.byBrand)
              .map(([brand, v]) => ({
                brand,
                base: v.base.reduce((s, x) => s + x, 0),
                adjusted: v.adjusted.reduce((s, x) => s + x, 0),
              }))
              .filter((b) => b.base > 0 || b.adjusted > 0)
              .sort((a, b) => b.adjusted - a.adjusted),
          }
        : null,
      events: {
        count: events.length,
        spend: events.reduce((s, e) => s + (e.spend || 0), 0),
        manual: events.filter((e) => e.origin === "manual").length,
        carried: events.filter((e) => e.origin !== "manual").length,
        rows: events.map((e) => ({
          id: e.id, title: e.title, brand: e.brand, perf: e.perf, start: e.start, end: e.end,
          spend: e.spend || 0, lift: e.lift_pct, origin: e.origin,
        })),
      },
      versions: one.versions.map((v) => ({
        seq: v.seq, kind: v.kind, label: v.label, takenAt: v.taken_at, note: v.note, total: v.totals.adjusted,
        fromReview: v.submitted_from === "review",
      })),
      signedOff: one.signedOff,
      submitted: one.submitted,
    },
  };
  return <ReviewView data={data} />;
}
