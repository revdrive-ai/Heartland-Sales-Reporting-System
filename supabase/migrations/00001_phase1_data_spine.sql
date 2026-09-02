-- Phase 1 — the Albertsons data spine.
-- Written ahead of the Supabase project so schema and app fixtures never
-- drift: lib/types/db.ts mirrors these columns and lib/fixtures/*.json
-- serialize them. Apply with `supabase db push` once the project exists.

-- ============================================================ DIMENSIONS

create table public.markets (
  code     text primary key,          -- e.g. 'ALB-JEWEL'
  name     text not null,             -- e.g. 'Albertsons Jewel-Osco'
  ta_name  text not null,             -- e.g. 'ALBSCO Jewel Div TA'
  active   boolean not null default false,  -- divisions come online one at a time
  created_at timestamptz not null default now()
);

comment on table public.markets is
  'The thirteen ALBSCO Albertsons division trading areas from the Nielsen Pull Spec.';

create table public.items (
  upc               text primary key,     -- full UPC as text so leading zeros survive
  nielsen_item_code text not null,
  brand             text not null,
  name              text not null,
  category          text not null,
  super_category    text not null,
  sub_category      text not null,
  base_units        numeric,              -- everyday weekly baseline (reference market)
  base_price        numeric,
  is_own            boolean not null default true,  -- ours vs the competitive set
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.items is
  'Item master (Category Key taxonomy). Includes competitive items — the pull contract deliberately covers the competitive set.';

-- =============================================================== INTAKE
-- Raw NIQ files land here exactly as sent: every field text, one row per
-- CSV line. Validation promotes rows to nielsen_weekly; failures go to
-- intake_rejects (the mockup's "intake quarantine").

create table public.intake_batches (
  id         uuid primary key default gen_random_uuid(),
  filename   text not null,
  market_code text,
  row_count  integer,
  status     text not null default 'received',  -- received | validated | promoted | rejected
  note       text,
  created_at timestamptz not null default now()
);

create table public.nielsen_weekly_staging (
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

create table public.intake_rejects (
  id         bigint generated always as identity primary key,
  batch_id   uuid not null references public.intake_batches (id) on delete cascade,
  staging_id bigint,
  reason     text not null,   -- e.g. 'week_ending is not a Saturday', 'unknown upc'
  raw        jsonb not null,
  created_at timestamptz not null default now()
);

-- ================================================================= FACTS

create table public.nielsen_weekly (
  id                  bigint generated always as identity primary key,
  week_ending         date not null,                                   -- always a Saturday
  nielsen_item_code   text not null,
  upc                 text not null references public.items (upc),
  market_code         text not null references public.markets (code),
  units               numeric not null,
  dollars             numeric not null,
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

create index nielsen_weekly_market_week on public.nielsen_weekly (market_code, week_ending);
create index nielsen_weekly_upc on public.nielsen_weekly (upc);

comment on table public.nielsen_weekly is
  'Validated NIQ weekly facts — one row per item x market x week, per the 25-column pull contract.';

-- ======================================================== ALIGNMENT KEY
-- Replaces the mockup''s localStorage hhAlign store. Append-friendly:
-- edits bump the shared version and are audit-logged in the app layer later.

create table public.alignment_nodes (
  id      text primary key,            -- 'ALN-001'
  ch      text not null check (ch in ('Retail', 'Food Service')),
  dv      text not null default '',    -- 'East' | 'West' | '' (food service)
  rg      text not null,
  nm      text not null,
  ty      text not null check (ty in ('Customer', 'State')),
  "on"    boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.alignment_meta (
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

create policy "authenticated read" on public.markets         for select to authenticated using (true);
create policy "authenticated read" on public.items           for select to authenticated using (true);
create policy "authenticated read" on public.intake_batches  for select to authenticated using (true);
create policy "authenticated read" on public.intake_rejects  for select to authenticated using (true);
create policy "authenticated read" on public.nielsen_weekly  for select to authenticated using (true);
create policy "authenticated read" on public.alignment_nodes for select to authenticated using (true);
create policy "authenticated read" on public.alignment_meta  for select to authenticated using (true);
