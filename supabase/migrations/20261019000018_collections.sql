-- Collections: curated product rows for the storefront (Dorva) and for each
-- pharmacy page.
-- * Dorva collection: rule groups + manual include/exclude. A product belongs
--   when it is not excluded and (it is included or it passes ANY rule group).
--   Inside a group the catalog-filter logic applies: OR within a key, AND
--   across keys, e.g. [{"section":["مکمل"],"brand":["BR-1","BR-2"]},{"type":["otc"]}].
-- * Pharmacy collection, two simple paths:
--     1) copy of a Dorva collection (source_id): follows the Dorva rules live,
--        the pharmacy only ticks products in or out (include/exclude);
--     2) manual pick: include list only.
--   Writing rules is Dorva-admin only; a pharmacy row's own rules are ignored
--   unless set by an admin. Pharmacy collections list only that pharmacy's stock.

insert into public.permissions (code, scope, description_fa) values
  ('collections.manage',          'platform', 'ساخت و ویرایش مجموعه‌های دوروا'),
  ('pharmacy.collections.manage', 'pharmacy', 'ساخت و ویرایش مجموعه‌های اختصاصی داروخانه')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r join public.permissions p on p.scope = r.scope
where r.is_system and r.pharmacy_id is null and (
     (r.code in ('super_admin', 'catalog_operator', 'content_moderator') and p.code = 'collections.manage')
  or (r.code = 'owner' and p.code = 'pharmacy.collections.manage'))
on conflict do nothing;

create table public.collections (
  id              uuid primary key default gen_random_uuid(),
  pharmacy_id     uuid references public.pharmacies(id) on delete cascade,   -- null = Dorva
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  title           jsonb not null default '{}'::jsonb,
  description     jsonb not null default '{}'::jsonb,
  rules           jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array'),
  include_ids     uuid[] not null default '{}',
  exclude_ids     uuid[] not null default '{}',
  only_discounted boolean not null default false,
  sort_mode       text not null default 'default' check (sort_mode in ('default', 'discount', 'price_asc', 'name')),
  status          text not null default 'draft' check (status in ('draft', 'published')),
  featured        boolean not null default false,   -- shown as a row on the home / pharmacy page
  sort            int not null default 100,
  row_limit       int not null default 12 check (row_limit between 4 and 48),
  source_id       uuid references public.collections(id) on delete set null,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (cardinality(include_ids) <= 500 and cardinality(exclude_ids) <= 500)
);
create unique index collections_slug_unique on public.collections
  (coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index collections_featured_idx on public.collections (pharmacy_id, sort) where status = 'published' and featured;

create or replace function app.can_manage_collection(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_platform_permission('collections.manage')
      or (p_pharmacy is not null and app.has_pharmacy_permission(p_pharmacy, 'pharmacy.collections.manage'));
$$;

alter table public.collections enable row level security;
create policy read_published on public.collections for select
  using (status = 'published' or app.can_manage_collection(pharmacy_id));
create policy manage_insert on public.collections for insert to authenticated
  with check (app.can_manage_collection(pharmacy_id));
create policy manage_update on public.collections for update to authenticated
  using (app.can_manage_collection(pharmacy_id)) with check (app.can_manage_collection(pharmacy_id));
create policy manage_delete on public.collections for delete to authenticated
  using (app.can_manage_collection(pharmacy_id));
grant select on public.collections to anon, authenticated;
grant insert, update, delete on public.collections to authenticated;

create or replace function app.guard_collection() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.pharmacy_id is distinct from old.pharmacy_id then
    raise exception 'collection owner cannot change';
  end if;
  if new.pharmacy_id is null then
    new.source_id := null;                          -- Dorva rows are never copies
  else
    if new.source_id is not null and not exists (
      select 1 from collections s where s.id = new.source_id and s.pharmacy_id is null) then
      raise exception 'a pharmacy collection can only copy a Dorva collection';
    end if;
    -- rule writing is admin-only; pharmacy staff keep whatever an admin set
    if not app.has_platform_permission('collections.manage') then
      new.rules := case when tg_op = 'UPDATE' then old.rules else '[]'::jsonb end;
    end if;
  end if;
  new.include_ids := array(select distinct x from unnest(new.include_ids) x where not x = any(new.exclude_ids));
  new.exclude_ids := array(select distinct x from unnest(new.exclude_ids) x);
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger collections_guard before insert or update on public.collections
  for each row execute function app.guard_collection();

-- A rule group counts only when it has at least one non-empty value list.
create or replace function app.rule_group_active(g jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(g) = 'object' and exists (
    select 1 from jsonb_each(g) e where jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0);
$$;

create or replace function app.in_collection(p public.catalog_products, p_rules jsonb, p_inc uuid[], p_exc uuid[])
returns boolean language sql immutable as $$
  select not (p.id = any(coalesce(p_exc, '{}')))
     and (p.id = any(coalesce(p_inc, '{}'))
          or exists (select 1 from jsonb_array_elements(
                       case when jsonb_typeof(p_rules) = 'array' then p_rules else '[]'::jsonb end) g(grp)
                     where app.rule_group_active(g.grp) and app.product_passes(p, g.grp)));
$$;

-- The effective definition of a visible collection (zero rows if hidden).
create or replace function app.collection_def(p_id uuid)
returns table(pharmacy_id uuid, rules jsonb, include_ids uuid[], exclude_ids uuid[], only_discounted boolean, sort_mode text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.pharmacy_id,
         case when c.source_id is not null then coalesce(s.rules, '[]'::jsonb) else c.rules end,
         c.include_ids, c.exclude_ids, c.only_discounted, c.sort_mode
  from collections c left join collections s on s.id = c.source_id
  where c.id = p_id and (c.status = 'published' or app.can_manage_collection(c.pharmacy_id));
$$;

-- Product search with an optional collection; successor of catalog_search.
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
      and (not ctx.has_col or exists (
        select 1 from col c where app.in_collection(p, c.rules, c.include_ids, c.exclude_ids)))
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
grant execute on function public.shop_search(int, text, jsonb, uuid, uuid, int, int, text) to anon, authenticated;

-- Filter options with an optional collection; scope 'all' = every filter key,
-- enabled or not (used by the admin rule builder).
create or replace function public.shop_filter_options(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_scope text default 'dorva', p_collection uuid default null)
returns table(facet_key text, value_code text, name_fa text, name_i18n jsonb, products int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  col as (select * from app.collection_def(p_collection)),
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
      and (not ctx.has_col or exists (
        select 1 from col c where app.in_collection(p, c.rules, c.include_ids, c.exclude_ids)))
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
grant execute on function public.shop_filter_options(int, text, jsonb, uuid, text, uuid) to anon, authenticated;

-- The old entry points stay as thin wrappers.
create or replace function public.catalog_search(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_limit int default 48, p_offset int default 0)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, list_price numeric, max_discount numeric,
              pharmacies int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.shop_search(p_city, p_query, p_filters, p_pharmacy, null, p_limit, p_offset, null);
$$;

create or replace function public.catalog_filter_options(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_scope text default 'dorva')
returns table(facet_key text, value_code text, name_fa text, name_i18n jsonb, products int)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.shop_filter_options(p_city, p_query, p_filters, p_pharmacy, p_scope, null);
$$;

-- Featured rows for the Dorva home page or one pharmacy page, with their first products.
create or replace function public.featured_collections(p_pharmacy uuid default null, p_city int default null)
returns table(collection_id uuid, slug text, title jsonb, sort int, product_id uuid, name_fa text, name_i18n jsonb,
              dispensing_class text, category_path text[], image_url text, min_price numeric, max_price numeric,
              list_price numeric, max_discount numeric, pharmacies int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.slug, c.title, c.sort, s.*
  from collections c
  cross join lateral public.shop_search(p_city => p_city, p_pharmacy => p_pharmacy, p_collection => c.id,
                                        p_limit => c.row_limit) s
  where c.status = 'published' and c.featured
    and c.pharmacy_id is not distinct from p_pharmacy
  order by c.sort, c.id;
$$;
grant execute on function public.featured_collections(uuid, int) to anon, authenticated;

-- The store sections as Dorva collections, plus a deals row.
insert into public.collections (slug, title, rules, status, featured, sort, only_discounted, sort_mode) values
  ('deals',        '{"fa":"تخفیف‌دارها","en":"On sale","ar":"عروض"}',
                   '[{"type":["general","supplement","otc"]}]', 'published', true, 5, true, 'discount'),
  ('supplements',  '{"fa":"مکمل‌ها","en":"Supplements","ar":"المكملات"}',
                   '[{"section":["مکمل"]}]', 'published', true, 10, false, 'default'),
  ('beauty-care',  '{"fa":"آرایشی و بهداشتی","en":"Beauty & personal care","ar":"التجميل والعناية"}',
                   '[{"section":["آرایشی و بهداشتی"]}]', 'published', true, 20, false, 'default'),
  ('medical-equipment', '{"fa":"تجهیزات و ملزومات","en":"Medical equipment","ar":"المعدات الطبية"}',
                   '[{"section":["تجهیزات و ملزومات"]}]', 'published', true, 30, false, 'default'),
  ('otc',          '{"fa":"داروهای بدون نسخه","en":"Over-the-counter medicines","ar":"أدوية بدون وصفة"}',
                   '[{"type":["otc"]}]', 'published', true, 40, false, 'default'),
  ('mother-baby',  '{"fa":"مادر و کودک","en":"Mother & baby","ar":"الأم والطفل"}',
                   '[{"section":["مادر و کودک"]}]', 'published', true, 50, false, 'default')
on conflict do nothing;
