-- Product ordering in three layers (customer choice always wins):
--   customer sort menu  >  collection override  >  pharmacy policy (its own page)  >  Dorva policy.
-- Policies use explainable criteria only (stock, discount, price, name, newest);
-- ads never change the order, they get labelled slots of their own.
-- Also: collections are archived instead of deleted, a live preview for the
-- rule editor, and product counts per collection.

insert into public.setting_definitions (key, group_code, value_type, options, label, help, sort) values
  ('catalog.sort_policy', 'catalog', 'enum',
   '[{"value":"stock_discount","label":{"fa":"موجودها اول، بعد بیشترین تخفیف، بعد نام","en":"In stock first, then biggest discount, then name","ar":"المتوفر أولاً ثم أكبر خصم ثم الاسم"}},
     {"value":"stock_price","label":{"fa":"موجودها اول، بعد ارزان‌ترین","en":"In stock first, then cheapest","ar":"المتوفر أولاً ثم الأرخص"}},
     {"value":"stock_name","label":{"fa":"موجودها اول، بعد نام","en":"In stock first, then name","ar":"المتوفر أولاً ثم الاسم"}}]',
   '{"fa":"ترتیب پیش‌فرض نمایش کالاها","en":"Default product order","ar":"الترتيب الافتراضي للمنتجات"}',
   '{"fa":"برای همه فهرست‌ها و مجموعه‌های دوروا، مگر مجموعه‌ای که ترتیب خودش را دارد. مشتری همیشه می‌تواند از منوی «مرتب‌سازی» ترتیب دیگری انتخاب کند. تبلیغ روی این ترتیب اثری ندارد.","en":"For every Dorva list and collection unless a collection sets its own. Customers can always pick another order from the Sort menu. Ads never affect this order.","ar":"لكل قوائم ومجموعات دوروا ما لم تحدد المجموعة ترتيبها. يمكن للعميل دائماً اختيار ترتيب آخر من قائمة الفرز. الإعلانات لا تؤثر على هذا الترتيب."}',
   10)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa)
values ('catalog.sort_policy', 'platform', '"stock_discount"', 'ترتیب پیش‌فرض نمایش کالاها')
on conflict do nothing;

-- A pharmacy may set its own default for its own page (null = follow Dorva).
alter table public.pharmacies add column if not exists sort_policy text
  check (sort_policy in ('stock_discount', 'stock_price', 'stock_name'));

-- Archive instead of delete.
alter table public.collections drop constraint if exists collections_status_check;
alter table public.collections add constraint collections_status_check
  check (status in ('draft', 'published', 'archived'));

-- Effective order key: discount | price_asc | name | newest.
create or replace function app.resolve_sort(p_customer text, p_collection_mode text, p_pharmacy uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    case p_customer when 'cheapest' then 'price_asc' when 'price_asc' then 'price_asc'
                    when 'discount' then 'discount' when 'newest' then 'newest' when 'name' then 'name' end,
    case when p_collection_mode in ('discount', 'price_asc', 'name') then p_collection_mode end,
    (select case ph.sort_policy when 'stock_discount' then 'discount' when 'stock_price' then 'price_asc'
                                when 'stock_name' then 'name' end
       from pharmacies ph where ph.id = p_pharmacy),
    (select case s.value #>> '{}' when 'stock_price' then 'price_asc' when 'stock_name' then 'name' else 'discount' end
       from settings s where s.key = 'catalog.sort_policy' and s.scope = 'platform' and s.scope_id = ''),
    'discount');
$$;

-- Product ids matching rule groups plus manual include/exclude (no visibility check).
create or replace function app.rule_product_ids(p_rules jsonb, p_inc uuid[], p_exc uuid[]) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  with rk as (
    select g.ord, e.key, array(select jsonb_array_elements_text(e.value)) vals
    from jsonb_array_elements(
      case when jsonb_typeof(p_rules) = 'array' then p_rules else '[]'::jsonb end) with ordinality g(grp, ord)
    cross join lateral jsonb_each(case when jsonb_typeof(g.grp) = 'object' then g.grp else '{}'::jsonb end) e
    where jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0
  )
  select p.id from catalog_products p
  where not (p.id = any(coalesce(p_exc, '{}')))
    and (p.id = any(coalesce(p_inc, '{}')) or exists (
      select 1 from rk group by rk.ord
      having bool_and(app.value_match(p.facets, p.category_path, p.dispensing_class, rk.key, rk.vals))));
$$;

create or replace function app.collection_product_ids(p_id uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x from app.collection_def(p_id) d
  cross join lateral app.rule_product_ids(d.rules, d.include_ids, d.exclude_ids) x;
$$;

-- Archived collections stay visible to managers only (same as drafts).
create or replace function app.collection_def(p_id uuid)
returns table(pharmacy_id uuid, rules jsonb, include_ids uuid[], exclude_ids uuid[], only_discounted boolean, sort_mode text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.pharmacy_id,
         case when c.source_id is not null then coalesce(s.rules, '[]'::jsonb) else c.rules end,
         c.include_ids, c.exclude_ids, c.only_discounted, c.sort_mode
  from collections c left join collections s on s.id = c.source_id
  where c.id = p_id and (c.status = 'published' or app.can_manage_collection(c.pharmacy_id));
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
  ctx0 as (
    select p_collection is not null as has_col,
           coalesce(p_pharmacy, (select c.pharmacy_id from col c)) as ph,
           coalesce((select c.only_discounted from col c), false) as disc,
           (select c.sort_mode from col c) as mode
  ),
  ctx as (select ctx0.*, app.resolve_sort(p_sort, ctx0.mode, ctx0.ph) as srt from ctx0),
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
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url, p.synced_at,
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
           case when ctx.srt = 'newest' then r.synced_at end desc nulls last,
           r.name_fa
  limit least(greatest(coalesce(p_limit, 48), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.featured_collections(p_pharmacy uuid default null, p_city int default null)
returns table(collection_id uuid, slug text, title jsonb, sort int, product_id uuid, name_fa text, name_i18n jsonb,
              dispensing_class text, category_path text[], image_url text, min_price numeric, max_price numeric,
              list_price numeric, max_discount numeric, pharmacies int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  with cols as (
    select c.id, c.slug, c.title, c.sort, c.row_limit, c.only_discounted,
           app.resolve_sort(null, c.sort_mode, p_pharmacy) srt
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
    select c.id cid, c.slug, c.title, c.sort, c.row_limit, c.srt,
           p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url, p.synced_at,
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
             case when r.srt = 'discount' then r.md end desc nulls last,
             case when r.srt = 'price_asc' then r.mn end asc nulls last,
             case when r.srt = 'newest' then r.synced_at end desc nulls last,
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

-- Live preview of unsaved rules (collection editors only). Pharmacy staff
-- preview within their own stock, Dorva staff over the whole catalog.
create or replace function public.collection_preview(
  p_rules jsonb, p_include uuid[] default '{}', p_exclude uuid[] default '{}',
  p_only_discounted boolean default false, p_pharmacy uuid default null, p_limit int default 12)
returns table(product_id uuid, name_fa text, name_i18n jsonb, min_price numeric, max_discount numeric,
              in_stock boolean, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  with ok as (select app.can_manage_collection(p_pharmacy) as ok),
  ids as materialized (
    select x as id from ok cross join lateral app.rule_product_ids(p_rules, p_include, p_exclude) x where ok.ok
  ),
  prods as materialized (
    select p.* from catalog_products p
    join ids on ids.id = p.id
    join product_listings l on l.product_id = p.id and l.is_published
    where p.is_active
  ),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.discount_pct) md, count(*)::int n
    from app.offers o join prods pp on pp.id = o.product_id
    where p_pharmacy is null or o.pharmacy_id = p_pharmacy
    group by o.product_id
  ),
  res as (
    select p.id, p.name_fa, p.name_i18n, a.mn, a.md, coalesce(a.n, 0) n
    from prods p left join agg a on a.product_id = p.id
    where (p_pharmacy is null or a.n is not null)
      and (not coalesce(p_only_discounted, false) or coalesce(a.md, 0) > 0)
  )
  select r.id, r.name_fa, r.name_i18n, r.mn, r.md, r.n > 0, (count(*) over ())::int
  from res r
  order by r.n = 0, r.md desc nulls last, r.name_fa
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;
grant execute on function public.collection_preview(jsonb, uuid[], uuid[], boolean, uuid, int) to authenticated;

-- Product counts per collection for the lists (Dorva: whole catalog; pharmacy: its stock).
create or replace function public.collection_sizes(p_pharmacy uuid default null)
returns table(collection_id uuid, products int)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id,
         (select count(*) from app.collection_product_ids(c.id) x
            join catalog_products p on p.id = x and p.is_active
            join product_listings l on l.product_id = p.id and l.is_published
           where p_pharmacy is null or exists (
             select 1 from stock_items s where s.product_id = p.id and s.pharmacy_id = p_pharmacy and s.quantity > 0))::int
  from collections c
  where c.pharmacy_id is not distinct from p_pharmacy
    and (c.status = 'published' or app.can_manage_collection(c.pharmacy_id));
$$;
grant execute on function public.collection_sizes(uuid) to anon, authenticated;
