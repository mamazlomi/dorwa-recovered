-- catalog_filter_options, set-based: each product's values are expanded once,
-- then a product counts for filter K when it fails no selected filter, or
-- fails only K itself (a filter never narrows its own options).
create or replace function public.catalog_filter_options(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_scope text default 'dorva')
returns table(facet_key text, value_code text, name_fa text, name_i18n jsonb, products int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  keys as (
    select f.facet_key from catalog_filters f
    where f.enabled and (f.scope = 'both' or f.scope = p_scope)
  ),
  sel as (
    select s.k, x.v
    from jsonb_each(coalesce(p_filters, '{}'::jsonb)) s(k, vals)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(s.vals) = 'array' then s.vals else '[]'::jsonb end) x(v)
  ),
  selkeys as (select distinct k from sel),
  allkeys as (select facet_key as k from keys union select k from selkeys),
  base as materialized (
    select p.* from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    cross join q
    where p.is_active
      and (q.q is null
           or app.norm_text(p.name_fa) like '%' || q.q || '%'
           or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
           or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
      and ((p_city is null and p_pharmacy is null) or exists (
        select 1 from stock_items s join pharmacies ph on ph.id = s.pharmacy_id
        where s.product_id = p.id and s.quantity > 0 and ph.status = 'active'
          and (p_city is null or ph.city_id = p_city)
          and (p_pharmacy is null or s.pharmacy_id = p_pharmacy)))
  ),
  kv as materialized (
    select b.id, a.k, v.code
    from base b cross join allkeys a
    cross join lateral unnest(app.product_values(b, a.k)) v(code)
  ),
  ok as (select distinct kv.id, kv.k from kv join sel on sel.k = kv.k and sel.v = kv.code),
  fails as (
    select b.id, sk.k from base b cross join selkeys sk
    where not exists (select 1 from ok where ok.id = b.id and ok.k = sk.k)
  ),
  nfail as (select id, count(*) n, min(k) only_key from fails group by id),
  vals as (
    select kv.k, kv.code, kv.id
    from kv join keys on keys.facet_key = kv.k
    left join nfail f on f.id = kv.id
    where f.id is null or (f.n = 1 and f.only_key = kv.k)
  )
  select v.k, v.code, coalesce(fv.name_fa, v.code), coalesce(fv.name_i18n, '{}'::jsonb),
         count(distinct v.id)::int
  from vals v
  left join catalog_facet_values fv on fv.facet_key = v.k and fv.value_code = v.code
  group by v.k, v.code, fv.name_fa, fv.name_i18n;
$$;
grant execute on function public.catalog_filter_options(int, text, jsonb, uuid, text) to anon, authenticated;
