-- Price list — dated list prices per Heartland item (FG#). Prices change over
-- time, so rows are versioned by effective_from: the price in force on a date
-- is the row with the greatest effective_from <= that date. Seeded from
-- lib/fixtures/price-list.json (data/raw/Price_List.xlsx via
-- scripts/ingest_price_list.py, initial list effective 2026-01-01); later
-- workbook ingests append dated versions, and per-item UI edits insert rows
-- with source 'manual' (held in localStorage hhPriceEdits until swap-in).

create table public.price_list (
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
  source         text not null,              -- workbook filename, or 'manual'
  note           text,                       -- why the price changed (manual edits)
  created_by     text,
  created_at     timestamptz not null default now(),
  primary key (fg, effective_from)
);

create index price_list_upc on public.price_list (upc_core);
create index price_list_effective on public.price_list (effective_from);

comment on table public.price_list is
  'Dated list prices per item — the pricing basis every analysis ties back to; versioned so price-change effects can be measured.';

alter table public.price_list enable row level security;
create policy "authenticated read" on public.price_list for select to authenticated using (true);
create policy "authenticated write" on public.price_list for insert to authenticated with check (true);
