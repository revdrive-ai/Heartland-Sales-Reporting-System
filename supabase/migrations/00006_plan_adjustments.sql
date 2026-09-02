-- Planner adjustments — the levers a planner pulls on a plan year's projected
-- base in the Base & Lift Lab: distribution gained/lost (e.g. "lost
-- distribution in the largest stores"), a coming base price change, or a
-- recent-trend override. One row per adjustment, scoped to an item (or the
-- whole brand) at one customer for one plan year; pct is the expected signed
-- % impact on base volume inside the effective window. Held in localStorage
-- (hhPlanAdj, lib/repo/client.ts) until swap-in; seed from it if wanted.

create table public.plan_adjustments (
  id             text primary key,
  market_code    text not null references public.markets (code),
  plan_year      int  not null check (plan_year between 2024 and 2100),
  brand          text not null,
  upc            text not null default 'ALL',     -- 'ALL' = every item of the brand
  kind           text not null check (kind in ('distribution', 'price', 'trend')),
  pct            numeric not null,                -- signed % impact on base volume
  effective_from date not null,
  effective_to   date not null,
  note           text,
  created_by     text,                            -- auth user id/email once auth lands
  created_at     timestamptz not null default now(),
  check (effective_to >= effective_from)
);

create index plan_adjustments_scope on public.plan_adjustments (market_code, plan_year, brand);

comment on table public.plan_adjustments is
  'Planner base-volume adjustments (distribution / price / trend) applied to plan-year projections in the Base & Lift Lab.';

alter table public.plan_adjustments enable row level security;
create policy "authenticated read" on public.plan_adjustments for select to authenticated using (true);
create policy "authenticated write" on public.plan_adjustments for insert to authenticated with check (true);
create policy "authenticated delete" on public.plan_adjustments for delete to authenticated using (true);
