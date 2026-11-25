-- Filter options: only values that at least one visible product carries,
-- counted under the other active filters (city, search, type, category).
create or replace function public.catalog_facet_counts(
  p_facet_key text, p_city int default null, p_query text default null,
  p_class text default null, p_category text default null)
returns table(value_code text, name_fa text, name_i18n jsonb, products int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  prods as materialized (
    select p.id, p.facets from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    cross join q
    where p.is_active
      and (q.q is null
           or app.norm_text(p.name_fa) like '%' || q.q || '%'
           or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
           or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
      and (p_class is null or p.dispensing_class = p_class)
      and (p_category is null or p.category_path[1] = p_category)
      and (p_city is null or exists (
            select 1 from stock_items s join pharmacies ph on ph.id = s.pharmacy_id
            where s.product_id = p.id and s.quantity > 0 and ph.status = 'active' and ph.city_id = p_city))
  ),
  vals as (
    select p.id, v.code
    from prods p
    cross join lateral jsonb_array_elements_text(
      case jsonb_typeof(p.facets -> p_facet_key)
        when 'array'  then p.facets -> p_facet_key
        when 'string' then jsonb_build_array(p.facets -> p_facet_key)
        else '[]'::jsonb end) as v(code)
  )
  select v.code, coalesce(fv.name_fa, v.code), coalesce(fv.name_i18n, '{}'::jsonb), count(distinct v.id)::int
  from vals v
  left join catalog_facet_values fv on fv.facet_key = p_facet_key and fv.value_code = v.code
  group by v.code, fv.name_fa, fv.name_i18n
  order by 2;
$$;
grant execute on function public.catalog_facet_counts(text, int, text, text, text) to anon, authenticated;
