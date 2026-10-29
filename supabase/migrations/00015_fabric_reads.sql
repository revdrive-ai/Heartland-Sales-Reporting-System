-- The app's reads of the Fabric-fed tables. Fabric (the Heartland data
-- warehouse) loads fact_shipments_weekly, dim_customer, dim_product,
-- dim_list_price, dim_fiscal_period and the telus_* tables into this project
-- (etl_load_log records each load). The app reads internal sales, shipments
-- and list prices from those tables through the objects declared here, so
-- the join logic lives in one place and the pages never see a raw fact row.
--
--   v_sales_weekly     one row per customer × item × week-ending Saturday with
--                      the customer's hierarchy and the product's brand and
--                      category put on; excluded customers (intercompany,
--                      samples) and non-product stock codes left out
--   rpt_sales_weekly   the same rows for a date range (and optionally a set of
--                      customer codes) as ONE compact json array, so a year of
--                      sales is one request instead of sixty pages
--   v_sales_products   the products that have ever sold, with the NIQ UPC tie
--   v_list_price       dim_list_price with the product's description and brand
--
-- Posture: same as the rest of the spine — only the service role (server
-- code) reads these. Views are security_invoker so they never bypass the
-- row-level security of the tables under them, and anon / authenticated get
-- no grant. The Fabric loader's own views are switched to security_invoker
-- for the same reason.

create or replace view public.v_sales_weekly
with (security_invoker = true) as
select
  f.week_ending,
  f.customer_code,
  coalesce(c.customer_name, f.customer_code)                         as customer_name,
  coalesce(nullif(c.parent_code, ''), f.customer_code)               as parent_code,
  coalesce(nullif(c.parent_name, ''), c.customer_name, f.customer_code) as parent_name,
  coalesce(nullif(c.channel, ''), 'Other')                           as channel,
  c.region,
  c.sr_director_name,
  f.stock_code,
  p.description,
  coalesce(nullif(p.brand, ''), 'Other')                             as brand,
  p.category,
  p.business_group,
  p.units_per_case,
  p.nielsen_upc,
  f.net_sales,
  f.gross_sales,
  f.off_invoice,
  f.cost_std,
  f.qty_invoiced                                                     as cases,
  f.invoice_lines
from public.fact_shipments_weekly f
left join public.dim_customer c on c.customer_code = f.customer_code
left join public.dim_product  p on p.stock_code    = f.stock_code
where coalesce(c.is_excluded, false) = false
  and coalesce(p.is_non_product, false) = false;

comment on view public.v_sales_weekly is
  'Internal sales from Fabric: fact_shipments_weekly with the customer hierarchy and product brand/category joined; excluded customers and non-product codes left out.';

-- One json array of [week_ending, customer_code, stock_code, net, gross,
-- off_invoice, cases] rows — compact on purpose, the names come from the dims.
create or replace function public.rpt_sales_weekly(p_from date, p_to date, p_customers text[] default null)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    json_agg(
      json_build_array(v.week_ending, v.customer_code, v.stock_code, v.net_sales, v.gross_sales, v.off_invoice, v.cases)
      order by v.week_ending, v.customer_code, v.stock_code
    ),
    '[]'::json
  )
  from public.v_sales_weekly v
  where v.week_ending between p_from and p_to
    and (p_customers is null or v.customer_code = any (p_customers));
$$;

comment on function public.rpt_sales_weekly(date, date, text[]) is
  'Internal sales rows for a date range (and optional customer codes) as one compact json array — the Leadership report and shipments reads.';

create or replace view public.v_sales_products
with (security_invoker = true) as
select p.stock_code, p.description, p.brand, p.category, p.subcategory, p.business_group,
       p.product_class_desc, p.units_per_case, p.nielsen_upc, p.upc12, p.discontinued_status
from public.dim_product p
where coalesce(p.is_non_product, false) = false
  and exists (select 1 from public.fact_shipments_weekly f where f.stock_code = p.stock_code);

comment on view public.v_sales_products is 'dim_product restricted to stock codes that have sold, with the NIQ UPC tie.';

create or replace view public.v_list_price
with (security_invoker = true) as
select lp.stock_code, lp.contract, lp.price_method, lp.case_price, lp.units_per_case, lp.unit_price,
       lp.start_date, lp.expiry_date, lp.is_current,
       p.description, p.brand, p.category, p.subcategory, p.product_class_desc, p.nielsen_upc, p.upc12
from public.dim_list_price lp
left join public.dim_product p on p.stock_code = lp.stock_code;

comment on view public.v_list_price is 'dim_list_price (the LIST contract, dated) with the product description, brand and NIQ UPC put on.';

-- only server code reads these
revoke all on public.v_sales_weekly   from anon, authenticated;
revoke all on public.v_sales_products from anon, authenticated;
revoke all on public.v_list_price     from anon, authenticated;
revoke all on function public.rpt_sales_weekly(date, date, text[]) from public, anon, authenticated;

-- the loader's own views read the tables as their owner and so skipped RLS
-- for anyone holding the anon key; invoker security closes that
do $$
declare v text;
begin
  for v in select viewname from pg_views where schemaname = 'public'
            and viewname in ('v_telus_customer_map', 'v_customer_xref_ready', 'v_deduction_invoice_link', 'v_trade_expense_by_period')
  loop
    execute format('alter view public.%I set (security_invoker = true)', v);
    execute format('revoke all on public.%I from anon, authenticated', v);
  end loop;
end $$;

notify pgrst, 'reload schema';
