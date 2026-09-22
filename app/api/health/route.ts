import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/server/appstate";
import { SURFACE } from "@/lib/surface";

/* Connection health for the shared-state backend. Reports which backend the
   deployment is running on (supabase when the env vars are present, else the
   file store), which surface it serves, and whether a round-trip write works
   — writes a single timestamp under the 'health' key and reads it back. No
   secrets leave. */

export async function GET() {
  const backend =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "file";
  try {
    const stamp = new Date().toISOString();
    await setState("health", { at: stamp });
    const back = (await getState("health")) as { at?: string } | undefined;
    return NextResponse.json(
      { backend, surface: SURFACE, writable: back?.at === stamp, checked_at: stamp },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    // surface only the status-code shaped message from the backend, no URLs/keys
    const msg = e instanceof Error ? e.message.slice(0, 80) : "unknown";
    return NextResponse.json(
      { backend, surface: SURFACE, writable: false, reason: msg },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
}
