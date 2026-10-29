import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/server/appstate";
import { dataSource } from "@/lib/server/supaRead";
import { listItems, listMarkets, listPromotions, listWeekEndings } from "@/lib/repo";

/* Connection health. Reports which backend the shared state runs on
   (supabase when the env vars are present, else the file store) and whether
   a round-trip write works — a single timestamp under the 'health' key, read
   back. Then where the DATA tables are read from (supabase or the repo
   fixtures) with a few counts through the repo layer, so a deployment can
   show it is reading the database. No secrets leave. */

export async function GET() {
  const backend =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "file";
  const source = dataSource();
  let data: Record<string, unknown> = { source };
  try {
    const [markets, items, promos] = await Promise.all([listMarkets(), listItems(), listPromotions()]);
    const weeks = markets.length ? await listWeekEndings(markets[0].code) : [];
    data = { source, markets: markets.length, items: items.length, promotions: promos.length, weeks: weeks.length, data_edge: weeks[weeks.length - 1] ?? null };
  } catch (e) {
    data = { source, error: e instanceof Error ? e.message.slice(0, 80) : "unknown" };
  }
  try {
    const stamp = new Date().toISOString();
    await setState("health", { at: stamp });
    const back = (await getState("health")) as { at?: string } | undefined;
    return NextResponse.json(
      { backend, writable: back?.at === stamp, checked_at: stamp, data },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    // surface only the status-code shaped message from the backend, no URLs/keys
    const msg = e instanceof Error ? e.message.slice(0, 80) : "unknown";
    return NextResponse.json(
      { backend, writable: false, reason: msg, data },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
}
