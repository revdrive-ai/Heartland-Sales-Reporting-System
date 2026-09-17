# Supabase runbook

**Connected project:** Heartland Sales Reporting POC — org REVDRIVE.AI INC,
ref `bsmeqxypfvtcubytvrpw` (https://bsmeqxypfvtcubytvrpw.supabase.co). Its
GitHub integration watches this repo's `main`; in practice it applied only
part of the schema, so run step 1's `setup.sql` paste as well — it is
idempotent and simply fills in whatever the integration missed.
The future auto-feed project will be a second, separate Supabase project.

How this app connects to Supabase, how CSV/Excel data gets in, and how the
future auto-feed project fits. The migrations in `migrations/` are canonical —
the same schema stands up any number of projects identically, and every schema
change is a new migration file, never a dashboard edit.

## 1 · Stand up the schema (once, ~5 minutes)

1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the whole of [`setup.sql`](./setup.sql) (the generated concatenation
   of migrations 00001–00011) and **Run**. It is **idempotent**: safe on a
   fresh project and equally safe where part of the schema already exists —
   existing tables, indexes, policies, and seed rows are left alone and only
   what's missing is created. It ends with a PostgREST schema-cache reload so
   the API sees new tables immediately.
3. Sanity check: **Table Editor** should list 22 tables (`markets`, `items`,
   `nielsen_weekly`, `promotions`, `promo_lines`, `price_list`, `app_state`, …),
   `markets` should hold the 13 seeded divisions, and
   `market_promo_customers` 25 seeded mapping rows.

RLS is enabled on every table with no anon policies (migration 00011): the
public/anon key can read nothing. The app talks to Supabase only through the
service role key from server code, which bypasses RLS.

CLI alternative: `supabase link --project-ref <ref>` then `supabase db push`
applies `migrations/` file by file and tracks them — the better habit once
schema changes become routine. Afterwards
`supabase gen types typescript --linked > lib/database.types.ts` generates the
typed client for the swap-in.

## 2 · Connect the app (makes shared plan state durable in production)

In the Vercel project (`heartland-sales-reporting-system`) → **Settings →
Environment Variables**, add for **Production** (and Preview if wanted):

| Name | Value | Where to find it |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** secret | Supabase → Settings → API → Project API keys |

Use the **service_role** key, not the anon key — and never expose it
client-side (the app only reads it in `lib/server/appstate.ts`).

Redeploy (Deployments → ⋯ → Redeploy). From that moment `/api/state` writes to
the `app_state` table: plan events, budgets, planner adjustments, plan-year
registrations and price edits are durable and shared for every user of the
deployed site. Anyone whose browser holds earlier plan work will have it
lifted into the shared store automatically on their first page load.

**Verify:** open the deployed Promotion Planner in a plan year, add or carry
an event, then check Supabase Table Editor → `app_state` — a row with key
`events:2027` should appear. Open the site in a private window: the same plan
shows.

## 3 · Load the data tables (preparation for the repo swap-in)

The views still read the repo fixtures today; loading the tables now means the
seam can swap to Supabase reads view by view with the data already in place.

```bash
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...
python3 scripts/load_supabase.py            # everything (~60K rows, a minute or two)
python3 scripts/load_supabase.py --dry-run  # row counts only
```

Everything upserts on natural keys (`nielsen_weekly` on week × UPC × market,
`promotions` on promo_id, `price_list` on FG × effective date, …) — re-running
is always safe and corrected files simply overwrite the same keys.

## 4 · Ongoing CSV / Excel drops — the two-stage flow

Stage one parses and validates; stage two loads. The fixture in git stays the
audit trail between them.

| Data | Drop the file, then run | Then |
| --- | --- | --- |
| NIQ weekly pull (CSV) | `scripts/ingest_albsco.py` → `data/nielsen/*.json.gz` | `load_supabase.py --only nielsen_weekly,items,markets` |
| Telus promo export | `scripts/ingest_promos.py` → `data/promos/*.json.gz` | `load_supabase.py --only promotions,promo_lines` |
| Item crosswalk workbook | `scripts/ingest_item_crosswalk.py` → `lib/fixtures/item-crosswalk.json` | `load_supabase.py --only item_crosswalk,niq_item_attributes` |
| Price list workbook | `scripts/ingest_price_list.py --effective YYYY-MM-DD` → `lib/fixtures/price-list.json` | `load_supabase.py --only price_list` |

Commit the fixture change and push — the deployed app picks the new data up on
the Vercel build, and the Supabase tables carry the same rows for the swap-in.

## 5 · What comes next (in order)

1. **Swap the reads** — change `lib/repo/index.ts` bodies from fs+fixture to
   typed Supabase queries, one function at a time, verifying each view against
   the fixture-backed numbers. No view code changes; that is what the seam is
   for. (`lib/server/appstate.ts` already prefers Supabase whenever the env
   vars exist.)
2. **Retire the fixture requirement** — once reads come from Supabase, a data
   drop no longer needs a commit + deploy; `load_supabase.py` alone updates
   the live app. Fixtures remain the parse-validation artifact and the local
   dev dataset.
3. **The auto-feed project** — stand up the second Supabase project with the
   same `migrations/` (step 1 verbatim). The schema already carries the feed
   plumbing: `intake_batches` + `nielsen_weekly_staging` + `intake_rejects`
   are the landing/quarantine tables for raw files, and `promo_import_batches`
   the same for Telus. Feeds write to staging, a promotion job validates into
   `nielsen_weekly` — the automated version of what `load_supabase.py` does by
   hand today. Pointing the app at it is a two-env-var change.

## Rules (unchanged)

- Never change schema in the dashboard. Every change is a new migration file
  (and regenerate `setup.sql` from the set).
- RLS stays enabled on every table.
- Only the service role writes until role-based policies land with the
  Approvals / LE phases.
