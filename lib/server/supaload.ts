import { readFileSync, readdirSync } from "fs";
import { gunzipSync } from "node:zlib";
import path from "path";

/* Server-side Supabase data loader — the in-app twin of
   scripts/load_supabase.py, so the deployed site can load its own fixture
   data into the connected project without anyone running a terminal. Same
   contract as the script: idempotent natural-key upserts through PostgREST,
   FK parents ordered first, header rollups and denormalized columns dropped.
   Keep the two TABLES registries in step when either changes.

   Loading is chunked: /api/admin/load posts one slice of one table per
   request so no call outlives a serverless time limit; the client loops.
   The service-role key stays server-side, exactly as in appstate.ts. */

type Row = Record<string, unknown>;

const ROOT = process.cwd();

function readJson<T>(rel: string): T {
  const buf = readFileSync(path.join(ROOT, rel));
  const text = rel.endsWith(".gz") ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8");
  return JSON.parse(text) as T;
}

const drop = (r: Row, keys: string[]) => {
  const out = { ...r };
  for (const k of keys) delete out[k];
  return out;
};

function rowsNielsenWeekly(): Row[] {
  const dir = path.join(ROOT, "data", "nielsen");
  const out: Row[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()) {
    for (const r of readJson<Row[]>(path.join("data", "nielsen", f))) {
      // denormalized in the fixture; items/markets carry these
      out.push(drop(r, ["brand", "category", "market_name"]));
    }
  }
  return out;
}

type CrosswalkRow = Row & { id: string; telus_customer_ids?: string[]; telus_customer_names?: string[] };

function rowsCrosswalkTelusCustomers(): Row[] {
  const out: Row[] = [];
  for (const r of readJson<CrosswalkRow[]>("lib/fixtures/crosswalk.json")) {
    const ids = r.telus_customer_ids ?? [];
    const names = r.telus_customer_names ?? [];
    ids.forEach((cid, i) => {
      out.push({ crosswalk_id: r.id, telus_customer_id: cid, telus_customer_name: names[i] ?? cid });
    });
  }
  return out;
}

/** table → row producer + on_conflict natural key. Order matters: FK parents first. */
export const TABLES: { table: string; onConflict: string; rows: () => Row[] }[] = [
  { table: "markets", onConflict: "code", rows: () => readJson<Row[]>("lib/fixtures/markets.json") },
  { table: "items", onConflict: "upc", rows: () => readJson<Row[]>("lib/fixtures/items.json") },
  { table: "nielsen_weekly", onConflict: "week_ending,upc,market_code", rows: rowsNielsenWeekly },
  {
    table: "promotions",
    onConflict: "promo_id",
    // header rollups are computed from lines, never stored
    rows: () => readJson<Row[]>("data/promos/promotions.json.gz").map((p) => drop(p, ["line_count", "planned_amount", "actual_amount"])),
  },
  { table: "promo_lines", onConflict: "line_id", rows: () => readJson<Row[]>("data/promos/promo-lines.json.gz") },
  { table: "item_crosswalk", onConflict: "item_number,upc_core", rows: () => readJson<{ telus_items: Row[] }>("lib/fixtures/item-crosswalk.json").telus_items },
  { table: "niq_item_attributes", onConflict: "upc_core", rows: () => readJson<{ niq_items: Row[] }>("lib/fixtures/item-crosswalk.json").niq_items },
  { table: "price_list", onConflict: "fg,effective_from", rows: () => readJson<{ rows: Row[] }>("lib/fixtures/price-list.json").rows },
  {
    table: "customer_crosswalk",
    onConflict: "id",
    rows: () => readJson<Row[]>("lib/fixtures/crosswalk.json").map((r) => drop(r, ["telus_customer_ids", "telus_customer_names"])),
  },
  { table: "crosswalk_telus_customers", onConflict: "crosswalk_id,telus_customer_id", rows: rowsCrosswalkTelusCustomers },
];

const BATCH = 2000; // rows per PostgREST POST
export const CHUNK = 4000; // rows per /api/admin/load request — two batches, well inside serverless limits

// warm serverless instances keep this, so a chunked load re-parses each gz once
const rowCache = new Map<string, Row[]>();
const rowsOf = (t: { table: string; rows: () => Row[] }) => {
  let rows = rowCache.get(t.table);
  if (!rows) {
    rows = t.rows();
    rowCache.set(t.table, rows);
  }
  return rows;
};

export function tableCounts(): { table: string; rows: number }[] {
  return TABLES.map((t) => ({ table: t.table, rows: rowsOf(t).length }));
}

/** Upsert one slice of one table. Returns progress so the caller can loop. */
export async function loadChunk(table: string, offset: number): Promise<{ table: string; total: number; loaded: number; done: boolean }> {
  const spec = TABLES.find((t) => t.table === table);
  if (!spec) throw new Error(`unknown table: ${table}`);
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars are not configured");

  const rows = rowsOf(spec);
  const end = Math.min(offset + CHUNK, rows.length);
  for (let i = offset; i < end; i += BATCH) {
    const batch = rows.slice(i, Math.min(i + BATCH, end));
    const r = await fetch(`${url}/rest/v1/${spec.table}?on_conflict=${spec.onConflict}`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`${spec.table} rows ${i}–${i + batch.length}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  return { table, total: rows.length, loaded: end, done: end >= rows.length };
}
