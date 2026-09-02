-- Plan-year registrations — the log behind "Plan the next year" in the
-- Base & Lift Lab. One row per customer (division) x plan year, stamped the
-- first time that customer's plan view is opened. Held in localStorage
-- (hhPlanReg, lib/repo/client.ts) until swap-in; seed from it if wanted.

create table public.plan_registrations (
  market_code   text not null references public.markets (code),
  plan_year     int  not null check (plan_year between 2024 and 2100),
  registered_by text,                                  -- auth user id/email once auth lands
  registered_at timestamptz not null default now(),
  primary key (market_code, plan_year)
);

create index plan_registrations_year on public.plan_registrations (plan_year);

comment on table public.plan_registrations is
  'Which customers have been registered into a plan year from the Base & Lift Lab planning view.';

alter table public.plan_registrations enable row level security;
create policy "authenticated read" on public.plan_registrations for select to authenticated using (true);
create policy "authenticated register" on public.plan_registrations for insert to authenticated with check (true);
