import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/repo";
import { chooseVersion, computePlanBase, getSnapshotDoc, renameVersion, takeSnapshot } from "@/lib/server/planSnapshot";

/* Plan sign-off, candidate plans & Latest Estimates, per customer × plan year.

   GET   → { versions, chosen, current } — the frozen versions, which one is
           chosen as the plan, and the live plan base computed the same way,
           so the client can show drift since a version.
   POST  → { name?, note?, cycle?, from?, choose? } takes the next version:
           v1 = Plan of Record, then candidate plans (forward year) or LEs
           (in-flight year). choose: true also makes it the plan.
   PUT   → { id, note? } chooses an existing version as the plan — the
           submission for approval.
   PATCH → { id, name } names a version.

   Versions are append-only: their numbers are never edited or deleted here —
   that is the audit trail the monthly LE cycle stands on. A name is the one
   thing that may change, and the choice is a record beside them. */

type Ctx = { params: Promise<{ mkt: string; year: string }> };

async function valid(mkt: string, year: string) {
  if (!/^\d{4}$/.test(year)) return null;
  const markets = await listMarkets();
  if (!markets.some((m) => m.code === mkt)) return null;
  return { mkt, year: +year };
}

const fail = (e: unknown, status: number) =>
  NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, { status });

export async function GET(_req: Request, ctx: Ctx) {
  const { mkt, year } = await ctx.params;
  const p = await valid(mkt, year);
  if (!p) return NextResponse.json({ error: "unknown market or year" }, { status: 400 });
  try {
    const [doc, current] = await Promise.all([getSnapshotDoc(p.mkt, p.year), computePlanBase(p.mkt, p.year)]);
    return NextResponse.json({ versions: doc.versions, chosen: doc.chosen, current }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, 500);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { mkt, year } = await ctx.params;
  const p = await valid(mkt, year);
  if (!p) return NextResponse.json({ error: "unknown market or year" }, { status: 400 });
  let note = "", name = "", cycle: string | undefined, from: "review" | undefined, choose = false;
  try {
    const body = (await req.json()) as { note?: string; name?: string; cycle?: string; from?: string; choose?: boolean };
    note = (body.note ?? "").slice(0, 500);
    name = (body.name ?? "").slice(0, 80);
    if (typeof body.cycle === "string" && /^\d{4}-\d{2}$/.test(body.cycle)) cycle = body.cycle;
    if (body.from === "review") from = "review";
    choose = body.choose === true;
  } catch { /* empty body is fine */ }
  try {
    const version = await takeSnapshot(p.mkt, p.year, { note, name, cycleKey: cycle, from, choose });
    return NextResponse.json({ version }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, 502);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { mkt, year } = await ctx.params;
  const p = await valid(mkt, year);
  if (!p) return NextResponse.json({ error: "unknown market or year" }, { status: 400 });
  let id = "", note = "";
  try {
    const body = (await req.json()) as { id?: string; note?: string };
    id = String(body.id ?? "");
    note = (body.note ?? "").slice(0, 500);
  } catch { /* fall through to the id check */ }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const chosen = await chooseVersion(p.mkt, p.year, id, note);
    return NextResponse.json({ chosen }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, 404);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { mkt, year } = await ctx.params;
  const p = await valid(mkt, year);
  if (!p) return NextResponse.json({ error: "unknown market or year" }, { status: 400 });
  let id = "", name = "";
  try {
    const body = (await req.json()) as { id?: string; name?: string };
    id = String(body.id ?? "");
    name = String(body.name ?? "");
  } catch { /* fall through to the id check */ }
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const version = await renameVersion(p.mkt, p.year, id, name);
    return NextResponse.json({ version }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(e, 404);
  }
}
