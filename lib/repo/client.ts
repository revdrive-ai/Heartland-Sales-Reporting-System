"use client";

// The data seam — CLIENT SIDE. These stores now live SERVER-SIDE behind
// /api/state (lib/server/appstate.ts: Supabase when provisioned, the app's
// data/store directory otherwise), so planner work holds across visits and
// is shared by everyone using the tool. The browser keeps a mirror of every
// document (hhDoc:<key>) purely as an offline fallback, and the original
// localStorage keys are lifted to the server the first time a document is
// read — nothing entered before the switch is lost. View components are
// untouched: every function keeps its signature.

import { ALIGN_DEFAULT, type AlignRow } from "@/lib/data/alignmentKey";

/* ---- shared-document plumbing ---- */

const lsGet = <T>(k: string): T | null => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
};
const lsSet = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

type Fetched<T> = { ok: true; data: T | undefined } | { ok: false };

async function readShared<T>(key: string): Promise<Fetched<T>> {
  try {
    const r = await fetch(`/api/state/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (r.status === 404) return { ok: true, data: undefined };
    if (!r.ok) return { ok: false };
    return { ok: true, data: ((await r.json()) as { data: T }).data };
  } catch { return { ok: false }; }
}

async function writeShared(key: string, data: unknown): Promise<boolean> {
  try {
    const r = await fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });
    return r.ok;
  } catch { return false; }
}

/** Read a shared document. Server first; a missing document is seeded from
    the browser's legacy copy (one-time lift of pre-switch work); a server
    that can't answer falls back to the browser mirror. */
async function loadDoc<T>(key: string, legacy: () => T | null): Promise<T | null> {
  const res = await readShared<T>(key);
  if (!res.ok) return lsGet<T>(`hhDoc:${key}`) ?? legacy();
  if (res.data !== undefined) {
    lsSet(`hhDoc:${key}`, res.data); // keep the offline mirror fresh
    return res.data;
  }
  const lifted = lsGet<T>(`hhDoc:${key}`) ?? legacy();
  if (lifted !== null) void writeShared(key, lifted);
  return lifted;
}

/** Write a shared document — server plus the browser mirror. */
async function saveDoc(key: string, data: unknown): Promise<void> {
  lsSet(`hhDoc:${key}`, data);
  await writeShared(key, data);
}

/* ---- alignment key ---- */

const ALIGN_KEY = "hhAlign"; // the mockup's original browser key (legacy lift)

export async function getAlignment(): Promise<{ rows: AlignRow[]; version: number }> {
  const doc = await loadDoc<{ v: number; rows: AlignRow[] }>("align", () =>
    lsGet<{ v: number; rows: AlignRow[] }>(ALIGN_KEY)
  );
  return doc ? { rows: doc.rows, version: doc.v } : { rows: structuredClone(ALIGN_DEFAULT), version: 1 };
}

export async function saveAlignment(rows: AlignRow[], version: number): Promise<void> {
  await saveDoc("align", { v: version, rows });
}

/* ---- plan-year registrations ----
   Which customers (divisions) have had their plan year opened. Mirrors
   supabase/migrations/00005_plan_registrations.sql. Shape:
   { "<year>": { "<market_code>": "<ISO registered_at>" } } */

const PLAN_KEY = "hhPlanReg";

export type PlanRegistry = Record<string, Record<string, string>>;

export async function getPlanRegistry(): Promise<PlanRegistry> {
  return (await loadDoc<PlanRegistry>("planreg", () => lsGet<PlanRegistry>(PLAN_KEY))) ?? {};
}

/** Log a customer into a plan year (idempotent — first visit sets the date). */
export async function registerPlanYear(market_code: string, year: number): Promise<PlanRegistry> {
  const reg = await getPlanRegistry();
  const y = String(year);
  reg[y] = reg[y] ?? {};
  if (!reg[y][market_code]) {
    reg[y][market_code] = new Date().toISOString();
    await saveDoc("planreg", reg);
  }
  return reg;
}

/* ---- planner adjustments ----
   Per item x customer x plan year, the levers a planner pulls on the
   projected base. One shared document per customer x year so planners
   working different scopes never overwrite each other. Mirrors
   supabase/migrations/00006_plan_adjustments.sql. */

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

const adjKey = (market_code: string, plan_year: number) => `adj:${market_code}:${plan_year}`;

async function readAdjs(market_code: string, plan_year: number): Promise<PlanAdjustment[]> {
  return (
    (await loadDoc<PlanAdjustment[]>(adjKey(market_code, plan_year), () => {
      const old = lsGet<PlanAdjustment[]>(ADJ_KEY);
      const mine = old?.filter((a) => a.market_code === market_code && a.plan_year === plan_year);
      return mine?.length ? mine : null;
    })) ?? []
  );
}

export async function getPlanAdjustments(market_code: string, plan_year: number): Promise<PlanAdjustment[]> {
  return readAdjs(market_code, plan_year);
}

export async function savePlanAdjustment(adj: PlanAdjustment): Promise<PlanAdjustment[]> {
  const all = await readAdjs(adj.market_code, adj.plan_year);
  all.push(adj);
  await saveDoc(adjKey(adj.market_code, adj.plan_year), all);
  return all;
}

export async function deletePlanAdjustment(id: string, market_code: string, plan_year: number): Promise<PlanAdjustment[]> {
  const all = (await readAdjs(market_code, plan_year)).filter((a) => a.id !== id);
  await saveDoc(adjKey(market_code, plan_year), all);
  return all;
}

/* ---- plan-year promotion events ----
   The forward book the Promotion Planner builds for 2027+ before Telus has
   it. One shared document per plan year. Mirrors
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
  upcs?: string[];          // items on the deal (wizard entries); absent = whole brand
  funding?: { oi: number; scan: number; fixed: number };  // $/unit rates + fixed fees behind spend
};

const evtKey = (plan_year: number) => `events:${plan_year}`;

async function readYearEvents(plan_year: number): Promise<PlanEvent[]> {
  return (
    (await loadDoc<PlanEvent[]>(evtKey(plan_year), () => {
      const old = lsGet<PlanEvent[]>(EVT_KEY);
      const mine = old?.filter((e) => e.plan_year === plan_year);
      return mine?.length ? mine : null;
    })) ?? []
  );
}

async function writeYearEvents(plan_year: number, evts: PlanEvent[]): Promise<PlanEvent[]> {
  await saveDoc(evtKey(plan_year), evts);
  return evts;
}

export async function getPlanEvents(plan_year: number): Promise<PlanEvent[]> {
  return readYearEvents(plan_year);
}

/** Replace a plan year's whole event list. The plan book holds the year's
    document in component state and persists local-first through this, so
    rapid edits (lift typing) never race server round-trips. */
export async function replacePlanEvents(plan_year: number, evts: PlanEvent[]): Promise<PlanEvent[]> {
  return writeYearEvents(plan_year, evts);
}

export async function addPlanEvents(evts: PlanEvent[]): Promise<PlanEvent[]> {
  const plan_year = evts[0]?.plan_year;
  if (plan_year === undefined) return [];
  const all = await readYearEvents(plan_year);
  all.push(...evts);
  return writeYearEvents(plan_year, all);
}

export async function updatePlanEvent(id: string, plan_year: number, patch: Partial<PlanEvent>): Promise<PlanEvent[]> {
  const all = await readYearEvents(plan_year);
  const i = all.findIndex((e) => e.id === id);
  if (i >= 0) all[i] = { ...all[i], ...patch };
  return writeYearEvents(plan_year, all);
}

export async function deletePlanEvent(id: string, plan_year: number): Promise<PlanEvent[]> {
  const all = (await readYearEvents(plan_year)).filter((e) => e.id !== id);
  return writeYearEvents(plan_year, all);
}

/** Reset a plan year — all of it, or only the events of one origin
    (e.g. origin "carry" undoes a carry-forward and keeps manual work). */
export async function clearPlanEvents(plan_year: number, origin?: PlanEvent["origin"]): Promise<PlanEvent[]> {
  const all = (await readYearEvents(plan_year)).filter(
    (e) => origin !== undefined && e.origin !== origin
  );
  return writeYearEvents(plan_year, all);
}

/* ---- price edits ----
   Per-item dated list-price changes entered in the Price List screen,
   overlaid on the workbook-ingested fixture everywhere prices are read
   client-side. Mirrors rows with source 'manual' in
   supabase/migrations/00009_price_list.sql. */

const PRICE_KEY = "hhPriceEdits";

export type PriceEdit = {
  id: string;
  fg: string;
  upc: string | null;         // resolved NIQ upc when the item is on file
  unit_price: number | null;
  case_price: number | null;
  effective_from: string;     // ISO date
  note: string;
  created_at: string;
};

async function readPriceEdits(): Promise<PriceEdit[]> {
  return (
    (await loadDoc<PriceEdit[]>("priceedits", () => {
      const old = lsGet<PriceEdit[]>(PRICE_KEY);
      return old?.length ? old : null;
    })) ?? []
  );
}

export async function getPriceEdits(): Promise<PriceEdit[]> {
  return readPriceEdits();
}

export async function addPriceEdit(e: PriceEdit): Promise<PriceEdit[]> {
  const all = await readPriceEdits();
  all.push(e);
  await saveDoc("priceedits", all);
  return all;
}

export async function deletePriceEdit(id: string): Promise<PriceEdit[]> {
  const all = (await readPriceEdits()).filter((e) => e.id !== id);
  await saveDoc("priceedits", all);
  return all;
}

/* ---- plan-year trade budget ----
   One number per plan year + scope, editable on the planner's spend bar;
   defaults to the prior year's booked total. One shared document holds the
   whole map — the values are single numbers, so contention is negligible. */

const BUDGET_KEY = "hhPlanBudget";

async function readBudgets(): Promise<Record<string, number>> {
  return (await loadDoc<Record<string, number>>("budget", () => lsGet<Record<string, number>>(BUDGET_KEY))) ?? {};
}

export async function getPlanBudget(key: string): Promise<number | null> {
  return (await readBudgets())[key] ?? null;
}

export async function setPlanBudget(key: string, value: number): Promise<void> {
  const map = await readBudgets();
  map[key] = value;
  await saveDoc("budget", map);
}
