import { promises as fs } from "fs";
import path from "path";

/* Server-side shared state — one JSON document per key, behind /api/state.
   Two backends, picked by environment:

   - Supabase (PostgREST on the app_state table, migration 00010) when
     SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set — durable and shared on
     any host, including Vercel.
   - The local filesystem (data/store/, gitignored) otherwise — durable and
     shared wherever the server keeps a writable disk (dev, self-hosted).
     On a read-only serverless filesystem writes throw; /api/state turns that
     into a 503 and the client stores fall back to the browser copy.

   The service-role key never leaves the server: this module is imported only
   from route handlers. */

const SB_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SB_URL && SB_KEY ? { url: SB_URL, key: SB_KEY } : null;

const FILE_DIR = process.env.APP_STATE_DIR ?? path.join(process.cwd(), "data", "store");
// keys are validated by the route; this only maps them onto safe filenames
const fileOf = (key: string) => path.join(FILE_DIR, key.replace(/[^A-Za-z0-9._|:-]/g, "_") + ".json");

const sbHeaders = (k: string) => ({ apikey: k, authorization: `Bearer ${k}` });

/** The document under a key, or undefined when none has been written. */
export async function getState(key: string): Promise<unknown> {
  if (supabase) {
    const r = await fetch(
      `${supabase.url}/rest/v1/app_state?key=eq.${encodeURIComponent(key)}&select=data`,
      { headers: sbHeaders(supabase.key), cache: "no-store" }
    );
    if (!r.ok) throw new Error(`app_state read failed: ${r.status}`);
    const rows = (await r.json()) as { data: unknown }[];
    return rows[0]?.data;
  }
  try {
    return JSON.parse(await fs.readFile(fileOf(key), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

/** Replace the document under a key (last write wins). */
export async function setState(key: string, data: unknown): Promise<void> {
  if (supabase) {
    const r = await fetch(`${supabase.url}/rest/v1/app_state`, {
      method: "POST",
      headers: {
        ...sbHeaders(supabase.key),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`app_state write failed: ${r.status}`);
    return;
  }
  await fs.mkdir(FILE_DIR, { recursive: true });
  const f = fileOf(key);
  const tmp = f + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, f); // atomic on the same filesystem — no torn reads
}
