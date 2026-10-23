-- Telus promotions — the two linked tables of the export (join on promo_id).
-- Produced by scripts/ingest_promos_raw.py into data/promos/*.json.gz; the
-- loader upserts on promo_id / line_id and drops the header rollups
-- (line_count, planned_amount, actual_amount) — those are computed from
-- promo_lines, never stored. A line missing from a later export is flagged
-- removed_at_source, never deleted. (The promo_import_batches audit table of
-- the design phase is gone; the export filename and snapshot date live in
-- data/promos/meta.json.)

create table if not exists public.promotions (
  promo_id          text primary key,          -- Telus 'Promo ID Base' (PRG-#######)
  promo_title       text not null,
  fiscal_year       integer not null,
  promo_status      text not null check (promo_status in ('Active', 'Expired', 'Expiring', 'Pre-Active')),
  template_type     text not null check (template_type in
    ('Off Invoice', 'Retail Non-Working', 'Retail Slotting', 'Retail Trade',
     'Wholesale Indirect', 'Wholesale Non-Working', 'Wholesale Trade')),
  performance_type  text not null check (performance_type in
    ('Display', 'EDLP', 'Feature', 'Feature & Display', 'Other',
     'Shopper Marketing', 'Slotting', 'TPR')),
  customer_id       text not null,             -- Telus 'planner' = customer/account
  customer_name     text not null,
  customer_code     text,
  channel           text not null check (channel in ('Direct', 'Wholesaler')),
  market            text not null check (market in ('US', 'Canada')),
  planner_template  text not null,             -- traceability back to Telus
  start_date        date not null,
  end_date          date not null,
  dist_names        text[],
  removed_at_source boolean not null default false,
  updated_at        timestamptz not null default now(),
  constraint promo_window check (end_date >= start_date)
);

create index if not exists promotions_customer on public.promotions (customer_id);
create index if not exists promotions_status on public.promotions (promo_status);
create index if not exists promotions_window on public.promotions (start_date, end_date);

comment on table public.promotions is
  'Promotion headers from the Telus export — who, what, when, status. The money lives on promo_lines; header rollups are computed, never stored.';
comment on column public.promotions.dist_names is
  'Distinct Dist Names across the promotion''s lines (usually one; Safeway Mountain West promos carry Denver and/or IMW).';

create table if not exists public.promo_lines (
  line_id           text primary key,          -- promo_id | component_type | item_number
  promo_id          text not null references public.promotions (promo_id),
  component_type    text not null check (component_type in
    ('Ad Fee', 'Administrative Fee', 'Billback Shipment', 'Demos', 'Display Fee',
     'Indirect BB', 'Markdowns', 'Off Invoice - Delivered', 'Off Invoice - FOB',
     'Post Audit', 'Pricing', 'Scan', 'Shopper Marketing', 'Slotting',
     'TPR Tag Fee', 'Write Off')),
  brand             text not null,
  item_number       text not null,             -- text — some codes carry leading letters/zeros
  item_description  text,
  rate              numeric not null default 0,  -- 0 is valid for lump-sum fee components
  rate_uom          text not null check (rate_uom in ('Case', 'Each', 'Percent', 'Lump Sum')),
  planned_amount    numeric not null default 0,
  actual_amount     numeric not null default 0,
  dist_name         text,
  removed_at_source boolean not null default false,
  updated_at        timestamptz not null default now()
);

create index if not exists promo_lines_promo on public.promo_lines (promo_id);
create index if not exists promo_lines_brand on public.promo_lines (brand);

comment on table public.promo_lines is
  'One component + item under a promotion — rates, planned $, actual spend. A line missing from a later export is flagged removed_at_source, never deleted.';
comment on column public.promo_lines.dist_name is
  'Telus export Dist Name — distributor/ship-to for this line; aligns to customer_crosswalk.customer_name and splits shared planners by division.';

alter table public.promotions  enable row level security;
alter table public.promo_lines enable row level security;

drop policy if exists "authenticated read" on public.promotions;
create policy "authenticated read" on public.promotions  for select to authenticated using (true);
drop policy if exists "authenticated read" on public.promo_lines;
create policy "authenticated read" on public.promo_lines for select to authenticated using (true);
