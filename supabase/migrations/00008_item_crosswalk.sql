-- Item crosswalk — one item tied together across systems: the Telus/Heartland
-- item number (the SKU on promotion lines) joined to the NIQ UPC, plus the
-- NIQ/HRT attribute hierarchy per item (brand, category, segment, form...).
-- Mirrors lib/fixtures/item-crosswalk.json (from data/raw/Crosswalk_items_V1.xlsx
-- via scripts/ingest_item_crosswalk.py). Join key everywhere is upc_core:
-- digits only, leading zeros stripped (the Heartland tab's trailing check
-- digit dropped) — public.items.upc stripped of leading zeros equals it.

create table public.item_crosswalk (
  item_number   text not null,               -- Telus SKU (promo_lines.item_number)
  upc_core      text not null,               -- normalized NIQ UPC
  brand         text not null,
  business_unit text,
  description   text,
  primary key (item_number, upc_core)
);

create index item_crosswalk_upc on public.item_crosswalk (upc_core);

comment on table public.item_crosswalk is
  'Telus/Heartland item numbers joined to NIQ UPCs — lets promotion lines score against NIQ item volume.';

create table public.niq_item_attributes (
  upc_core     text primary key,
  item         text not null,                -- NIQ item description
  brand        text not null,                -- NIQ BRAND SHORT
  category     text,
  sub_category text,
  segment      text,
  hrt_type     text,                         -- HRT_* = Heartland''s own hierarchy
  hrt_form     text,
  hrt_package  text,
  base_size    text,
  pack_size    text,
  flavor       text
);

comment on table public.niq_item_attributes is
  'NIQ Static attribute hierarchy per item — drives combining items by brand or segment across the tool.';

alter table public.item_crosswalk enable row level security;
alter table public.niq_item_attributes enable row level security;
create policy "authenticated read" on public.item_crosswalk for select to authenticated using (true);
create policy "authenticated read" on public.niq_item_attributes for select to authenticated using (true);
