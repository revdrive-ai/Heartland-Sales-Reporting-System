-- Price list — dated list prices per Heartland item (FG#). Prices change over
-- time, so rows are versioned by effective_from: the price in force on a date
-- is the row with the greatest effective_from <= that date. Loaded from
-- lib/fixtures/price-list.json (data/raw/Price_List.xlsx via
-- scripts/ingest_price_list.py --effective YYYY-MM-DD); later workbook
-- ingests append dated versions. Edits made on the Price List screen are held
-- in app_state (priceedits), not written here — this table is read-only to
-- users, like every other loaded table.

create table if not exists public.price_list (
  fg             text not null,              -- Heartland FG# / item number
  effective_from date not null,
  upc_core       text,                       -- normalized NIQ UPC ('' when TBD)
  item           text not null,
  brand          text not null,
  category       text,
  form           text,
  segment        text,
  units_per_case numeric,
  case_price     numeric,
  unit_price     numeric,                    -- the per-unit list price analysis uses
  source         text not null,              -- workbook filename
  note           text,                       -- why the price changed
  created_by     text,
  created_at     timestamptz not null default now(),
  primary key (fg, effective_from)
);

create index if not exists price_list_upc on public.price_list (upc_core);
create index if not exists price_list_effective on public.price_list (effective_from);

comment on table public.price_list is
  'Dated list prices per item — the pricing basis every analysis ties back to; versioned so price-change effects can be measured.';

alter table public.price_list enable row level security;
drop policy if exists "authenticated read" on public.price_list;
create policy "authenticated read" on public.price_list for select to authenticated using (true);
