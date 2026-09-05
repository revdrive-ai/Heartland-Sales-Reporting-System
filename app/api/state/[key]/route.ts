import { NextRequest, NextResponse } from "next/server";
import { getState, setState } from "@/lib/server/appstate";

/* Shared-state endpoint behind the client stores (lib/repo/client.ts):
   GET returns the document under a key (404 when none), PUT replaces it.
   503 = no writable backend right now — the client falls back to its
   browser-held copy, so the tool degrades to the old per-browser behavior
   instead of losing work. */

const OK_KEY = /^[A-Za-z0-9._|: -]{1,200}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  if (!OK_KEY.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  try {
    const data = await getState(key);
    if (data === undefined) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ data }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "state store unavailable" }, { status: 503 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  if (!OK_KEY.test(key)) return NextResponse.json({ error: "bad key" }, { status: 400 });
  let body: { data?: unknown };
  try {
    body = (await req.json()) as { data?: unknown };
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (body.data === undefined) return NextResponse.json({ error: "missing data" }, { status: 400 });
  try {
    await setState(key, body.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "state store unavailable" }, { status: 503 });
  }
}
