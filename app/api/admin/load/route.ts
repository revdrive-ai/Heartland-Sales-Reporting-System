import { NextResponse } from "next/server";
import { CHUNK, loadChunk, tableCounts } from "@/lib/server/supaload";

/* Data loader endpoint behind the Integrations screen.

   GET  → whether Supabase is configured + fixture row counts per table
          (the in-app equivalent of load_supabase.py --dry-run).
   POST {table, offset} → upsert one CHUNK-row slice of that table and report
          progress; the client loops per table until done. Chunking keeps
          every request far inside serverless time limits.

   Writes are idempotent natural-key upserts of data already in the deployed
   bundle, so re-running (or a stray call) can never duplicate or destroy
   anything; the service-role key never leaves the server. */

export const maxDuration = 60;

const configured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function GET() {
  try {
    return NextResponse.json(
      { configured: configured(), chunk: CHUNK, tables: tableCounts() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : "unknown";
    return NextResponse.json({ configured: configured(), error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!configured()) {
    return NextResponse.json({ error: "Supabase env vars are not configured on this deployment" }, { status: 503 });
  }
  let body: { table?: string; offset?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const table = body.table;
  const offset = Number.isInteger(body.offset) && (body.offset as number) >= 0 ? (body.offset as number) : 0;
  if (!table) return NextResponse.json({ error: "table is required" }, { status: 400 });
  try {
    const result = await loadChunk(table, offset);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // surface table/status-shaped messages only — no URLs or keys
    const msg = e instanceof Error ? e.message.slice(0, 300) : "unknown";
    const status = msg.startsWith("unknown table") ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
