-- Discount caps are pricing policy: use the dedicated policy.manage
-- permission (same as category commission/discount), not settings.manage.
alter policy manage on public.discount_caps
  using (app.has_platform_permission('policy.manage'))
  with check (app.has_platform_permission('policy.manage'));

create or replace function public.discount_caps_impact(
  p_scope text, p_category_path text[] default null, p_facet_key text default null,
  p_facet_value text default null, p_product uuid default null, p_max numeric default 0)
returns table(products int, offers_above int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with target as (
    select p.id from catalog_products p
    where case p_scope
      when 'product'  then p.id = p_product
      when 'facet'    then app.product_has_facet(p.facets, p_facet_key, p_facet_value)
      when 'category' then p.category_path[1:cardinality(p_category_path)] = p_category_path
      else false end)
  select (select count(*) from target)::int,
         (select count(*) from stock_items s join target t on t.id = s.product_id
           where s.quantity > 0 and s.discount_pct > p_max)::int
  where app.has_platform_permission('policy.manage');
$$;
