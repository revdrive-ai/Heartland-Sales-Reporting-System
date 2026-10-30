@AGENTS.md

# Project notes

- This is a Next.js (App Router, TypeScript) rebuild of the single-file trade-platform mockup
  kept at `reference/heartland-harvest-v3.html`. When rebuilding a view, extract its markup,
  data consts and behavior from that file — it is the source of truth for parity.
- `app/globals.css` is the demo's stylesheet with the alternate mockup themes removed — the
  platform ships one theme (the `:root` palette). Prefer reusing its classes over writing new
  CSS; rebuild-specific additions go in `app/rebuild.css`.
- Demo data consts port to typed modules in `lib/data/` (see `nielsenPull.ts`,
  `alignmentKey.ts` for the pattern). localStorage keys keep the demo's names
  (`hhAlign`, `hhObj`, `hhWelcomeDone`).
- **Views never touch data directly** — they import from `lib/repo/` only.
  `lib/repo/index.ts` is server-only; call it from server components and pass props down.
  It answers from **Supabase** (the tables in `supabase/setup.sql`, read with the service
  role through `lib/server/supaRead.ts`, paged 1,000 rows at a time and cached ~10 min)
  whenever `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, else from the repo
  fixtures (`data/nielsen/*.json.gz`, `data/promos/`, `data/shipments/`, `lib/fixtures/`);
  `HH_DATA_SOURCE=fixtures` pins the files. A failed Supabase read falls back to the
  fixture for that dataset and logs `[repo] …`. `/api/health` reports the live source with
  counts; the Integrations loader clears the read cache when a load finishes and flags
  promotions / promo_lines the fixture no longer carries as `removed_at_source`.
- **Fabric is the system of record for internal data.** The POC project is loaded from
  Fabric (Syspro by way of the warehouse; `etl_load_log` records each load):
  `fact_shipments_weekly` (invoiced sales by ship-to × stock code × Saturday, net / gross /
  off-invoice dollars and CASES), `dim_customer` (ship-to → parent account, channel,
  region), `dim_product` (brand, category, case pack, `nielsen_upc` tie), `dim_list_price`,
  `dim_fiscal_period`, `customer_xref` (Telus → Syspro codes → NIQ market codes) and the
  `telus_*` tables. `lib/server/fabric.ts` is the ONLY module that knows those shapes; it
  reads through migration 00015's objects (`v_sales_weekly`, `rpt_sales_weekly(from, to,
  customers[])` — one json array per calendar year —, `v_sales_products`, `v_list_price`).
  What reads Fabric: the Leadership report's sales (`salesFacts.ts`, falling back to the
  NIQ retail read), `getShipments` (the ship-tos behind an account through `customer_xref`,
  cases × `dim_product.units_per_case`), and `getPriceList` (Fabric's LIST price first, the
  workbook `price_list` filling only items Fabric does not price). What still reads the
  app's own tables: NIQ facts / items / markets, the Telus promotion book (Fabric's
  `telus_cust_item` carries no planned or actual dollars yet), the crosswalks. UPCs tie by
  digits with leading zeros dropped (`upcKey`): the NIQ 12-digit upc, `nielsen_upc` (11)
  and `upc_core` all reduce to the same key.
  `lib/repo/client.ts` holds the shared stores
  (plan events, budgets, adjustments, registrations, price edits) — server-side via
  `/api/state` (`lib/server/appstate.ts`: Supabase when `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set, else `data/store/` on disk), with localStorage
  only as offline fallback + one-time legacy lift. When Supabase exists only repo bodies change. Row
  shapes are snake_case (`lib/types/db.ts`) matching `supabase/migrations/*.sql`, authored
  as files ahead of the database — keep all three in lockstep when adding tables.
- **The Nielsen data is real**: the full ALBSCO NIQ pull (52,524 rows, 13 divisions,
  157 weeks, 100 items) lives in `data/raw/` and is transformed by
  `scripts/ingest_albsco.py` (python3 + pandas) into `data/nielsen/` and
  `lib/fixtures/{markets,items}.json`. Never hand-edit the outputs; re-run the script.
- **Leadership team report** (`/leadership`, nav group Leadership): sales for the President
  by customer, brand and item — one selection in the URL (period, cust, brand, item, m, sort),
  one page at a time or every page as a printable presentation (`page=all`), and the same
  pages as one Excel workbook (`/api/leadership/export`). Pages are defined in
  `lib/leadership/report.ts` (customer = parent account, channel, brand, item, matrix); the
  numbers come through ONE seam, `lib/server/salesFacts.ts`: internal sales from Fabric
  (net dollars, cases) when the deployment reads Supabase, else the NIQ retail read
  (retail dollars, units). The source block carries the words (`money`, `qty`), so the
  view and the export never hard-code "sales" or "units". Periods resolve against
  `dim_fiscal_period` when it is on hand (PTD, fiscal QTD/YTD/last FY), calendar otherwise.
  The top bar's scope (NIQ market codes) reaches Syspro ship-tos through `customer_xref`.
- **Shipments (sell-in)** come from the Retail Planner export in `data/raw/` (Publix and
  Jewel, weekly by item, Actual + Last Year) via `scripts/ingest_shipments.py` into
  `data/shipments/<ACCOUNT>.json.gz` + `meta.json` (unmatched item codes listed there);
  table `shipments_weekly` (migration 00014). One row per account × item × real week
  (NIQ week-ending Saturday); the workbook's Last Year row is stored on its own week
  (−364 days), so a 2026 export fills 2025 and 2026 and last year is read by date.
  The workbook ships cases; rows keep `cases` and convert to `units` by the item's case
  pack (price list first, then the pack in the description), null when unknown. Only
  weeks with shipments are stored. Publix is a shipments-only account with no NIQ
  market. `lib/weeks.ts` is the week calendar and the only place year-ago arithmetic lives:
  `yearAgoWeek` (−364 days) for dates, `comparableYearAgo` (null for a 53rd week) for
  comparisons, `priorYearWeek` (a 53rd week borrows last year's final week) for carried
  shape, `saturdaysOfYear` for the week axis. Next 53-week years: 2028, 2033, 2039.
- **Global scope**: the topbar's five cascading selectors (lib/scope.ts + components/ScopeBar)
  persist in the `hh-scope` cookie; server pages call `getScope()` (lib/server/scope.ts) and
  intersect their reads with `marketCodes` / `telusCustomerIds`. New views must do the same.
  lib/scope.ts is pure — every function takes the crosswalk rows — and the rows come from the
  `customer_crosswalk` + `crosswalk_telus_customers` tables through `getCustomerCrosswalk()`
  (the root layout hands them to the topbar; `telusIdsForMarkets()` answers the Telus ids
  behind a market). The fixture is the loader's source (re-run scripts/ingest_crosswalk.py
  after replacing the raw workbook, then Load it), never read by a page.
- **Everything a page shows comes from the database.** Reference data that used to be code
  or a fixture is a table the loader fills and the repo reads: `market_promo_customers`
  (division ↔ Telus customer, with `dist_name` for shared planners; pure helpers in
  lib/promoMap.ts), `promo_enums` (the export's Valid Values), `promo_import_batches` (the
  snapshot's source file and export date), and the Heartland brand list is
  `listHeartlandBrands()` = the brands of `items.is_own` (BRAND_ORDER in the repo is only
  display order). Pages that read data are rendered on request, never frozen at build. The
  repo fixtures remain as the loader's source and as the fallback when a table read fails;
  every such fallback is remembered and shown on the Integrations screen and in
  `/api/health` (`data.fallbacks`), so a page quietly answering from a file is never a secret.
- Build-out order is Albertsons division by division; Randy directs which piece comes
  next. `docs/HANDOFF.md` holds the full teardown.
