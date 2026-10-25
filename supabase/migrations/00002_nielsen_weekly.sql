-- NIQ weekly facts — one row per item × market × week, the 25-column pull
-- contract. Produced by scripts/ingest_albsco.py (the column map lives there)
-- into data/nielsen/<MARKET>.json.gz; loaded on the natural key.
-- Weeks end on Saturday to match Nielsen — the check constraint enforces it.
-- (The intake/staging/reject tables of the design phase are gone: files are
-- validated by the ingest script before anything reaches this table.)

create table if not exists public.nielsen_weekly (
  id                  bigint generated always as identity primary key,
  week_ending         date not null,                                   -- always a Saturday
  nielsen_item_code   text,
  upc                 text not null references public.items (upc),
  market_code         text not null references public.markets (code),
  units               numeric,                    -- NIQ leaves some measures blank
  dollars             numeric,
  base_units          numeric,
  base_dollars        numeric,
  price_per_unit      numeric,
  eq_units            numeric,
  base_price_per_unit numeric,
  incr_units          numeric,
  incr_dollars        numeric,
  acv_dist            numeric,
  tdp                 numeric,
  acv_any_promo       numeric,
  acv_feature         numeric,
  acv_display         numeric,
  acv_feat_disp       numeric,
  acv_tpr             numeric,
  promo_units         numeric,
  nonpromo_units      numeric,
  loaded_at           timestamptz not null default now(),
  constraint nielsen_weekly_natural_key unique (week_ending, upc, market_code),
  constraint week_ending_is_saturday check (extract(isodow from week_ending) = 6)
);

create index if not exists nielsen_weekly_market_week on public.nielsen_weekly (market_code, week_ending);
create index if not exists nielsen_weekly_upc on public.nielsen_weekly (upc);

comment on table public.nielsen_weekly is
  'Validated NIQ weekly facts — one row per item x market x week, per the 25-column pull contract.';

alter table public.nielsen_weekly enable row level security;
drop policy if exists "authenticated read" on public.nielsen_weekly;
create policy "authenticated read" on public.nielsen_weekly for select to authenticated using (true);
