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

function rowsShipmentsWeekly(): Row[] {
  const dir = path.join(ROOT, "data", "shipments");
  const out: Row[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()) {
    for (const r of readJson<Row[]>(path.join("data", "shipments", f))) out.push(r);
  }
  return out;
}

/** table → row producer + on_conflict natural key. Order matters: FK parents first.
    `reconcile` names the key column of a snapshot table: once a load has
    upserted every fixture row, rows the fixture no longer carries are flagged
    removed_at_source (never deleted), and flagged rows the fixture carries
    again are restored — the Telus export's "a line missing from a later
    export" rule. */
export const TABLES: { table: string; onConflict: string; rows: () => Row[]; reconcile?: string }[] = [
  { table: "markets", onConflict: "code", rows: () => readJson<Row[]>("lib/fixtures/markets.json") },
  { table: "items", onConflict: "upc", rows: () => readJson<Row[]>("lib/fixtures/items.json") },
  { table: "nielsen_weekly", onConflict: "week_ending,upc,market_code", rows: rowsNielsenWeekly },
  {
    table: "promotions",
    onConflict: "promo_id",
    reconcile: "promo_id",
    // header rollups are computed from lines, never stored; a row the loader
    // sends is, by definition, in the current export
    rows: () => readJson<Row[]>("data/promos/promotions.json.gz").map((p) => ({ ...drop(p, ["line_count", "planned_amount", "actual_amount"]), removed_at_source: false })),
  },
  { table: "promo_lines", onConflict: "line_id", reconcile: "line_id", rows: () => readJson<Row[]>("data/promos/promo-lines.json.gz").map((l) => ({ ...l, removed_at_source: false })) },
  { table: "item_crosswalk", onConflict: "item_number,upc_core", rows: () => readJson<{ telus_items: Row[] }>("lib/fixtures/item-crosswalk.json").telus_items },
  { table: "niq_item_attributes", onConflict: "upc_core", rows: () => readJson<{ niq_items: Row[] }>("lib/fixtures/item-crosswalk.json").niq_items },
  { table: "price_list", onConflict: "fg,effective_from", rows: () => readJson<{ rows: Row[] }>("lib/fixtures/price-list.json").rows },
  {
    table: "customer_crosswalk",
    onConflict: "id",
    rows: () => readJson<Row[]>("lib/fixtures/crosswalk.json").map((r) => drop(r, ["telus_customer_ids", "telus_customer_names"])),
  },
  { table: "crosswalk_telus_customers", onConflict: "crosswalk_id,telus_customer_id", rows: rowsCrosswalkTelusCustomers },
  { table: "shipments_weekly", onConflict: "account_code,item_code,week_ending", rows: rowsShipmentsWeekly },
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

const sbHeaders = (key: string) => ({ apikey: key, authorization: `Bearer ${key}` });

/** Every value of one key column in a table that is not flagged removed —
    read in pages, the PostgREST way. */
async function liveKeys(url: string, key: string, table: string, col: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${col}&removed_at_source=eq.false&order=${col}.asc`, {
      headers: { ...sbHeaders(key), range: `${from}-${from + 999}`, "range-unit": "items" },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`${table} keys: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const rows = (await r.json()) as Record<string, string>[];
    for (const row of rows) out.push(row[col]);
    if (rows.length < 1000) return out;
  }
}

/** Flag the rows of a snapshot table that the fixture no longer carries.
    The upsert just before this set removed_at_source = false on every row the
    fixture does carry, so what is left flagged false and absent from the
    fixture is exactly what the export dropped. Returns how many were flagged. */
async function reconcileRemoved(url: string, key: string, spec: { table: string; reconcile?: string; rows: () => Row[] }): Promise<number> {
  if (!spec.reconcile) return 0;
  const col = spec.reconcile;
  const keep = new Set(rowsOf(spec).map((r) => String(r[col])));
  const stale = (await liveKeys(url, key, spec.table, col)).filter((k) => !keep.has(k));
  for (let i = 0; i < stale.length; i += 200) {
    const ids = stale.slice(i, i + 200).map((k) => `"${k.replace(/"/g, '\\"')}"`).join(",");
    const r = await fetch(`${url}/rest/v1/${spec.table}?${col}=in.(${encodeURIComponent(ids)})`, {
      method: "PATCH",
      headers: { ...sbHeaders(key), "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ removed_at_source: true, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`${spec.table} reconcile: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  return stale.length;
}

/** Upsert one slice of one table. Returns progress so the caller can loop;
    on the last slice of a snapshot table, `removed` says how many rows the
    fixture no longer carries were flagged. */
export async function loadChunk(table: string, offset: number): Promise<{ table: string; total: number; loaded: number; done: boolean; removed?: number }> {
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
        ...sbHeaders(key),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`${spec.table} rows ${i}–${i + batch.length}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const done = end >= rows.length;
  const removed = done && spec.reconcile ? await reconcileRemoved(url, key, spec) : undefined;
  return { table, total: rows.length, loaded: end, done, ...(removed !== undefined ? { removed } : {}) };
}
