"use client";

// The data seam — CLIENT SIDE. Browser-held stores, mirroring the reference
// mockup's localStorage keys, behind the same async seam as lib/repo/index.ts.
// When Supabase lands these become table reads/writes (and the localStorage
// keys retire), with no changes outside lib/repo/.

import { ALIGN_DEFAULT, type AlignRow } from "@/lib/data/alignmentKey";

const ALIGN_KEY = "hhAlign"; // same key the mockup uses

export async function getAlignment(): Promise<{ rows: AlignRow[]; version: number }> {
  try {
    const raw = localStorage.getItem(ALIGN_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as { v: number; rows: AlignRow[] };
      return { rows: stored.rows, version: stored.v };
    }
  } catch {}
  return { rows: structuredClone(ALIGN_DEFAULT), version: 1 };
}

export async function saveAlignment(rows: AlignRow[], version: number): Promise<void> {
  try { localStorage.setItem(ALIGN_KEY, JSON.stringify({ v: version, rows })); } catch {}
}

/* Plan-year registrations — which customers (divisions) have had their plan
   year opened. Mirrors supabase/migrations/00005_plan_registrations.sql;
   becomes a table upsert at swap-in time. Shape:
   { "<year>": { "<market_code>": "<ISO registered_at>" } } */

const PLAN_KEY = "hhPlanReg";

export type PlanRegistry = Record<string, Record<string, string>>;

export async function getPlanRegistry(): Promise<PlanRegistry> {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY) ?? "{}") as PlanRegistry; } catch { return {}; }
}

/** Log a customer into a plan year (idempotent — first visit sets the date). */
export async function registerPlanYear(market_code: string, year: number): Promise<PlanRegistry> {
  const reg = await getPlanRegistry();
  const y = String(year);
  reg[y] = reg[y] ?? {};
  if (!reg[y][market_code]) reg[y][market_code] = new Date().toISOString();
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(reg)); } catch {}
  return reg;
}

/* Planner adjustments — per item x customer x plan year, the levers a planner
   pulls on the projected base: distribution gained/lost, a base price change,
   or a recent-trend override. pct is the expected % impact on base volume in
   the effective window. Mirrors supabase/migrations/00006_plan_adjustments.sql. */

const ADJ_KEY = "hhPlanAdj";

export type PlanAdjustment = {
  id: string;
  market_code: string;
  plan_year: number;
  brand: string;
  upc: string;             // "ALL" = every item of the brand
  kind: "distribution" | "price" | "trend";
  pct: number;             // signed % impact on base volume
  from: string;            // ISO date the adjustment takes effect
  to: string;              // ISO date it ends
  note: string;
  created_at: string;
};

async function readAdjs(): Promise<PlanAdjustment[]> {
  try { return JSON.parse(localStorage.getItem(ADJ_KEY) ?? "[]") as PlanAdjustment[]; } catch { return []; }
}
const forScope = (all: PlanAdjustment[], market_code: string, plan_year: number) =>
  all.filter((a) => a.market_code === market_code && a.plan_year === plan_year);

export async function getPlanAdjustments(market_code: string, plan_year: number): Promise<PlanAdjustment[]> {
  return forScope(await readAdjs(), market_code, plan_year);
}

export async function savePlanAdjustment(adj: PlanAdjustment): Promise<PlanAdjustment[]> {
  const all = await readAdjs();
  all.push(adj);
  try { localStorage.setItem(ADJ_KEY, JSON.stringify(all)); } catch {}
  return forScope(all, adj.market_code, adj.plan_year);
}

export async function deletePlanAdjustment(id: string, market_code: string, plan_year: number): Promise<PlanAdjustment[]> {
  const all = (await readAdjs()).filter((a) => a.id !== id);
  try { localStorage.setItem(ADJ_KEY, JSON.stringify(all)); } catch {}
  return forScope(all, market_code, plan_year);
}

/* Plan-year promotion events — the forward book the Promotion Planner builds
   for 2027+ before Telus has it: entered by hand, imported from the CSV
   template, or carried forward from the prior year's Telus book. Mirrors
   supabase/migrations/00007_plan_events.sql. */

const EVT_KEY = "hhPlanEvents";

export type PlanEvent = {
  id: string;
  plan_year: number;
  customer_id: string;      // Telus customer id ("" when imported name didn't match)
  customer: string;
  brand: string;            // own brand, or "MIXED" when unknown (carried events)
  title: string;
  perf: string;             // performance type
  start: string;            // ISO dates
  end: string;
  spend: number;            // planned trade $, whole dollars
  lift_pct: number | null;  // expected % lift over base; null = not set yet
  note: string;
  origin: "manual" | "import" | "carry";
  created_at: string;
};

async function readEvents(): Promise<PlanEvent[]> {
  try { return JSON.parse(localStorage.getItem(EVT_KEY) ?? "[]") as PlanEvent[]; } catch { return []; }
}
const yearEvents = (all: PlanEvent[], plan_year: number) => all.filter((e) => e.plan_year === plan_year);

export async function getPlanEvents(plan_year: number): Promise<PlanEvent[]> {
  return yearEvents(await readEvents(), plan_year);
}

export async function addPlanEvents(evts: PlanEvent[]): Promise<PlanEvent[]> {
  const all = await readEvents();
  all.push(...evts);
  try { localStorage.setItem(EVT_KEY, JSON.stringify(all)); } catch {}
  return yearEvents(all, evts[0]?.plan_year ?? 0);
}

export async function updatePlanEvent(id: string, plan_year: number, patch: Partial<PlanEvent>): Promise<PlanEvent[]> {
  const all = await readEvents();
  const i = all.findIndex((e) => e.id === id);
  if (i >= 0) all[i] = { ...all[i], ...patch };
  try { localStorage.setItem(EVT_KEY, JSON.stringify(all)); } catch {}
  return yearEvents(all, plan_year);
}

export async function deletePlanEvent(id: string, plan_year: number): Promise<PlanEvent[]> {
  const all = (await readEvents()).filter((e) => e.id !== id);
  try { localStorage.setItem(EVT_KEY, JSON.stringify(all)); } catch {}
  return yearEvents(all, plan_year);
}

/** Reset a plan year — all of it, or only the events of one origin
    (e.g. origin "carry" undoes a carry-forward and keeps manual work). */
export async function clearPlanEvents(plan_year: number, origin?: PlanEvent["origin"]): Promise<PlanEvent[]> {
  const all = (await readEvents()).filter(
    (e) => e.plan_year !== plan_year || (origin !== undefined && e.origin !== origin)
  );
  try { localStorage.setItem(EVT_KEY, JSON.stringify(all)); } catch {}
  return yearEvents(all, plan_year);
}

/* Plan-year trade budget — one number per plan year + scope, editable on the
   planner's spend bar; defaults to the prior year's booked total. */

const BUDGET_KEY = "hhPlanBudget";

export async function getPlanBudget(key: string): Promise<number | null> {
  try {
    const map = JSON.parse(localStorage.getItem(BUDGET_KEY) ?? "{}") as Record<string, number>;
    return map[key] ?? null;
  } catch { return null; }
}

export async function setPlanBudget(key: string, value: number): Promise<void> {
  try {
    const map = JSON.parse(localStorage.getItem(BUDGET_KEY) ?? "{}") as Record<string, number>;
    map[key] = value;
    localStorage.setItem(BUDGET_KEY, JSON.stringify(map));
  } catch {}
}
