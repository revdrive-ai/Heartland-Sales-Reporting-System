-- Plan-year promotion events — the forward book the Promotion Planner builds
-- for a future year (2027+) before it exists in Telus: entered by hand,
-- imported from the CSV year-plan template, or carried forward from the prior
-- year's Telus book. Once the year arrives in a Telus export, these rows are
-- the plan the imported actual book reconciles against. Held in localStorage
-- (hhPlanEvents, lib/repo/client.ts) until swap-in; seed from it if wanted.

create table public.plan_events (
  id               text primary key,
  plan_year        int  not null check (plan_year between 2024 and 2100),
  customer_id      text,                      -- Telus customer id when matched
  customer_name    text not null,
  brand            text not null default 'MIXED',
  title            text not null,
  performance_type text not null,
  start_date       date not null,
  end_date         date not null,
  spend            numeric not null check (spend >= 0),   -- planned trade $
  lift_pct         numeric,                   -- expected % lift over base; null = unset
  note             text,
  origin           text not null check (origin in ('manual', 'import', 'carry')),
  created_by       text,                      -- auth user id/email once auth lands
  created_at       timestamptz not null default now(),
  check (end_date >= start_date)
);

create index plan_events_year on public.plan_events (plan_year);
create index plan_events_customer on public.plan_events (plan_year, customer_id);

comment on table public.plan_events is
  'Forward promotion book per plan year, built in the Promotion Planner ahead of the Telus export.';

-- Per plan year x scope trade budget the planner''s spend bar measures against.
create table public.plan_budgets (
  budget_key text primary key,               -- "<year>|<scope label or all>"
  plan_year  int not null,
  amount     numeric not null check (amount >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.plan_events enable row level security;
alter table public.plan_budgets enable row level security;
create policy "authenticated read" on public.plan_events for select to authenticated using (true);
create policy "authenticated write" on public.plan_events for insert to authenticated with check (true);
create policy "authenticated update" on public.plan_events for update to authenticated using (true);
create policy "authenticated delete" on public.plan_events for delete to authenticated using (true);
create policy "authenticated read" on public.plan_budgets for select to authenticated using (true);
create policy "authenticated upsert" on public.plan_budgets for insert to authenticated with check (true);
create policy "authenticated update" on public.plan_budgets for update to authenticated using (true);
