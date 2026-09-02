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
