-- Customer crosswalk — one customer tied together across systems.
-- Mirrors lib/fixtures/crosswalk.json (from data/raw/Nielsen_crosswalk.xlsx via
-- scripts/ingest_crosswalk.py): the internal hierarchy that drives the global
-- scope selectors (Territory -> Parent Account -> Sales Account, Team Lead,
-- Account Lead), the NIQ trading-area match, and the name-matched Telus
-- customers. Seed from the fixture at swap-in time.

create table public.customer_crosswalk (
  id             text primary key,          -- slug: customer name (+ market code when split by TA)
  customer_name  text not null,
  customer_class text not null check (customer_class in ('RT', 'CL')),  -- retail | club
  territory      text not null,
  parent_account text not null,
  sales_account  text not null,
  team_lead      text not null,
  account_lead   text not null,
  niq_match      text,                      -- NIQ TA name; a sales account covering two TAs has two rows
  market_code    text references public.markets (code),  -- when we hold that TA's data
  updated_at     timestamptz not null default now()
);

create index customer_crosswalk_parent on public.customer_crosswalk (parent_account);
create index customer_crosswalk_territory on public.customer_crosswalk (territory);

comment on table public.customer_crosswalk is
  'The reporting hierarchy behind the global scope selectors, tying customers across the internal structure, NIQ trading areas and Telus.';

-- Telus customers matched to a crosswalk row by normalized name (one row per
-- crosswalk row x telus customer id).
create table public.crosswalk_telus_customers (
  crosswalk_id      text not null references public.customer_crosswalk (id) on delete cascade,
  telus_customer_id text not null,           -- promotions.customer_id
  telus_customer_name text not null,
  primary key (crosswalk_id, telus_customer_id)
);

alter table public.customer_crosswalk enable row level security;
alter table public.crosswalk_telus_customers enable row level security;
create policy "authenticated read" on public.customer_crosswalk for select to authenticated using (true);
create policy "authenticated read" on public.crosswalk_telus_customers for select to authenticated using (true);
