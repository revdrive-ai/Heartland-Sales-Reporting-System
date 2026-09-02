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
