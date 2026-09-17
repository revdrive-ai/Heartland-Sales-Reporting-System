import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/server/appstate";

/* Connection health for the shared-state backend. Reports which backend the
   deployment is running on (supabase when the env vars are present, else the
   file store) and whether a round-trip write works — writes a single
   timestamp under the 'health' key and reads it back. No secrets leave. */

export async function GET() {
  const backend =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "file";
  try {
    const stamp = new Date().toISOString();
    await setState("health", { at: stamp });
    const back = (await getState("health")) as { at?: string } | undefined;
    return NextResponse.json(
      { backend, writable: back?.at === stamp, checked_at: stamp },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { backend, writable: false },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
}
