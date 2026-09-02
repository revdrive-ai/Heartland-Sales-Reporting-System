# Supabase (not provisioned yet)

The database does not exist yet — by design. The schema is developed **as files,
ahead of the project**, so the app and the eventual database can't drift:

- `migrations/*.sql` — the schema, in apply order. Written in step with the UI.
- `lib/types/db.ts` (app) — TypeScript mirrors of these tables. Replaced by
  `supabase gen types typescript` output once the project exists.
- `lib/fixtures/*.json` (app) — data in exactly these column shapes. They back
  the app today through `lib/repo/` and become the seed source later.

## When the Supabase project is created

1. `supabase init` was intentionally **not** run; do `supabase link --project-ref <ref>`
   after installing the CLI, then `supabase db push` to apply `migrations/`.
2. Generate types: `supabase gen types typescript --linked > lib/database.types.ts`.
3. Seed dimensions from the fixtures (`lib/fixtures/markets.json`, `items.json`)
   and load `nielsen-weekly.alb-jewel.json` through the staging → validate →
   promote path, not straight into the fact table — that path is the product.
4. Swap the bodies of `lib/repo/index.ts` functions to typed Supabase queries.
   Nothing outside `lib/repo/` changes.

## Rules

- Never change schema in the dashboard. Every change is a new migration file.
- RLS stays enabled on every table from its first migration.
- Only the service role writes until role-based policies land with the
  Approvals / LE phases.
