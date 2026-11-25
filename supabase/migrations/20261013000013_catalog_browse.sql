-- Dorva mode: browse products across pharmacies, and see who offers one.

-- Products with their price range in a city (or everywhere when p_city is null).
create or replace function public.catalog_browse(
  p_city int default null, p_query text default null, p_class text default null,
  p_category text default null, p_facet_key text default null, p_facet_value text default null,
  p_limit int default 60)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              facets jsonb, min_price numeric, max_price numeric, max_discount numeric, pharmacies int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q)
  select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.facets,
         min(o.final_price), max(o.final_price), max(o.discount_pct), count(o.pharmacy_id)::int
  from catalog_products p
  join product_listings l on l.product_id = p.id and l.is_published
  cross join q
  left join app.offers o on o.product_id = p.id and (p_city is null or o.city_id = p_city)
  where p.is_active
    and (q.q is null
         or app.norm_text(p.name_fa) like '%' || q.q || '%'
         or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
         or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
    and (p_class is null or p.dispensing_class = p_class)
    and (p_category is null or p.category_path[1] = p_category)
    and (p_facet_key is null or app.product_has_facet(p.facets, p_facet_key, p_facet_value))
  group by p.id
  order by count(o.pharmacy_id) = 0, p.name_fa
  limit least(greatest(coalesce(p_limit, 60), 1), 200);
$$;
grant execute on function public.catalog_browse(int, text, text, text, text, text, int) to anon, authenticated;

-- Pharmacies offering one product, cheapest first. Equal prices are ordered
-- by a hash that changes daily, so no pharmacy is always shown first.
create or replace function public.product_pharmacy_offers(p_product uuid, p_city int default null)
returns table(pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, city_fa text, city_i18n jsonb,
              district_fa text, district_i18n jsonb, final_price numeric, list_price numeric,
              discount_pct numeric, max_qty int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select o.pharmacy_id, ph.slug, ph.name_fa, ph.name_i18n, c.name_fa, c.name_i18n,
         d.name_fa, d.name_i18n, o.final_price, o.list_price, o.discount_pct,
         least(s.quantity, 10)::int
  from app.offers o
  join pharmacies ph   on ph.id = o.pharmacy_id
  join stock_items s   on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
  left join cities c   on c.id = ph.city_id
  left join districts d on d.id = ph.district_id
  where o.product_id = p_product and (p_city is null or o.city_id = p_city)
  order by o.final_price, md5(o.pharmacy_id::text || current_date::text)
  limit 50;
$$;
grant execute on function public.product_pharmacy_offers(uuid, int) to anon, authenticated;
