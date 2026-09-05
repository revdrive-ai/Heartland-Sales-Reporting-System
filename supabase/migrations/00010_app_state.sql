-- Shared app state: one JSON document per key, backing the client-side
-- stores (plan events per year, plan budgets, planner adjustments, plan-year
-- registrations, price edits, alignment key) through /api/state. This is the
-- pragmatic bridge that makes planner work durable and shared across users;
-- the normalized tables in 00005–00007 and 00009 remain the eventual schema,
-- and can be seeded from these documents at swap-in time.

create table if not exists app_state (
  key         text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

comment on table app_state is
  'Shared documents behind /api/state — plan events (events:<year>), budgets (budget), adjustments (adj:<market>:<year>), registrations (planreg), price edits (priceedits), alignment (align).';
