-- supabase/setup.sql — generated: the migrations in supabase/migrations/ concatenated
-- in order, for a one-paste stand-up in the SQL Editor. Idempotent. Do not edit;
-- regenerate after any migration change:
--   (cd supabase && for f in migrations/*.sql; do printf '\n-- ===== %s\n\n' "$f"; cat "$f"; done) > supabase/setup.sql  (plus this header)

-- ===== supabase/migrations/00001_markets_items.sql

-- Dimensions — the Albertsons division trading areas and the NIQ item master.
-- The schema is authored here first and applied to the project with
-- `supabase db push`; lib/types/db.ts mirrors these columns and
-- lib/fixtures/{markets,items}.json serialize them (scripts/ingest_albsco.py).
-- Loaded by scripts/load_supabase.py / lib/server/supaload.ts (upsert on the
-- primary key). Rows are never typed in here: data is loaded, not migrated.

create table if not exists public.markets (
  code       text primary key,                   -- e.g. 'ALB-JEWEL'
  name       text not null,                      -- e.g. 'Albertsons Jewel-Osco'
  ta_name    text not null,                      -- e.g. 'ALBSCO Jewel Div TA'
  active     boolean not null default false,     -- divisions come online one at a time
  created_at timestamptz not null default now()
);

comment on table public.markets is
  'The thirteen ALBSCO Albertsons division trading areas from the Nielsen Pull Spec.';

create table if not exists public.items (
  upc               text primary key,            -- full UPC as text so leading zeros survive
  nielsen_item_code text,                        -- not present in the ALBSCO pull; contract allows it
  name              text not null,               -- NIQ item description
  brand             text not null,               -- BRAND SHORT
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

-- RLS posture for the whole data spine: enabled everywhere, signed-in users
-- may read, nobody but the service role (server code, loaders) writes. The
-- anon key can read nothing.
alter table public.markets enable row level security;
alter table public.items   enable row level security;

drop policy if exists "authenticated read" on public.markets;
create policy "authenticated read" on public.markets for select to authenticated using (true);
drop policy if exists "authenticated read" on public.items;
create policy "authenticated read" on public.items   for select to authenticated using (true);

-- ===== supabase/migrations/00002_nielsen_weekly.sql

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

-- ===== supabase/migrations/00003_promotions.sql

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

-- ===== supabase/migrations/00004_customer_crosswalk.sql

-- Customer crosswalk — one customer tied together across systems.
-- Mirrors lib/fixtures/crosswalk.json (data/raw/Nielsen_crosswalk.xlsx via
-- scripts/ingest_crosswalk.py): the internal hierarchy that drives the global
-- scope selectors (Territory -> Parent Account -> Sales Account, Team Lead,
-- Account Lead), the NIQ trading-area match, and the name-matched Telus
-- customers. The loader splits the fixture's telus_customer_ids/_names arrays
-- into crosswalk_telus_customers rows.

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
  crosswalk_id        text not null references public.customer_crosswalk (id) on delete cascade,
  telus_customer_id   text not null,           -- promotions.customer_id
  telus_customer_name text not null,
  primary key (crosswalk_id, telus_customer_id)
);

comment on table public.crosswalk_telus_customers is
  'Telus customers (promotions.customer_id) name-matched to a customer_crosswalk row.';

alter table public.customer_crosswalk        enable row level security;
alter table public.crosswalk_telus_customers enable row level security;
drop policy if exists "authenticated read" on public.customer_crosswalk;
create policy "authenticated read" on public.customer_crosswalk        for select to authenticated using (true);
drop policy if exists "authenticated read" on public.crosswalk_telus_customers;
create policy "authenticated read" on public.crosswalk_telus_customers for select to authenticated using (true);

-- ===== supabase/migrations/00005_item_crosswalk.sql

-- Item crosswalk — one item tied together across systems: the Telus/Heartland
-- item number (the SKU on promotion lines) joined to the NIQ UPC, plus the
-- NIQ/HRT attribute hierarchy per item (brand, category, segment, form...).
-- Mirrors lib/fixtures/item-crosswalk.json (data/raw/Crosswalk_items_V1.xlsx
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
  hrt_type     text,                         -- HRT_* = Heartland's own hierarchy
  hrt_form     text,
  hrt_package  text,
  base_size    text,
  pack_size    text,
  flavor       text
);

comment on table public.niq_item_attributes is
  'NIQ Static attribute hierarchy per item — drives combining items by brand or segment across the tool.';

alter table public.item_crosswalk      enable row level security;
alter table public.niq_item_attributes enable row level security;
drop policy if exists "authenticated read" on public.item_crosswalk;
create policy "authenticated read" on public.item_crosswalk      for select to authenticated using (true);
drop policy if exists "authenticated read" on public.niq_item_attributes;
create policy "authenticated read" on public.niq_item_attributes for select to authenticated using (true);

-- ===== supabase/migrations/00006_price_list.sql

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

-- ===== supabase/migrations/00007_shipments_weekly.sql

-- Shipments (sell-in) by account × item × week — the Retail Planner export
-- (data/raw/Retail_Planner_-_*.xlsx via scripts/ingest_shipments.py, fixtures
-- in data/shipments/). One row per account × item × REAL week: weeks are
-- NIQ-style week-ending Saturdays so shipments line up with nielsen_weekly,
-- and the workbook's "Last Year" row is stored on its own week (the workbook
-- week minus 364 days), so a 2026 export fills 2025 and 2026 and "last year"
-- is read by date like every other year-ago figure in the app. Only weeks
-- with shipments are stored. The workbook ships CASES: cases is the figure
-- as shipped, units is cases × the item's case pack (the price list's
-- units_per_case, or the pack in the description), null where no pack is
-- known. Items are Heartland FG/SP codes; upc is filled where the item
-- crosswalk or price list ties the code to a NIQ item, and null until the
-- crosswalk is extended.
--
-- Shipments run weeks ahead of the NIQ edge, which is the gap the estimate
-- reads them for. An account can exist here with no NIQ market (Publix).

create table if not exists public.shipments_weekly (
  account_code   text not null,               -- market code where one exists (ALB-JEWEL), else the account's own (PUBLIX)
  account_name   text not null,
  item_code      text not null,               -- Heartland FG / SP code as the planner exports it
  item_name      text not null,
  upc            text,                        -- NIQ upc when tied, else null
  brand          text not null,               -- read from the description (SPLENDA, SLIMFAST, EQUAL, …)
  week_ending    date not null,               -- Saturday, the real week the cases shipped in
  cases          numeric not null default 0,  -- as the planner exports it
  units_per_case numeric,                     -- the pack the units were derived with
  units          numeric,                     -- cases × units_per_case; null when the pack is unknown
  pack_source    text check (pack_source in ('price_list', 'description')),
  source_row     text not null check (source_row in ('actual', 'last_year')),  -- which workbook row it came from (provenance only)
  source_file    text not null,
  loaded_at      timestamptz not null default now(),
  primary key (account_code, item_code, week_ending),
  constraint shipments_week_ending_is_saturday check (extract(isodow from week_ending) = 6)
);

create index if not exists shipments_weekly_account_week on public.shipments_weekly (account_code, week_ending);
create index if not exists shipments_weekly_upc on public.shipments_weekly (upc);

comment on table public.shipments_weekly is
  'Weekly shipments (sell-in) per account × item from the Retail Planner export; week_ending is the NIQ Saturday the units shipped in (last-year rows are stored on their own week).';

alter table public.shipments_weekly enable row level security;
drop policy if exists "authenticated read" on public.shipments_weekly;
create policy "authenticated read" on public.shipments_weekly for select to authenticated using (true);

-- ===== supabase/migrations/00008_app_state.sql

-- Shared app state: one JSON document per key, backing the client-side
-- stores (plan events per year, plan budgets, planner adjustments, plan-year
-- registrations, price edits, alignment key, LE locks and plan versions)
-- through /api/state (lib/server/appstate.ts). This is the only table the
-- running app reads and writes, and it does so with the service role from
-- server code only — so RLS is on with no policies: the anon and
-- authenticated keys can neither read nor write a document.

create table if not exists public.app_state (
  key        text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_state is
  'Shared documents behind /api/state — plan events (events:<year>), budgets (budget), adjustments (adj:<market>:<year>), registrations (planreg), price edits (priceedits), alignment (align).';

alter table public.app_state enable row level security;

-- ===== supabase/migrations/00009_auth_domain_lock.sql

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
-- It does not take effect until that is done. The seeded row is
-- configuration, not data: with the table empty nobody can sign up.

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
  addr         text;
  email_domain text;
  allowed      int;
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

-- PostgREST picks up new tables immediately
notify pgrst, 'reload schema';
