-- Performance: compute the discount cap once per stock row, and aggregate
-- offers once in catalog_browse instead of once per product.
create or replace view app.offers as
  select s.pharmacy_id, s.product_id, ph.slug as pharmacy_slug, ph.city_id,
         app.effective_price(l.price_policy, l.base_price, s.price, least(s.discount_pct, m.cap)) as final_price,
         coalesce(s.price, l.base_price) as list_price,
         least(s.discount_pct, m.cap)::numeric(5,2) as discount_pct
  from stock_items s
  join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
  join product_listings l on l.product_id = s.product_id and l.is_published
  join catalog_products p on p.id = s.product_id and p.is_active
  cross join lateral (select app.max_discount(s.product_id) as cap) m
  where s.quantity > 0;

create or replace function public.catalog_browse(
  p_city int default null, p_query text default null, p_class text default null,
  p_category text default null, p_facet_key text default null, p_facet_value text default null,
  p_limit int default 60)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              facets jsonb, min_price numeric, max_price numeric, max_discount numeric, pharmacies int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, max(o.discount_pct) md, count(*)::int n
    from app.offers o
    where p_city is null or o.city_id = p_city
    group by o.product_id)
  select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.facets,
         a.mn, a.mx, a.md, coalesce(a.n, 0)
  from catalog_products p
  join product_listings l on l.product_id = p.id and l.is_published
  cross join q
  left join agg a on a.product_id = p.id
  where p.is_active
    and (q.q is null
         or app.norm_text(p.name_fa) like '%' || q.q || '%'
         or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
         or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
    and (p_class is null or p.dispensing_class = p_class)
    and (p_category is null or p.category_path[1] = p_category)
    and (p_facet_key is null or app.product_has_facet(p.facets, p_facet_key, p_facet_value))
  order by coalesce(a.n, 0) = 0, p.name_fa
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
