-- Nielsen division TA <-> Telus customer mapping for the Albertsons family.
-- Mirrors lib/data/albertsonsPromoMap.ts: division-level Telus customers per
-- trading area, plus the corporate account (Safeway, Inc. SAF100) whose
-- promotions apply across every division. Drives the promo-window overlay on
-- the Nielsen weekly trend.

create table public.market_promo_customers (
  market_code text not null references public.markets (code),
  customer_id text not null,                 -- Telus planner/customer id
  scope       text not null default 'division' check (scope in ('division', 'corporate')),
  note        text,
  primary key (market_code, customer_id)
);

comment on table public.market_promo_customers is
  'Which Telus customers'' promotions overlay which Nielsen division trading area. Corporate rows apply to every division.';

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
  ('ALB-UNITED',    '000-1000291', 'division', 'United Supermarkets (UNI100)');

-- corporate account applies to every division (ALB-EASTERN has no division
-- customer in the book and is covered by corporate only)
insert into public.market_promo_customers (market_code, customer_id, scope, note)
select code, '000-1000214', 'corporate', 'Safeway, Inc. (SAF100) — corporate, all divisions'
from public.markets;

alter table public.market_promo_customers enable row level security;
create policy "authenticated read" on public.market_promo_customers for select to authenticated using (true);
