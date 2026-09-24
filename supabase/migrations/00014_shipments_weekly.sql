-- Shipments (sell-in) by account × item × week — the Retail Planner export
-- (data/raw/Retail_Planner_-_*.xlsx via scripts/ingest_shipments.py, fixtures
-- in data/shipments/). Weeks are stored as NIQ-style week-ending Saturdays so
-- shipments line up with nielsen_weekly; "last_year" rows are the workbook's
-- own aligned prior-year figures against the same week. Items are Heartland
-- FG/SP codes; upc is filled where the item crosswalk or price list ties the
-- code to a NIQ item, and null until the crosswalk is extended.
--
-- Shipments run weeks ahead of the NIQ edge, which is the gap the estimate
-- reads them for. An account can exist here with no NIQ market (Publix).

create table if not exists public.shipments_weekly (
  account_code text not null,               -- market code where one exists (ALB-JEWEL), else the account's own (PUBLIX)
  account_name text not null,
  item_code    text not null,               -- Heartland FG / SP code as the planner exports it
  item_name    text not null,
  upc          text,                        -- NIQ upc when tied, else null
  brand        text not null,               -- read from the description (SPLENDA, SLIMFAST, EQUAL, …)
  week_ending  date not null,               -- Saturday
  kind         text not null check (kind in ('actual', 'last_year')),
  units        numeric not null default 0,
  source_file  text not null,
  loaded_at    timestamptz not null default now(),
  primary key (account_code, item_code, week_ending, kind)
);

create index if not exists shipments_weekly_account_week on public.shipments_weekly (account_code, week_ending);
create index if not exists shipments_weekly_upc on public.shipments_weekly (upc);

comment on table public.shipments_weekly is
  'Weekly shipments (sell-in) per account × item from the Retail Planner export; week_ending is the NIQ Saturday; last_year rows are aligned to the same week.';

-- same posture as the rest of the spine: RLS on, no anon policy — only the
-- service role (server code) reads or writes
alter table public.shipments_weekly enable row level security;
