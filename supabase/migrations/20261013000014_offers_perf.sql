-- Performance: the per-row app.max_discount() call (security definer, not
-- inlinable) made app.offers cost ~75µs per stock row, and catalog_browse
-- re-evaluated offers per product. With ~700 products the browse RPC hit the
-- API statement timeout. Caps are now computed set-based in a view, and
-- catalog_browse aggregates offers once.

create or replace view app.product_caps as
select p.id as product_id,
       coalesce(
         (select r.max_discount_pct from public.discount_caps r
           where r.is_active and r.scope = 'product' and r.product_id = p.id),
         (select min(r.max_discount_pct) from public.discount_caps r
           where r.is_active and r.scope = 'facet'
             and app.product_has_facet(p.facets, r.facet_key, r.facet_value)),
         (select r.max_discount_pct from public.discount_caps r
           where r.is_active and r.scope = 'category'
             and p.category_path[1:cardinality(r.category_path)] = r.category_path
           order by cardinality(r.category_path) desc limit 1),
         (select cp.max_discount_pct from public.category_policies cp
           where cp.dispensing_class = p.dispensing_class),
         0) as cap
from public.catalog_products p;

create or replace view app.offers as
select s.pharmacy_id,
       s.product_id,
       ph.slug as pharmacy_slug,
       ph.city_id,
       app.effective_price(l.price_policy, l.base_price, s.price, least(s.discount_pct, m.cap)) as final_price,
       coalesce(s.price, l.base_price) as list_price,
       (least(s.discount_pct, m.cap))::numeric(5,2) as discount_pct
from public.stock_items s
join public.pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
join public.product_listings l on l.product_id = s.product_id and l.is_published
join public.catalog_products p on p.id = s.product_id and p.is_active
join app.product_caps m on m.product_id = s.product_id
where s.quantity > 0;

create or replace function app.max_discount(p_product uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select cap from app.product_caps where product_id = p_product), 0);
$$;

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
  prods as materialized (
    select p.* from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    cross join q
    where p.is_active
      and (q.q is null
           or app.norm_text(p.name_fa) like '%' || q.q || '%'
           or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
           or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
      and (p_class is null or p.dispensing_class = p_class)
      and (p_category is null or p.category_path[1] = p_category)
      and (p_facet_key is null or app.product_has_facet(p.facets, p_facet_key, p_facet_value))
  ),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx,
           max(o.discount_pct) md, count(*)::int n
    from app.offers o
    join prods pp on pp.id = o.product_id
    where (p_city is null or o.city_id = p_city)
    group by o.product_id
  )
  select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.facets,
         a.mn, a.mx, a.md, coalesce(a.n, 0)
  from prods p left join agg a on a.product_id = p.id
  order by a.n is null, p.name_fa
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
grant execute on function public.catalog_browse(int, text, text, text, text, text, int) to anon, authenticated;
