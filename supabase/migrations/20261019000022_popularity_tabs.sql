-- Popularity signals (views, favorites, sales), product-list tabs and
-- simple row ordering for collections.

-- ---------------------------------------------------------------- signals
alter table public.catalog_products add column if not exists first_seen_at timestamptz;
update public.catalog_products set first_seen_at = synced_at where first_seen_at is null;
alter table public.catalog_products alter column first_seen_at set default now();
alter table public.catalog_products alter column first_seen_at set not null;

-- Daily counters only: no visitor identity is stored.
create table if not exists public.product_views (
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  day        date not null default current_date,
  views      int  not null default 0 check (views >= 0),
  primary key (product_id, day)
);
alter table public.product_views enable row level security;   -- no direct access

-- Filled by the order system (not built yet); counts units sold per day.
create table if not exists public.product_sales_daily (
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  day        date not null default current_date,
  qty        int  not null default 0 check (qty >= 0),
  primary key (product_id, day)
);
alter table public.product_sales_daily enable row level security;

create table if not exists public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index if not exists favorites_product_idx on public.favorites (product_id);
alter table public.favorites enable row level security;
drop policy if exists own_favorites on public.favorites;
create policy own_favorites on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.track_view(p_product uuid) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into product_views (product_id, day, views)
  select p.id, current_date, 1 from catalog_products p where p.id = p_product and p.is_active
  on conflict (product_id, day) do update set views = product_views.views + 1;
$$;
revoke all on function public.track_view(uuid) from public;
grant execute on function public.track_view(uuid) to anon, authenticated;

-- 30-day signals per product. "popular" = favorites now; ratings join later.
create or replace function app.product_signals(p_ids uuid[])
returns table(product_id uuid, views int, sales int, popular int)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id,
         coalesce((select sum(v.views) from product_views v where v.product_id = i.id and v.day > current_date - 30), 0)::int,
         coalesce((select sum(s.qty) from product_sales_daily s where s.product_id = i.id and s.day > current_date - 30), 0)::int,
         coalesce((select count(*) from favorites f where f.product_id = i.id), 0)::int
  from unnest(p_ids) i(id);
$$;

-- --------------------------------------------------------------- sorting
create or replace function app.resolve_sort(p_customer text, p_collection_mode text, p_pharmacy uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    case p_customer when 'cheapest' then 'price_asc' when 'price_asc' then 'price_asc'
                    when 'discount' then 'discount' when 'newest' then 'newest' when 'name' then 'name'
                    when 'bestselling' then 'bestselling' when 'most_viewed' then 'most_viewed'
                    when 'popular' then 'popular' end,
    case when p_collection_mode in ('discount', 'price_asc', 'name') then p_collection_mode end,
    (select case ph.sort_policy when 'stock_discount' then 'discount' when 'stock_price' then 'price_asc'
                                when 'stock_name' then 'name' end
       from pharmacies ph where ph.id = p_pharmacy),
    (select case s.value #>> '{}' when 'stock_price' then 'price_asc' when 'stock_name' then 'name' else 'discount' end
       from settings s where s.key = 'catalog.sort_policy' and s.scope = 'platform' and s.scope_id = ''),
    'discount');
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
  sig as materialized (
    select s.* from ctx, lateral app.product_signals(
      case when ctx.srt in ('bestselling', 'most_viewed', 'popular')
           then (select array_agg(pp.id) from prods pp) else '{}'::uuid[] end) s
  ),
  res as (
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url, p.first_seen_at,
           a.mn, a.mx, a.lp, a.md, coalesce(a.n, 0) n,
           coalesce(s.views, 0) views, coalesce(s.sales, 0) sales, coalesce(s.popular, 0) popular
    from prods p left join agg a on a.product_id = p.id left join sig s on s.product_id = p.id cross join ctx
    where ((ctx.ph is null and p_city is null) or a.n is not null)
      and (not ctx.disc or coalesce(a.md, 0) > 0)
  )
  select r.id, r.name_fa, r.name_i18n, r.dispensing_class, r.category_path, r.image_url,
         r.mn, r.mx, r.lp, r.md, r.n, (count(*) over ())::int
  from res r cross join ctx
  order by r.n = 0,
           case when ctx.srt = 'bestselling' then r.sales end desc nulls last,
           case when ctx.srt = 'most_viewed' then r.views end desc nulls last,
           case when ctx.srt = 'popular' then r.popular end desc nulls last,
           case when ctx.srt = 'price_asc' then r.mn end asc nulls last,
           case when ctx.srt = 'newest' then r.first_seen_at end desc nulls last,
           -- discount is the main key for 'discount' and the tie-breaker for the rest
           r.md desc nulls last,
           r.name_fa
  limit least(greatest(coalesce(p_limit, 48), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------- tabs and row order
alter table public.collections add column if not exists show_as_tab boolean not null default false;
alter table public.collections add column if not exists default_tab boolean not null default false;
create unique index if not exists collections_one_default_tab
  on public.collections ((coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid))) where default_tab;

update public.collections set show_as_tab = true
 where pharmacy_id is null and slug in ('supplements', 'beauty-care', 'medical-equipment', 'otc', 'mother-baby')
   and status <> 'archived';
update public.collections set default_tab = true
 where pharmacy_id is null and slug = 'supplements' and status <> 'archived'
   and not exists (select 1 from public.collections c2 where c2.pharmacy_id is null and c2.default_tab);

-- Moves a collection one step up (-1) or down (+1) among its owner's
-- collections, renumbering 10, 20, 30… so positions stay clean.
create or replace function public.move_collection(p_id uuid, p_dir int) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_ph uuid; ids uuid[]; i int; j int; tmp uuid;
begin
  select pharmacy_id into v_ph from collections where id = p_id;
  if not found or not app.can_manage_collection(v_ph) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select array_agg(id order by sort, slug) into ids
    from collections where pharmacy_id is not distinct from v_ph and status <> 'archived';
  i := array_position(ids, p_id);
  if i is null then return; end if;
  j := i + sign(p_dir)::int;
  if j >= 1 and j <= array_length(ids, 1) then
    tmp := ids[i]; ids[i] := ids[j]; ids[j] := tmp;
  end if;
  update collections c set sort = x.ord * 10
    from unnest(ids) with ordinality x(id, ord) where c.id = x.id and c.sort <> x.ord * 10;
end $$;
revoke all on function public.move_collection(uuid, int) from public;
grant execute on function public.move_collection(uuid, int) to authenticated;

-- Tabs above the product list (published Dorva collections marked as tabs).
create or replace function public.product_tabs()
returns table(id uuid, slug text, title jsonb, is_default boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.slug, c.title, c.default_tab from collections c
  where c.pharmacy_id is null and c.status = 'published' and c.show_as_tab
  order by c.sort, c.slug;
$$;
grant execute on function public.product_tabs() to anon, authenticated;
