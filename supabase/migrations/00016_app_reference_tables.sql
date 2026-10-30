-- Reference data the app used to carry as code or fixture files now lives in
-- the database, so every read is a database read:
--
--   market_promo_customers.dist_name  the Dist Name that splits a shared Telus
--                                     planner between two divisions (Safeway
--                                     Mountain West books Denver and IMW on one
--                                     planner) — was lib/data/albertsonsPromoMap
--   promo_enums                       the Telus export's Valid Values tab, one
--                                     row per field × value — was
--                                     lib/fixtures/promo-enums.json
--   promo_import_batches              gains a natural key so the loader can
--                                     upsert the snapshot's provenance (source
--                                     file, export date) — was data/promos/meta.json
--
-- Same posture as the rest of the spine: RLS on, no anon policy.

alter table public.market_promo_customers add column if not exists dist_name text;
comment on column public.market_promo_customers.dist_name is
  'Dist Name that says which division a promotion on a shared planner belongs to (Safeway Mountain West → Safeway Denver / Safeway IMW); null when the customer is one division.';

update public.market_promo_customers set dist_name = 'Safeway Denver' where market_code = 'ALB-DENVER' and customer_id = '000-1000203';
update public.market_promo_customers set dist_name = 'Safeway IMW'    where market_code = 'ALB-INTMTN' and customer_id = '000-1000203';

create table if not exists public.promo_enums (
  field      text not null,            -- promo_status, performance_type, channel, market, component_type, rate_uom, …
  value      text not null,
  sort_order integer not null default 0,
  primary key (field, value)
);
comment on table public.promo_enums is
  'Controlled vocabulary of the Telus promotion export (the Valid Values tab): one row per field × value, in the tab''s order.';
alter table public.promo_enums enable row level security;

create unique index if not exists promo_import_batches_natural on public.promo_import_batches (source_file, snapshot_date);

notify pgrst, 'reload schema';
