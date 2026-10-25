# Supabase rebuild — report

Branch `rebuild/supabase-test`, October 2026. The app is re-pointed at a fresh
Supabase project and the database rebuilt from what the code actually touches.

- **New project:** Heartland Supabase Test, ref `hapqirzhfmaqkjdwwkwl`,
  https://hapqirzhfmaqkjdwwkwl.supabase.co
- **Old project:** Heartland Sales Reporting POC, ref `bsmeqxypfvtcubytvrpw` —
  schema reference only. The app is never pointed at it and no data is copied
  from it; data is reloaded from Fabric.

## 1 · Keep-list (13 tables, 1 function)

Found by grepping the code for every table it queries or upserts.

| Table | Who writes | Who reads |
| --- | --- | --- |
| `app_state` | the app (`/api/state`, service role) | the app — the ONE table the running app reads today |
| `signup_email_domains` + `hook_restrict_signup_by_email_domain()` | migration (one config row: `revdrive.ai`) | Supabase Auth, before-user-created hook |
| `markets`, `items`, `nielsen_weekly` | loaders (NIQ pull fixtures) | repo seam, once reads swap from fixtures |
| `promotions`, `promo_lines` | loaders (Telus export fixtures) | repo seam |
| `customer_crosswalk`, `crosswalk_telus_customers` | loaders (crosswalk workbook) | repo seam, global scope |
| `item_crosswalk`, `niq_item_attributes` | loaders (item crosswalk workbook) | repo seam |
| `price_list` | loaders (price list workbook) | repo seam |
| `shipments_weekly` | loaders (Retail Planner export) | repo seam |

"Loaders" = `scripts/load_supabase.py` and its in-app twin
`lib/server/supaload.ts` (Integrations → Load all). No view, RPC or other
table is referenced anywhere in code. No URL or key was hard-coded; the one
real bug was two URL variables (`SUPABASE_URL` for data, `NEXT_PUBLIC_SUPABASE_URL`
for auth) that could have pointed at two projects — fixed, one variable now.

## 2 · Left behind

**Authored in the old migrations, never touched by code** (11): `intake_batches`,
`nielsen_weekly_staging`, `intake_rejects`, `promo_import_batches`,
`alignment_nodes`, `alignment_meta`, `market_promo_customers` (the mapping is
`lib/data/albertsonsPromoMap.ts`), `plan_registrations`, `plan_adjustments`,
`plan_events`, `plan_budgets` (plan state is documents in `app_state`). With
them went the `batch_id` / `last_batch_id` columns the fixtures never filled,
the 13-row market seed in a migration, and an open insert policy on
`price_list` nothing used.

**In the old project, never in this repo** (21 tables, 3 views, 1 function):
the Fabric/Syspro set — `dim_customer`, `dim_product`, `dim_calendar`,
`dim_fiscal_period`, `dim_deduction_code`, `dim_ship_to`, `dim_contract_price`,
`dim_list_price`, `dim_item_price`, `dim_invoice`, `fact_shipments_weekly`,
`fact_shipments_monthly`, `fact_shipments_period`, `fact_shipments_contract`,
`fact_deductions`, `fact_orders_open`, `fact_trade_journal`,
`fact_invoice_lines`, `telus_cust_item`, `telus_planner`, `etl_load_log`;
views `v_deduction_invoice_link`, `v_telus_customer_map`,
`v_trade_expense_by_period`; function `rls_auto_enable()`. Decision (Randy,
option 1): the loader repo owns that DDL. When a view here starts reading one
of them (first candidate: `lib/server/salesFacts.ts` → an internal sales
table), its contract gets a migration in this repo at that time.

**Not carried:** the 20 `app_state` documents in the old project (plan events,
budgets, LE locks, plan versions). That is user-authored plan work, not Fabric
data, so it was not copied per the rule; if it is wanted it is a deliberate
one-off copy, not a loader step.

## 3 · Migrations written (and applied)

`supabase/migrations/`, nine files, applied to the test project through the
Supabase connector and verified: 13 tables, RLS on all 13, 11 authenticated-read
policies and no user write policy, 13 table comments, 2 column comments, 5 FKs,
Saturday checks on both weekly fact tables, the hook returns 403 for
`gmail.com` and `{}` for `revdrive.ai`.

| File | Creates |
| --- | --- |
| `00001_markets_items.sql` | `markets`, `items` |
| `00002_nielsen_weekly.sql` | `nielsen_weekly` |
| `00003_promotions.sql` | `promotions`, `promo_lines` |
| `00004_customer_crosswalk.sql` | `customer_crosswalk`, `crosswalk_telus_customers` |
| `00005_item_crosswalk.sql` | `item_crosswalk`, `niq_item_attributes` |
| `00006_price_list.sql` | `price_list` |
| `00007_shipments_weekly.sql` | `shipments_weekly` |
| `00008_app_state.sql` | `app_state` |
| `00009_auth_domain_lock.sql` | `signup_email_domains`, the hook |

`setup.sql` is the generated concatenation. The connector applied each file
without its `drop policy if exists` lines (its harness holds those for a
confirmation); on an empty project that is the same result, and the files keep
them so `setup.sql` stays safe to re-run.

## 4 · App wiring, gates, sweep

- `lib/supabase/env.ts` is the only place the connection is read:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` (server only). `.env.example` is the template.
- Gates: `tsc --noEmit` ✓, `eslint` ✓ (0 errors; 15 React-Compiler warnings
  that predate the branch, downgraded from error with a note in
  `eslint.config.mjs`), `next build` ✓, `knip` clean.
- Sweep: two unused modules, twenty unused exports, ~55 needless exports and
  fourteen stale comments removed. No unused route.
- Smoke test: the production build with the test project's public values
  fails closed with no session, refuses off-domain addresses before asking
  Supabase, and rejects a forged session cookie against the real project.

## 5 · What the loaders need next

The test project already carries the Fabric landing zone in its own schemas:
`syspro` (18 tables; `salhistorysource` ≈1.1M rows, `sordetail` ≈1M,
`tpmdeducttran` ≈483K, `tpmjournal` ≈254K, `tpmdeductionmaster` ≈122K),
`nielsen.weekly_item_ta` (≈651K), `telus.cust_item` (≈6K), `telus.planner`
(≈7K), `dot.dotinvoicedata` (≈79K). The `public` schema is the app's
contract. The next loader step is the transform from landing → `public`,
replacing the workbook drops one source at a time. Per table:

| Public table | Source in the landing zone | What the transform must do | Open point |
| --- | --- | --- | --- |
| `markets` | `nielsen.weekly_item_ta.market` | one row per TA; `code` is the app's `ALB-…` key, `ta_name` the NIQ name | the landing feed may carry more TAs than the 13 ALBSCO ones; only those with a `code` load, or `markets` grows deliberately |
| `items` | `weekly_item_ta` (upc, item, brand, manufacturer, super_category, category, sub_category) | `upc` is **bigint** in landing, **text with leading zeros** in `public` — zero-pad to the NIQ width before loading; `is_own` from manufacturer | confirm the pad width against `lib/fixtures/items.json` |
| `nielsen_weekly` | `weekly_item_ta` | rename: `avg_unit_price→price_per_unit`, `base_unit_price→base_price_per_unit`, `pct_acv_reach→acv_dist`, `promo_pct_acv→acv_any_promo`, `no_promo_units→nonpromo_units`; `market→market_code` via `markets.ta_name`; weeks are already Saturdays (the check enforces it) | landing has no feature/display/TPR ACV split (`acv_feature`, `acv_display`, `acv_feat_disp`, `acv_tpr`) — load null until NIQ adds them |
| `promotions`, `promo_lines` | `telus.cust_item` | header from `prog_id_base`, `prog_title`, `fiscal_year`, `prog_status`, `planner_id→customer_id`, `planner_title→customer_name`, `dist_id→customer_code`, `prog_perf_start/end_date`; lines from `component_name→component_type`, `rate_amount/uom`, `item_number`, `item_desc`, `brand`, `dist_name`; `dist_names` = distinct per header; **never store** line_count/planned/actual on the header | `cust_item` has no `performance_type`, `channel`, `market`, `planned_amount`, `actual_amount`, and `promotions` requires the first three (NOT NULL + check). Either the loader derives them (template → performance type, dist → channel) or the Telus feed is widened. Decide before the first load; the Retail Planner workbook flow stays until then |
| `customer_crosswalk` | workbook (`scripts/ingest_crosswalk.py`) for now | territory, parent/sales account, team and account lead are RevDrive hierarchy, not in Syspro | `syspro.arcustomer` (`customer`, `name`, `customerclass`, `area`, `masteraccount`, `salesperson`) can supply `customer_class` and a parent rollup later |
| `crosswalk_telus_customers` | `telus.cust_item.dist_id` ↔ `syspro.arcustomer.customer` | the old project's note: Telus `dist_id` **is** the Syspro customer code — a direct join replaces today's name matching | needs the crosswalk row keyed by Syspro code |
| `item_crosswalk`, `niq_item_attributes` | `syspro.invmaster` (`stockcode`, `description`, `alternatekey1/2`, `productclass`, `productgroup`) × `weekly_item_ta` item attributes | `upc_core` = digits only, leading zeros stripped, on both sides | which `invmaster` field carries the UPC/GTIN — confirm |
| `price_list` | `syspro.sorcontractprice` where buying group = `LI` (list) | `fg=stockcode`, `effective_from=startdate`, `case_price=fixedprice`; `unit_price` needs the case pack (`invmaster` conversion factor) | one row per item per effective date; `expirydate` closes a version |
| `shipments_weekly` | `syspro.salhistorysource` (`linetype=1`, `customer`, `stockcode`, `invoicedate`, `qtyinvoiced`) | sum cases to customer × item × **Saturday week-ending** of `invoicedate`; `account_code` via the crosswalk (`ALB-JEWEL`, `PUBLIX`); `units = cases × pack`; `source_row='actual'`, `source_file` = the extract name | replaces the Retail Planner workbook; the "last year on its own week" rule is then automatic |
| `app_state` | — | not loaded; starts empty, the app writes it | — |
| `dot.dotinvoicedata` | — | nothing in `public` consumes DOT yet (the Foodservice view is a stub) | leave in landing until that view is built |

Rules that bind every transform: Fabric is the source of truth; loaders write
`public` with the service role on the natural keys the migrations declare;
every Heartland system is read-only; never sum `PayValue` / `DeductTotal`;
rate views roll to `parent_code`; weeks end Saturday; promotion header
rollups are computed, never stored.

## 6 · Host settings only a person can do

1. Vercel → the preview/branch environment: set the three variables to the
   test project's values; remove any `SUPABASE_URL` / `SUPABASE_ANON_KEY`
   that still name the POC project. Production stays on `main`, untouched.
2. Supabase → Authentication → Hooks → Before User Created → Postgres →
   `public.hook_restrict_signup_by_email_domain`, enable. Until then the
   domain lock is not active.
3. Supabase → Authentication → Emails: the code templates and custom SMTP
   (`supabase/AUTH.md` §4–5), which the new project has none of.
4. Then sign in, open **Integrations**: health should read
   `backend: supabase, writable: true`, and *Load all* fills the eleven
   fixture tables while the Fabric transforms above are built.
