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
