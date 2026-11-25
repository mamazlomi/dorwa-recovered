-- Collections, set-based: rule groups are expanded once and matched with plain
-- column / jsonb operators instead of per-product function chains, and the
-- featured rows share one offers aggregate instead of one search per row.

create or replace function app.value_match(p_facets jsonb, p_cat text[], p_class text, p_key text, p_vals text[])
returns boolean language sql immutable as $$
  select case p_key
    when 'section' then p_cat[1] = any(p_vals)
    when 'sub'     then p_cat[2] = any(p_vals)
    when 'type'    then p_class  = any(p_vals)
    else coalesce((p_facets -> p_key) ?| p_vals, false)
  end;
$$;

-- Product ids of one visible collection (empty when hidden or unknown).
create or replace function app.collection_product_ids(p_id uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  with d as (select * from app.collection_def(p_id)),
  rk as (
    select g.ord, e.key, array(select jsonb_array_elements_text(e.value)) vals
    from d
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(d.rules) = 'array' then d.rules else '[]'::jsonb end) with ordinality g(grp, ord)
    cross join lateral jsonb_each(case when jsonb_typeof(g.grp) = 'object' then g.grp else '{}'::jsonb end) e
    where jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0
  )
  select p.id from catalog_products p cross join d
  where not (p.id = any(d.exclude_ids))
    and (p.id = any(d.include_ids) or exists (
      select 1 from rk group by rk.ord
      having bool_and(app.value_match(p.facets, p.category_path, p.dispensing_class, rk.key, rk.vals))));
$$;

create or replace function public.shop_search(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_collection uuid default null,
  p_limit int default 48, p_offset int default 0, p_sort text default null)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, list_price numeric, max_discount numeric,
              pharmacies int, total int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  col as (select * from app.collection_def(p_collection)),
  mem as materialized (select x as id from app.collection_product_ids(p_collection) x where p_collection is not null),
  ctx as (
    select p_collection is not null as has_col,
           coalesce(p_pharmacy, (select c.pharmacy_id from col c)) as ph,
           coalesce((select c.only_discounted from col c), false) as disc,
           coalesce(nullif(p_sort, ''), (select c.sort_mode from col c), 'default') as srt
  ),
  prods as materialized (
    select p.* from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    cross join q cross join ctx
    where p.is_active
      and (q.q is null
           or app.norm_text(p.name_fa) like '%' || q.q || '%'
           or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
           or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
      and app.product_passes(p, p_filters)
      and (not ctx.has_col or p.id in (select m.id from mem m))
  ),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, min(o.list_price) lp,
           max(o.discount_pct) md, count(*)::int n
    from app.offers o
    join prods pp on pp.id = o.product_id
    cross join ctx
    where (p_city is null or o.city_id = p_city)
      and (ctx.ph is null or o.pharmacy_id = ctx.ph)
    group by o.product_id
  ),
  res as (
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url,
           a.mn, a.mx, a.lp, a.md, coalesce(a.n, 0) n
    from prods p left join agg a on a.product_id = p.id cross join ctx
    where ((ctx.ph is null and p_city is null) or a.n is not null)
      and (not ctx.disc or coalesce(a.md, 0) > 0)
  )
  select r.id, r.name_fa, r.name_i18n, r.dispensing_class, r.category_path, r.image_url,
         r.mn, r.mx, r.lp, r.md, r.n, (count(*) over ())::int
  from res r cross join ctx
  order by r.n = 0,
           case when ctx.srt = 'discount' then r.md end desc nulls last,
           case when ctx.srt = 'price_asc' then r.mn end asc nulls last,
           r.name_fa
  limit least(greatest(coalesce(p_limit, 48), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.shop_filter_options(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_scope text default 'dorva', p_collection uuid default null)
returns table(facet_key text, value_code text, name_fa text, name_i18n jsonb, products int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  col as (select * from app.collection_def(p_collection)),
  mem as materialized (select x as id from app.collection_product_ids(p_collection) x where p_collection is not null),
  ctx as (select p_collection is not null as has_col,
                 coalesce(p_pharmacy, (select c.pharmacy_id from col c)) as ph),
  keys as (
    select f.facet_key from catalog_filters f
    where p_scope = 'all' or (f.enabled and (f.scope = 'both' or f.scope = p_scope))
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
    cross join q cross join ctx
    where p.is_active
      and (q.q is null
           or app.norm_text(p.name_fa) like '%' || q.q || '%'
           or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
           or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
      and (not ctx.has_col or p.id in (select m.id from mem m))
      and ((p_city is null and ctx.ph is null) or exists (
        select 1 from stock_items s join pharmacies ph on ph.id = s.pharmacy_id
        where s.product_id = p.id and s.quantity > 0 and ph.status = 'active'
          and (p_city is null or ph.city_id = p_city)
          and (ctx.ph is null or s.pharmacy_id = ctx.ph)))
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

create or replace function public.featured_collections(p_pharmacy uuid default null, p_city int default null)
returns table(collection_id uuid, slug text, title jsonb, sort int, product_id uuid, name_fa text, name_i18n jsonb,
              dispensing_class text, category_path text[], image_url text, min_price numeric, max_price numeric,
              list_price numeric, max_discount numeric, pharmacies int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  with cols as (
    select c.id, c.slug, c.title, c.sort, c.row_limit, c.only_discounted, c.sort_mode
    from collections c
    where c.status = 'published' and c.featured and c.pharmacy_id is not distinct from p_pharmacy
  ),
  mem as materialized (
    select c.id cid, m.pid from cols c cross join lateral app.collection_product_ids(c.id) m(pid)
  ),
  prods as materialized (
    select distinct p.id from mem m
    join catalog_products p on p.id = m.pid and p.is_active
    join product_listings l on l.product_id = p.id and l.is_published
  ),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, min(o.list_price) lp,
           max(o.discount_pct) md, count(*)::int n
    from app.offers o join prods pp on pp.id = o.product_id
    where (p_city is null or o.city_id = p_city)
      and (p_pharmacy is null or o.pharmacy_id = p_pharmacy)
    group by o.product_id
  ),
  res as (
    select c.id cid, c.slug, c.title, c.sort, c.row_limit, c.sort_mode,
           p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url,
           a.mn, a.mx, a.lp, a.md, coalesce(a.n, 0) n
    from cols c
    join mem m on m.cid = c.id
    join prods pp on pp.id = m.pid
    join catalog_products p on p.id = m.pid
    left join agg a on a.product_id = p.id
    where ((p_pharmacy is null and p_city is null) or a.n is not null)
      and (not c.only_discounted or coalesce(a.md, 0) > 0)
  ),
  ranked as (
    select r.*,
           row_number() over (partition by r.cid order by r.n = 0,
             case when r.sort_mode = 'discount' then r.md end desc nulls last,
             case when r.sort_mode = 'price_asc' then r.mn end asc nulls last,
             r.name_fa) rn,
           (count(*) over (partition by r.cid))::int tot
    from res r
  )
  select r.cid, r.slug, r.title, r.sort, r.id, r.name_fa, r.name_i18n, r.dispensing_class, r.category_path,
         r.image_url, r.mn, r.mx, r.lp, r.md, r.n, r.tot
  from ranked r
  where r.rn <= r.row_limit
  order by r.sort, r.cid, r.rn;
$$;
