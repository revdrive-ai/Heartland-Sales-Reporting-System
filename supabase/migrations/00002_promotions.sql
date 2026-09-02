-- Phase 2 — Telus promotions.
-- Mirrors the import template's two linked tables (join on promo_id) and its
-- recurring-refresh rules: upsert on promo_id / line_id, never hard-delete a
-- line that disappears from a later export (flag removed_at_source), and
-- record every export's snapshot date for auditable, replayable loads.

create table public.promo_import_batches (
  id            uuid primary key default gen_random_uuid(),
  source_file   text not null,
  snapshot_date date not null,       -- from the Telus export filename (MMDDYYYY)
  fiscal_year   integer not null,
  promo_count   integer,
  line_count    integer,
  planned_total numeric,
  actual_total  numeric,
  note          text,
  created_at    timestamptz not null default now()
);

create table public.promotions (
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
  removed_at_source boolean not null default false,
  last_batch_id     uuid references public.promo_import_batches (id),
  updated_at        timestamptz not null default now(),
  constraint promo_window check (end_date >= start_date)
);

create index promotions_customer on public.promotions (customer_id);
create index promotions_status on public.promotions (promo_status);
create index promotions_window on public.promotions (start_date, end_date);

comment on table public.promotions is
  'Promotion headers from the Telus export — who, what, when, status. The money lives on promo_lines; header rollups are computed, never stored.';

create table public.promo_lines (
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
  removed_at_source boolean not null default false,
  last_batch_id     uuid references public.promo_import_batches (id),
  updated_at        timestamptz not null default now()
);

create index promo_lines_promo on public.promo_lines (promo_id);
create index promo_lines_brand on public.promo_lines (brand);

comment on table public.promo_lines is
  'One component + item under a promotion — rates, planned $, actual spend. A line missing from a later export is flagged removed_at_source, never deleted.';

-- RLS: deny-by-default, authenticated read; only the service role writes
-- (imports) until role-based policies land with the Approvals phase.

alter table public.promo_import_batches enable row level security;
alter table public.promotions           enable row level security;
alter table public.promo_lines          enable row level security;

create policy "authenticated read" on public.promo_import_batches for select to authenticated using (true);
create policy "authenticated read" on public.promotions           for select to authenticated using (true);
create policy "authenticated read" on public.promo_lines          for select to authenticated using (true);
