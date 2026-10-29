/* Reading the data tables from Supabase — the server side of the data seam.

   lib/repo/index.ts asks for rows here when the deployment is configured for
   Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, the same pair the shared
   state already uses) and falls back to the repo fixtures otherwise, or when
   HH_DATA_SOURCE=fixtures pins it to the files. The service-role key never
   leaves the server: this module is imported only from server code.

   PostgREST hands back at most 1,000 rows a request, so a table is read in
   pages: the first page carries the exact count, the rest are fetched at
   once. Every query must carry an order= so the pages are stable. Results are
   kept in memory for a few minutes — the tables change only when someone
   loads them, and the loader clears this cache when it finishes. */

const SB_URL = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type DataSource = "supabase" | "fixtures";

/** Where the data tables are read from on this deployment. */
export function dataSource(): DataSource {
  if (process.env.HH_DATA_SOURCE === "fixtures") return "fixtures";
  return SB_URL && SB_KEY ? "supabase" : "fixtures";
}

const PAGE = 1000;
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; rows: Promise<unknown[]> }>();

async function page(table: string, query: string, from: number, to: number): Promise<{ rows: unknown[]; total: number | null }> {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SB_KEY!,
      authorization: `Bearer ${SB_KEY!}`,
      range: `${from}-${to}`,
      "range-unit": "items",
      prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`${table} read failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const total = r.headers.get("content-range")?.split("/")[1];
  return { rows: (await r.json()) as unknown[], total: total && total !== "*" ? +total : null };
}

/** Every row a PostgREST query selects, across pages. `query` is the part
    after the "?" — select=, filters and an order=. */
export async function sbRows<T>(table: string, query: string): Promise<T[]> {
  const key = `${table}?${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows as Promise<T[]>;
  const rows = (async () => {
    const first = await page(table, query, 0, PAGE - 1);
    const total = first.total ?? first.rows.length;
    if (total <= first.rows.length) return first.rows;
    const rest: Promise<{ rows: unknown[] }>[] = [];
    for (let from = first.rows.length; from < total; from += PAGE) rest.push(page(table, query, from, from + PAGE - 1));
    const pages = await Promise.all(rest);
    return [...first.rows, ...pages.flatMap((p) => p.rows)];
  })();
  cache.set(key, { at: Date.now(), rows });
  rows.catch(() => cache.delete(key)); // a failed read is not kept
  return rows as Promise<T[]>;
}

/** Forget every cached table — called by the loader once a load finishes,
    so the next page read sees the new rows. */
export function invalidateReads(): void {
  cache.clear();
}
