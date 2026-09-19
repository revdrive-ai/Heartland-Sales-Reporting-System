import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/repo";
import { computePlanBase, getSnapshots, takeSnapshot } from "@/lib/server/planSnapshot";

/* Plan sign-off & Latest Estimates, per customer × plan year.

   GET  → { versions, current } — the frozen versions plus the live plan base
          computed the same way, so the client can show drift since the last
          version ("changed since LE Sep").
   POST → { note? } takes the next version: v1 = Plan of Record, then LEs.

   Writes append-only: versions are never edited or deleted here — that is
   the audit trail the monthly LE cycle stands on. */

type Ctx = { params: Promise<{ mkt: string; year: string }> };

async function valid(mkt: string, year: string) {
  if (!/^\d{4}$/.test(year)) return null;
  const markets = await listMarkets();
  if (!markets.some((m) => m.code === mkt)) return null;
  return { mkt, year: +year };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { mkt, year } = await ctx.params;
  const p = await valid(mkt, year);
  if (!p) return NextResponse.json({ error: "unknown market or year" }, { status: 400 });
  try {
    const [versions, current] = await Promise.all([getSnapshots(p.mkt, p.year), computePlanBase(p.mkt, p.year)]);
    return NextResponse.json({ versions, current }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { mkt, year } = await ctx.params;
  const p = await valid(mkt, year);
  if (!p) return NextResponse.json({ error: "unknown market or year" }, { status: 400 });
  let note = "";
  try {
    const body = (await req.json()) as { note?: string };
    note = (body.note ?? "").slice(0, 500);
  } catch { /* empty body is fine */ }
  try {
    const version = await takeSnapshot(p.mkt, p.year, note);
    return NextResponse.json({ version }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, { status: 502 });
  }
}
