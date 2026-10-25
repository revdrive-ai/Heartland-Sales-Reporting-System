# Supabase runbook

**Connected project:** Heartland Supabase Test — org REVDRIVE.AI INC,
ref `hapqirzhfmaqkjdwwkwl` (https://hapqirzhfmaqkjdwwkwl.supabase.co).
The earlier POC project (`bsmeqxypfvtcubytvrpw`) is schema reference only:
never point the app at it, and never copy data out of it — data is reloaded
from Fabric.

How this app connects to Supabase, how the schema stands up, how data gets
in, and how the Fabric loader fits. The migrations in `migrations/` are
canonical — the same nine files stand up any number of projects identically,
and every schema change is a new migration file, never a dashboard edit.

## Architecture rules

- **Fabric is the single source of truth.** Loaders pull Fabric → Supabase;
  the app reads Supabase only; every Heartland system is read-only.
- The app's contract is the `public` schema: exactly what the code touches
  (see "What the schema is" below). The Fabric loader owns its own landing
  schemas (`syspro`, `nielsen`, `telus`, `dot`) and their DDL — they are not
  in this repo.
- Never sum `PayValue` / `DeductTotal` on `fact_deductions`; rate views roll
  to `parent_code`; weeks end Saturday to match Nielsen (the check
  constraints on `nielsen_weekly` and `shipments_weekly` enforce it);
  promotion header rollups are computed from `promo_lines`, never stored.

## 1 · Stand up the schema (once)

```bash
supabase link --project-ref hapqirzhfmaqkjdwwkwl
supabase db push            # applies migrations/ in order and records them
```

Or paste [`setup.sql`](./setup.sql) — the generated concatenation of the
migrations — into **SQL Editor → New query** and run it. It is idempotent:
safe on a fresh project and over any partial state.

Sanity check: **Table Editor** lists 13 public tables (`markets`, `items`,
`nielsen_weekly`, `promotions`, `promo_lines`, `customer_crosswalk`,
`crosswalk_telus_customers`, `item_crosswalk`, `niq_item_attributes`,
`price_list`, `shipments_weekly`, `app_state`, `signup_email_domains`), all
with RLS on, and `signup_email_domains` holds one row (`revdrive.ai`).

Then finish the sign-in setup in [`AUTH.md`](./AUTH.md) — above all
**enabling the before-user-created hook**, which the SQL creates but does
not switch on.

### What the schema is

| Table | Written by | Read by |
| --- | --- | --- |
| `markets`, `items`, `nielsen_weekly` | loader (NIQ pull fixtures) | repo seam (today from fixtures; swap-in pending) |
| `promotions`, `promo_lines` | loader (Telus export fixtures) | repo seam |
| `customer_crosswalk`, `crosswalk_telus_customers` | loader (crosswalk workbook) | repo seam / scope |
| `item_crosswalk`, `niq_item_attributes` | loader (item crosswalk workbook) | repo seam |
| `price_list` | loader (price list workbook) | repo seam |
| `shipments_weekly` | loader (Retail Planner export) | repo seam |
| `app_state` | the app, service role, via `/api/state` | the app |
| `signup_email_domains` + `hook_restrict_signup_by_email_domain()` | migration (one config row) | Supabase Auth |

RLS is on everywhere. Signed-in users may **read** the loaded tables and
nothing else; `app_state` has no policies at all (only the service role, from
server code, touches it). The anon key can read nothing.

Left behind on purpose from the design phase (never created here): the NIQ
intake/staging/reject tables, `promo_import_batches`, the alignment tables,
`market_promo_customers` (the mapping lives in `lib/data/albertsonsPromoMap.ts`)
and the normalized `plan_*` tables (plan state is documents in `app_state`).

## 2 · Connect the app

Which project the app talks to is **three environment variables and nothing
in code** — `lib/supabase/env.ts` is the only place they are read. Copy
`.env.example` to `.env.local` for development; on the host (Vercel today,
anywhere tomorrow) set them under the project's environment variables.

| Name | Value | Where to find it |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://hapqirzhfmaqkjdwwkwl.supabase.co` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon / publishable** key | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** secret | same page — server-side only, never `NEXT_PUBLIC_` |

One URL variable serves both sign-in and data, so they can never point at two
different projects. No key or URL is ever committed.

Redeploy. From then on `/api/state` writes to `app_state`: plan events,
budgets, planner adjustments, plan-year registrations and price edits are
durable and shared for every user. **Verify:** `/api/health` reports
`backend: "supabase", writable: true`; the **Integrations** screen shows the
same.

## 3 · Load the data tables

The views still read the repo fixtures today; loading the tables now means the
seam can swap to Supabase reads view by view with the data already in place.

**In the app (no terminal):** **Integrations → Load data to Supabase → Load
all**. It runs server-side where the credentials live, walks the tables in FK
order with visible progress, and each table has its own *Load* button.
(`/api/admin/load`, backed by `lib/server/supaload.ts` — keep its table
registry in step with `scripts/load_supabase.py`.)

**Or from a terminal:**

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://hapqirzhfmaqkjdwwkwl.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...
python3 scripts/load_supabase.py            # everything (~60K rows)
python3 scripts/load_supabase.py --dry-run  # row counts only
```

Everything upserts on natural keys (`nielsen_weekly` on week × UPC × market,
`promotions` on promo_id, `price_list` on FG × effective date, …) —
re-running is always safe and corrected files simply overwrite the same keys.

## 4 · Ongoing CSV / Excel drops — the two-stage flow

Stage one parses and validates; stage two loads. The fixture in git stays the
audit trail between them.

| Data | Drop the file, then run | Then |
| --- | --- | --- |
| NIQ weekly pull (CSV) | `scripts/ingest_albsco.py` → `data/nielsen/*.json.gz` | `load_supabase.py --only nielsen_weekly,items,markets` |
| Telus promo export (raw, with Dist Name) | `scripts/ingest_promos_raw.py` → `data/promos/*.json.gz` | `load_supabase.py --only promotions,promo_lines` |
| Telus promo import template (legacy transformed shape) | `scripts/ingest_promos.py` → `data/promos/*.json.gz` | `load_supabase.py --only promotions,promo_lines` |
| Item crosswalk workbook | `scripts/ingest_item_crosswalk.py` → `lib/fixtures/item-crosswalk.json` | `load_supabase.py --only item_crosswalk,niq_item_attributes` |
| Price list workbook | `scripts/ingest_price_list.py --effective YYYY-MM-DD` → `lib/fixtures/price-list.json` | `load_supabase.py --only price_list` |
| Retail Planner shipments export | `scripts/ingest_shipments.py` → `data/shipments/*.json.gz` | `load_supabase.py --only shipments_weekly` |
| Customer crosswalk workbook | `scripts/ingest_crosswalk.py` → `lib/fixtures/crosswalk.json` | `load_supabase.py --only customer_crosswalk,crosswalk_telus_customers` |

## 5 · What comes next (in order)

1. **Fabric feeds the public tables.** The loader already lands raw Syspro,
   NIQ, Telus and DOT extracts in their own schemas on this project. The next
   loader step is the transform from those into the `public` contract above
   (NIQ weekly → `nielsen_weekly`/`items`/`markets`, Telus → `promotions`/
   `promo_lines`, Syspro customers/items → the crosswalks and price list,
   Syspro sales history → `shipments_weekly`), replacing the workbook drops in
   § 4 one source at a time. The row shapes are fixed by `migrations/`.
2. **Swap the reads** — change `lib/repo/index.ts` bodies from fs+fixture to
   typed Supabase queries, one function at a time, verifying each view
   against the fixture-backed numbers. No view code changes; that is what
   the seam is for.
3. **Retire the fixture requirement** — once reads come from Supabase, a data
   refresh no longer needs a commit + deploy.

## Rules (unchanged)

- Never change schema in the dashboard. Every change is a new migration file
  (and regenerate `setup.sql` from the set — the header of that file has the
  one-liner).
- RLS stays enabled on every table.
- Only the service role writes until role-based policies land with the
  Approvals / LE phases.
