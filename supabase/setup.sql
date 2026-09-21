-- ============================================================================
-- ONE-PASTE SETUP — generated concatenation of supabase/migrations/00001..00012
-- Paste this whole file into the Supabase SQL Editor and Run. Idempotent:
-- safe on a fresh project AND on one where part of the schema already exists —
-- existing tables/indexes/policies/seed rows are left alone, missing ones are
-- created. The individual migration files stay canonical; regenerate with:
--   cat supabase/migrations/*.sql > supabase/setup.sql   (plus this header
--   and the trailing schema-cache reload)
-- ============================================================================

-- Phase 1 — the Albertsons data spine.
-- Written ahead of the Supabase project so schema and app fixtures never
-- drift: lib/types/db.ts mirrors these columns and lib/fixtures/*.json
-- serialize them. Apply with `supabase db push` once the project exists.

-- ============================================================ DIMENSIONS

create table if not exists public.markets (
  code     text primary key,          -- e.g. 'ALB-JEWEL'
  name     text not null,             -- e.g. 'Albertsons Jewel-Osco'
  ta_name  text not null,             -- e.g. 'ALBSCO Jewel Div TA'
  active   boolean not null default false,  -- divisions come online one at a time
  created_at timestamptz not null default now()
);

comment on table public.markets is
  'The thirteen ALBSCO Albertsons division trading areas from the Nielsen Pull Spec.';

create table if not exists public.items (
  upc               text primary key,     -- full UPC as text so leading zeros survive
  nielsen_item_code text,                 -- not present in the ALBSCO pull; contract allows it
  name              text not null,        -- NIQ item description
  brand             text not null,        -- BRAND SHORT
  manufacturer      text not null,
  super_category    text not null,
  category          text not null,
  sub_category      text not null,
  is_own            boolean not null default true,  -- HFPG vs the competitive set
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.items is
  'Item master (Category Key taxonomy). Includes competitive items — the pull contract deliberately covers the competitive set.';

-- =============================================================== INTAKE
-- Raw NIQ files land here exactly as sent: every field text, one row per
-- CSV line. Validation promotes rows to nielsen_weekly; failures go to
-- intake_rejects (the mockup's "intake quarantine").

create table if not exists public.intake_batches (
  id         uuid primary key default gen_random_uuid(),
  filename   text not null,
  market_code text,
  row_count  integer,
  status     text not null default 'received',  -- received | validated | promoted | rejected
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.nielsen_weekly_staging (
  id                  bigint generated always as identity primary key,
  batch_id            uuid not null references public.intake_batches (id) on delete cascade,
  -- the 25 contract columns, verbatim and untyped (see lib/data/nielsenPull.ts)
  week_ending         text,
  nielsen_item_code   text,
  upc                 text,
  market_code         text,
  market_name         text,
  units               text,
  dollars             text,
  base_units          text,
  base_dollars        text,
  price_per_unit      text,
  eq_units            text,
  base_price_per_unit text,
  incr_units          text,
  incr_dollars        text,
  acv_dist            text,
  tdp                 text,
  acv_any_promo       text,
  acv_feature         text,
  acv_display         text,
  acv_feat_disp       text,
  acv_tpr             text,
  promo_units         text,
  nonpromo_units      text,
  brand               text,
  category            text
);

create table if not exists public.intake_rejects (
  id         bigint generated always as identity primary key,
  batch_id   uuid not null references public.intake_batches (id) on delete cascade,
  staging_id bigint,
  reason     text not null,   -- e.g. 'week_ending is not a Saturday', 'unknown upc'
  raw        jsonb not null,
  created_at timestamptz not null default now()
);

-- ================================================================= FACTS

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
  batch_id            uuid references public.intake_batches (id),
  loaded_at           timestamptz not null default now(),
  constraint nielsen_weekly_natural_key unique (week_ending, upc, market_code),
  constraint week_ending_is_saturday check (extract(isodow from week_ending) = 6)
);

create index if not exists nielsen_weekly_market_week on public.nielsen_weekly (market_code, week_ending);
create index if not exists nielsen_weekly_upc on public.nielsen_weekly (upc);

comment on table public.nielsen_weekly is
  'Validated NIQ weekly facts — one row per item x market x week, per the 25-column pull contract.';

-- ======================================================== ALIGNMENT KEY
-- Replaces the mockup''s localStorage hhAlign store. Append-friendly:
-- edits bump the shared version and are audit-logged in the app layer later.

create table if not exists public.alignment_nodes (
  id      text primary key,            -- 'ALN-001'
  ch      text not null check (ch in ('Retail', 'Food Service')),
  dv      text not null default '',    -- 'East' | 'West' | '' (food service)
  rg      text not null,
  nm      text not null,
  ty      text not null check (ty in ('Customer', 'State')),
  "on"    boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.alignment_meta (
  id      boolean primary key default true check (id),  -- single row
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- ==================================================================== RLS
-- Deny-by-default: RLS on everywhere, authenticated users may read.
-- Write policies arrive with roles (Approvals / LE editing) in a later phase;
-- until then only the service role writes (imports, seeds).

alter table public.markets                enable row level security;
alter table public.items                  enable row level security;
alter table public.intake_batches         enable row level security;
alter table public.nielsen_weekly_staging enable row level security;
alter table public.intake_rejects         enable row level security;
alter table public.nielsen_weekly         enable row level security;
alter table public.alignment_nodes        enable row level security;
alter table public.alignment_meta         enable row level security;

drop policy if exists "authenticated read" on public.markets;
create policy "authenticated read" on public.markets         for select to authenticated using (true);
drop policy if exists "authenticated read" on public.items;
create policy "authenticated read" on public.items           for select to authenticated using (true);
drop policy if exists "authenticated read" on public.intake_batches;
create policy "authenticated read" on public.intake_batches  for select to authenticated using (true);
drop policy if exists "authenticated read" on public.intake_rejects;
create policy "authenticated read" on public.intake_rejects  for select to authenticated using (true);
drop policy if exists "authenticated read" on public.nielsen_weekly;
create policy "authenticated read" on public.nielsen_weekly  for select to authenticated using (true);
drop policy if exists "authenticated read" on public.alignment_nodes;
create policy "authenticated read" on public.alignment_nodes for select to authenticated using (true);
drop policy if exists "authenticated read" on public.alignment_meta;
create policy "authenticated read" on public.alignment_meta  for select to authenticated using (true);

-- Phase 2 — Telus promotions.
-- Mirrors the import template's two linked tables (join on promo_id) and its
-- recurring-refresh rules: upsert on promo_id / line_id, never hard-delete a
-- line that disappears from a later export (flag removed_at_source), and
-- record every export's snapshot date for auditable, replayable loads.

create table if not exists public.promo_import_batches (
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
  removed_at_source boolean not null default false,
  last_batch_id     uuid references public.promo_import_batches (id),
  updated_at        timestamptz not null default now(),
  constraint promo_window check (end_date >= start_date)
);

create index if not exists promotions_customer on public.promotions (customer_id);
create index if not exists promotions_status on public.promotions (promo_status);
create index if not exists promotions_window on public.promotions (start_date, end_date);

comment on table public.promotions is
  'Promotion headers from the Telus export — who, what, when, status. The money lives on promo_lines; header rollups are computed, never stored.';

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
  removed_at_source boolean not null default false,
  last_batch_id     uuid references public.promo_import_batches (id),
  updated_at        timestamptz not null default now()
);

create index if not exists promo_lines_promo on public.promo_lines (promo_id);
create index if not exists promo_lines_brand on public.promo_lines (brand);

comment on table public.promo_lines is
  'One component + item under a promotion — rates, planned $, actual spend. A line missing from a later export is flagged removed_at_source, never deleted.';

-- RLS: deny-by-default, authenticated read; only the service role writes
-- (imports) until role-based policies land with the Approvals phase.

alter table public.promo_import_batches enable row level security;
alter table public.promotions           enable row level security;
alter table public.promo_lines          enable row level security;

drop policy if exists "authenticated read" on public.promo_import_batches;
create policy "authenticated read" on public.promo_import_batches for select to authenticated using (true);
drop policy if exists "authenticated read" on public.promotions;
create policy "authenticated read" on public.promotions           for select to authenticated using (true);
drop policy if exists "authenticated read" on public.promo_lines;
create policy "authenticated read" on public.promo_lines          for select to authenticated using (true);

-- Nielsen division TA <-> Telus customer mapping for the Albertsons family.
-- Mirrors lib/data/albertsonsPromoMap.ts: division-level Telus customers per
-- trading area, plus the corporate account (Safeway, Inc. SAF100) whose
-- promotions apply across every division. Drives the promo-window overlay on
-- the Nielsen weekly trend.

create table if not exists public.market_promo_customers (
  market_code text not null references public.markets (code),
  customer_id text not null,                 -- Telus planner/customer id
  scope       text not null default 'division' check (scope in ('division', 'corporate')),
  note        text,
  primary key (market_code, customer_id)
);

comment on table public.market_promo_customers is
  'Which Telus customers'' promotions overlay which Nielsen division trading area. Corporate rows apply to every division.';

-- Seed the thirteen division trading areas first — the mapping rows below
-- reference them by FK, and on a fresh project nothing else has loaded them
-- yet. Values mirror lib/fixtures/markets.json; the data loader upserts the
-- same rows, so drift is impossible.
insert into public.markets (code, name, ta_name, active) values
  ('ALB-ACME',      'Albertsons Acme',          'ALBSCO Acme TA',              true),
  ('ALB-DENVER',    'Albertsons Denver',        'ALBSCO Denver Div TA',        true),
  ('ALB-EASTERN',   'Albertsons Eastern',       'ALBSCO Eastern TA',           true),
  ('ALB-INTMTN',    'Albertsons Intermountain', 'ALBSCO Intermountain Div TA', true),
  ('ALB-JEWEL',     'Albertsons Jewel-Osco',    'ALBSCO Jewel Div TA',         true),
  ('ALB-NORCAL',    'Albertsons Nor Cal',       'ALBSCO Nor Cal Div TA',       true),
  ('ALB-PORTLAND',  'Albertsons Portland',      'ALBSCO Portland Div TA',      true),
  ('ALB-SEATTLE',   'Albertsons Seattle',       'ALBSCO Seattle Div TA',       true),
  ('ALB-SHAWS',     'Albertsons Shaws',         'ALBSCO Shaws Div TA',         true),
  ('ALB-SOUTHERN',  'Albertsons Southern',      'ALBSCO Southern Div TA',      true),
  ('ALB-SOUTHWEST', 'Albertsons Southwest',     'ALBSCO Southwest Div TA',     true),
  ('ALB-UNITED',    'Albertsons United',        'ALBSCO United Div TA',        true),
  ('ALB-VONS',      'Albertsons Vons SoCal',    'ALBSCO So Cal Div TA',        true)
on conflict (code) do nothing;

insert into public.market_promo_customers (market_code, customer_id, scope, note) values
  ('ALB-ACME',      '000-1000252', 'division', 'Safeway Mid-Atlantic (ACM100) — Acme banner'),
  ('ALB-DENVER',    '000-1000203', 'division', 'Safeway Mountain West (covers Denver + Intermountain)'),
  ('ALB-INTMTN',    '000-1000203', 'division', 'Safeway Mountain West'),
  ('ALB-JEWEL',     '000-1000223', 'division', 'Jewel (JWL100)'),
  ('ALB-NORCAL',    '000-1000208', 'division', 'Safeway NorCal (SAF103)'),
  ('ALB-PORTLAND',  '000-1000209', 'division', 'Safeway Portland (SAF104)'),
  ('ALB-SEATTLE',   '000-1000210', 'division', 'Safeway Seattle (SAF105)'),
  ('ALB-SHAWS',     '000-1000221', 'division', 'Shaws Wells Grocery-Shaws (SHA100)'),
  ('ALB-VONS',      '000-1000211', 'division', 'Safeway SoCal (SAF106) — Vons banner'),
  ('ALB-SOUTHERN',  '000-1000212', 'division', 'Safeway Southern (SAF107)'),
  ('ALB-SOUTHWEST', '000-1000213', 'division', 'Safeway Southwest (SAF108)'),
  ('ALB-UNITED',    '000-1000291', 'division', 'United Supermarkets (UNI100)')
on conflict (market_code, customer_id) do nothing;

-- corporate account applies to every division (ALB-EASTERN has no division
-- customer in the book and is covered by corporate only)
insert into public.market_promo_customers (market_code, customer_id, scope, note)
select code, '000-1000214', 'corporate', 'Safeway, Inc. (SAF100) — corporate, all divisions'
from public.markets
on conflict (market_code, customer_id) do nothing;

alter table public.market_promo_customers enable row level security;
drop policy if exists "authenticated read" on public.market_promo_customers;
create policy "authenticated read" on public.market_promo_customers for select to authenticated using (true);

-- Customer crosswalk — one customer tied together across systems.
-- Mirrors lib/fixtures/crosswalk.json (from data/raw/Nielsen_crosswalk.xlsx via
-- scripts/ingest_crosswalk.py): the internal hierarchy that drives the global
-- scope selectors (Territory -> Parent Account -> Sales Account, Team Lead,
-- Account Lead), the NIQ trading-area match, and the name-matched Telus
-- customers. Seed from the fixture at swap-in time.

create table if not exists public.customer_crosswalk (
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

create index if not exists customer_crosswalk_parent on public.customer_crosswalk (parent_account);
create index if not exists customer_crosswalk_territory on public.customer_crosswalk (territory);

comment on table public.customer_crosswalk is
  'The reporting hierarchy behind the global scope selectors, tying customers across the internal structure, NIQ trading areas and Telus.';

-- Telus customers matched to a crosswalk row by normalized name (one row per
-- crosswalk row x telus customer id).
create table if not exists public.crosswalk_telus_customers (
  crosswalk_id      text not null references public.customer_crosswalk (id) on delete cascade,
  telus_customer_id text not null,           -- promotions.customer_id
  telus_customer_name text not null,
  primary key (crosswalk_id, telus_customer_id)
);

alter table public.customer_crosswalk enable row level security;
alter table public.crosswalk_telus_customers enable row level security;
drop policy if exists "authenticated read" on public.customer_crosswalk;
create policy "authenticated read" on public.customer_crosswalk for select to authenticated using (true);
drop policy if exists "authenticated read" on public.crosswalk_telus_customers;
create policy "authenticated read" on public.crosswalk_telus_customers for select to authenticated using (true);

-- Plan-year registrations — the log behind "Plan the next year" in the
-- Base & Lift Lab. One row per customer (division) x plan year, stamped the
-- first time that customer's plan view is opened. Held in localStorage
-- (hhPlanReg, lib/repo/client.ts) until swap-in; seed from it if wanted.

create table if not exists public.plan_registrations (
  market_code   text not null references public.markets (code),
  plan_year     int  not null check (plan_year between 2024 and 2100),
  registered_by text,                                  -- auth user id/email once auth lands
  registered_at timestamptz not null default now(),
  primary key (market_code, plan_year)
);

create index if not exists plan_registrations_year on public.plan_registrations (plan_year);

comment on table public.plan_registrations is
  'Which customers have been registered into a plan year from the Base & Lift Lab planning view.';

alter table public.plan_registrations enable row level security;
drop policy if exists "authenticated read" on public.plan_registrations;
create policy "authenticated read" on public.plan_registrations for select to authenticated using (true);
drop policy if exists "authenticated register" on public.plan_registrations;
create policy "authenticated register" on public.plan_registrations for insert to authenticated with check (true);

-- Planner adjustments — the levers a planner pulls on a plan year's projected
-- base in the Base & Lift Lab: distribution gained/lost (e.g. "lost
-- distribution in the largest stores"), a coming base price change, or a
-- recent-trend override. One row per adjustment, scoped to an item (or the
-- whole brand) at one customer for one plan year; pct is the expected signed
-- % impact on base volume inside the effective window. Held in localStorage
-- (hhPlanAdj, lib/repo/client.ts) until swap-in; seed from it if wanted.

create table if not exists public.plan_adjustments (
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

create index if not exists plan_adjustments_scope on public.plan_adjustments (market_code, plan_year, brand);

comment on table public.plan_adjustments is
  'Planner base-volume adjustments (distribution / price / trend) applied to plan-year projections in the Base & Lift Lab.';

alter table public.plan_adjustments enable row level security;
drop policy if exists "authenticated read" on public.plan_adjustments;
create policy "authenticated read" on public.plan_adjustments for select to authenticated using (true);
drop policy if exists "authenticated write" on public.plan_adjustments;
create policy "authenticated write" on public.plan_adjustments for insert to authenticated with check (true);
drop policy if exists "authenticated delete" on public.plan_adjustments;
create policy "authenticated delete" on public.plan_adjustments for delete to authenticated using (true);

-- Plan-year promotion events — the forward book the Promotion Planner builds
-- for a future year (2027+) before it exists in Telus: entered by hand,
-- imported from the CSV year-plan template, or carried forward from the prior
-- year's Telus book. Once the year arrives in a Telus export, these rows are
-- the plan the imported actual book reconciles against. Held in localStorage
-- (hhPlanEvents, lib/repo/client.ts) until swap-in; seed from it if wanted.

create table if not exists public.plan_events (
  id               text primary key,
  plan_year        int  not null check (plan_year between 2024 and 2100),
  customer_id      text,                      -- Telus customer id when matched
  customer_name    text not null,
  brand            text not null default 'MIXED',
  title            text not null,
  performance_type text not null,
  start_date       date not null,
  end_date         date not null,
  spend            numeric not null check (spend >= 0),   -- planned trade $
  lift_pct         numeric,                   -- expected % lift over base; null = unset
  items            text[] not null default '{}',          -- UPCs on the deal; empty = whole brand
  funding_oi       numeric,                   -- $/unit off-invoice rate behind spend
  funding_scan     numeric,                   -- $/unit scan rate
  funding_fixed    numeric,                   -- fixed fees $
  note             text,
  origin           text not null check (origin in ('manual', 'import', 'carry')),
  created_by       text,                      -- auth user id/email once auth lands
  created_at       timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists plan_events_year on public.plan_events (plan_year);
create index if not exists plan_events_customer on public.plan_events (plan_year, customer_id);

comment on table public.plan_events is
  'Forward promotion book per plan year, built in the Promotion Planner ahead of the Telus export.';

-- Per plan year x scope trade budget the planner''s spend bar measures against.
create table if not exists public.plan_budgets (
  budget_key text primary key,               -- "<year>|<scope label or all>"
  plan_year  int not null,
  amount     numeric not null check (amount >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.plan_events enable row level security;
alter table public.plan_budgets enable row level security;
drop policy if exists "authenticated read" on public.plan_events;
create policy "authenticated read" on public.plan_events for select to authenticated using (true);
drop policy if exists "authenticated write" on public.plan_events;
create policy "authenticated write" on public.plan_events for insert to authenticated with check (true);
drop policy if exists "authenticated update" on public.plan_events;
create policy "authenticated update" on public.plan_events for update to authenticated using (true);
drop policy if exists "authenticated delete" on public.plan_events;
create policy "authenticated delete" on public.plan_events for delete to authenticated using (true);
drop policy if exists "authenticated read" on public.plan_budgets;
create policy "authenticated read" on public.plan_budgets for select to authenticated using (true);
drop policy if exists "authenticated upsert" on public.plan_budgets;
create policy "authenticated upsert" on public.plan_budgets for insert to authenticated with check (true);
drop policy if exists "authenticated update" on public.plan_budgets;
create policy "authenticated update" on public.plan_budgets for update to authenticated using (true);

-- Item crosswalk — one item tied together across systems: the Telus/Heartland
-- item number (the SKU on promotion lines) joined to the NIQ UPC, plus the
-- NIQ/HRT attribute hierarchy per item (brand, category, segment, form...).
-- Mirrors lib/fixtures/item-crosswalk.json (from data/raw/Crosswalk_items_V1.xlsx
-- via scripts/ingest_item_crosswalk.py). Join key everywhere is upc_core:
-- digits only, leading zeros stripped (the Heartland tab's trailing check
-- digit dropped) — public.items.upc stripped of leading zeros equals it.

create table if not exists public.item_crosswalk (
  item_number   text not null,               -- Telus SKU (promo_lines.item_number)
  upc_core      text not null,               -- normalized NIQ UPC
  brand         text not null,
  business_unit text,
  description   text,
  primary key (item_number, upc_core)
);

create index if not exists item_crosswalk_upc on public.item_crosswalk (upc_core);

comment on table public.item_crosswalk is
  'Telus/Heartland item numbers joined to NIQ UPCs — lets promotion lines score against NIQ item volume.';

create table if not exists public.niq_item_attributes (
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
drop policy if exists "authenticated read" on public.item_crosswalk;
create policy "authenticated read" on public.item_crosswalk for select to authenticated using (true);
drop policy if exists "authenticated read" on public.niq_item_attributes;
create policy "authenticated read" on public.niq_item_attributes for select to authenticated using (true);

-- Price list — dated list prices per Heartland item (FG#). Prices change over
-- time, so rows are versioned by effective_from: the price in force on a date
-- is the row with the greatest effective_from <= that date. Seeded from
-- lib/fixtures/price-list.json (data/raw/Price_List.xlsx via
-- scripts/ingest_price_list.py, initial list effective 2026-01-01); later
-- workbook ingests append dated versions, and per-item UI edits insert rows
-- with source 'manual' (held in localStorage hhPriceEdits until swap-in).

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
  source         text not null,              -- workbook filename, or 'manual'
  note           text,                       -- why the price changed (manual edits)
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
drop policy if exists "authenticated write" on public.price_list;
create policy "authenticated write" on public.price_list for insert to authenticated with check (true);

-- Shared app state: one JSON document per key, backing the client-side
-- stores (plan events per year, plan budgets, planner adjustments, plan-year
-- registrations, price edits, alignment key) through /api/state. This is the
-- pragmatic bridge that makes planner work durable and shared across users;
-- the normalized tables in 00005–00007 and 00009 remain the eventual schema,
-- and can be seeded from these documents at swap-in time.

create table if not exists app_state (
  key         text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

comment on table app_state is
  'Shared documents behind /api/state — plan events (events:<year>), budgets (budget), adjustments (adj:<market>:<year>), registrations (planreg), price edits (priceedits), alignment (align).';

-- RLS lockdown — the app talks to Supabase exclusively through the service
-- role key from server code (lib/server/appstate.ts and, at swap-in, the repo
-- seam), and the service role bypasses row level security. Enabling RLS with
-- no anon policies means the project's anon/public key can read NOTHING,
-- which is the correct posture for a private trade tool. 00004 already gave
-- customer_crosswalk tables authenticated-read policies; they keep them.

alter table public.markets                   enable row level security;
alter table public.items                     enable row level security;
alter table public.intake_batches            enable row level security;
alter table public.nielsen_weekly_staging    enable row level security;
alter table public.intake_rejects            enable row level security;
alter table public.nielsen_weekly            enable row level security;
alter table public.alignment_nodes           enable row level security;
alter table public.alignment_meta            enable row level security;
alter table public.promo_import_batches      enable row level security;
alter table public.promotions                enable row level security;
alter table public.promo_lines               enable row level security;
alter table public.market_promo_customers    enable row level security;
alter table public.plan_registrations        enable row level security;
alter table public.plan_adjustments          enable row level security;
alter table public.plan_events               enable row level security;
alter table public.plan_budgets              enable row level security;
alter table public.item_crosswalk            enable row level security;
alter table public.niq_item_attributes       enable row level security;
alter table public.price_list                enable row level security;
alter table public.app_state                 enable row level security;

-- Dist Name from the raw Telus retail-promotions export: the distributor /
-- ship-to each component line bills through. It is the alignment key to the
-- customer crosswalk (59 of 64 values match customer_crosswalk.customer_name
-- exactly) and splits the shared Safeway Mountain West planner (000-1000203)
-- into Safeway Denver and Safeway IMW — the two NIQ divisions it covers.

alter table public.promo_lines add column if not exists dist_name text;
comment on column public.promo_lines.dist_name is
  'Telus export Dist Name — distributor/ship-to for this line; aligns to customer_crosswalk.customer_name and splits shared planners by division.';

alter table public.promotions add column if not exists dist_names text[];
comment on column public.promotions.dist_names is
  'Distinct Dist Names across the promotion''s lines (usually one; Safeway Mountain West promos carry Denver and/or IMW).';

-- Tell PostgREST to pick up the new tables immediately (clears PGRST205
-- "table not found in schema cache" without waiting for the cache to refresh).

-- =============================================== AUTH DOMAIN LOCK
-- Restrict who may ever become a user.
--
-- The app checks the email domain in its own sign-in route and again in the
-- middleware, but the anon key is public: anyone holding it can call
-- Supabase's auth endpoints directly. This is the control that actually
-- closes that door — a before-user-created hook that refuses to create an
-- account whose address is off-domain. Without it the other two layers are
-- only user experience.
--
-- After running this, enable it in the dashboard:
--   Authentication → Hooks → Before User Created →
--   Postgres → public.hook_restrict_signup_by_email_domain
-- It does not take effect until that is done.

create table if not exists public.signup_email_domains (
  domain     text primary key,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.signup_email_domains is
  'Email domains allowed to create an account. Empty table = nobody can sign up.';

insert into public.signup_email_domains (domain, note)
values ('revdrive.ai', 'RevDrive staff')
on conflict (domain) do nothing;

-- Only the auth admin may read this; it is not application data.
alter table public.signup_email_domains enable row level security;
revoke all on public.signup_email_domains from anon, authenticated;
grant select on public.signup_email_domains to supabase_auth_admin;

create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  addr        text;
  email_domain text;
  allowed     int;
begin
  addr := lower(trim(event -> 'user' ->> 'email'));
  email_domain := split_part(addr, '@', 2);

  -- no address, or something that isn't one: refuse
  if addr is null or email_domain = '' or addr like '%@%@%' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'A valid email address is required.',
        'http_code', 400
      )
    );
  end if;

  select count(*) into allowed
  from public.signup_email_domains d
  where lower(d.domain) = email_domain;

  if allowed > 0 then
    return '{}'::jsonb;   -- allow
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'message', 'This platform is limited to approved company email addresses.',
      'http_code', 403
    )
  );
end;
$$;

comment on function public.hook_restrict_signup_by_email_domain(jsonb) is
  'before-user-created auth hook: allows signup only from public.signup_email_domains.';

grant execute on function public.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain(jsonb) from anon, authenticated, public;

notify pgrst, 'reload schema';
