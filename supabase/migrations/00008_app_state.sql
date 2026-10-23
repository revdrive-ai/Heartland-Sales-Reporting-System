-- Shared app state: one JSON document per key, backing the client-side
-- stores (plan events per year, plan budgets, planner adjustments, plan-year
-- registrations, price edits, alignment key, LE locks and plan versions)
-- through /api/state (lib/server/appstate.ts). This is the only table the
-- running app reads and writes, and it does so with the service role from
-- server code only — so RLS is on with no policies: the anon and
-- authenticated keys can neither read nor write a document.

create table if not exists public.app_state (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_state is
  'Shared documents behind /api/state — plan events (events:<year>), budgets (budget), adjustments (adj:<market>:<year>), registrations (planreg), price edits (priceedits), alignment (align).';

alter table public.app_state enable row level security;
