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
