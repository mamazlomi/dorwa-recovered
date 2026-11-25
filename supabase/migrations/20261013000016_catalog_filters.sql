-- Configurable catalog filters (Dorva policy layer).
-- * Which filters exist, their titles (fa/en/ar), order, and whether values are
--   searchable / show counts are admin settings, changeable without code.
-- * Several values can be chosen per filter: OR inside a filter, AND across filters.
-- * Options only list values carried by at least one product, counted under the
--   other active filters (each filter ignores its own selection when counting).
-- * Pseudo keys: section (category level 1), sub (category level 2), type
--   (dispensing class). Everything else is a catalog facet key.

create table public.catalog_filters (
  facet_key   text primary key check (facet_key ~ '^[a-z_]+$'),
  label       jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  sort        int not null default 100,
  searchable  boolean not null default true,
  show_counts boolean not null default true,
  scope       text not null default 'both' check (scope in ('both', 'dorva', 'pharmacy')),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
alter table public.catalog_filters enable row level security;
create policy read_all on public.catalog_filters for select using (true);
create policy manage on public.catalog_filters for all to authenticated
  using (app.has_platform_permission('settings.manage'))
  with check (app.has_platform_permission('settings.manage'));
grant select on public.catalog_filters to anon, authenticated;
grant insert, update on public.catalog_filters to authenticated;

create or replace function app.touch_catalog_filters() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger catalog_filters_touch before insert or update on public.catalog_filters
  for each row execute function app.touch_catalog_filters();

insert into public.catalog_filters (facet_key, label, enabled, sort, searchable) values
  ('section',      '{"fa":"بخش","en":"Section","ar":"القسم"}',                      true,  10, false),
  ('sub',          '{"fa":"دسته","en":"Category","ar":"الفئة"}',                     true,  20, true),
  ('brand',        '{"fa":"برند","en":"Brand","ar":"العلامة"}',                      true,  30, true),
  ('dosage_form',  '{"fa":"شکل","en":"Form","ar":"الشكل"}',                          true,  40, true),
  ('product_type', '{"fa":"نوع محصول","en":"Product type","ar":"نوع المنتج"}',       true,  50, true),
  ('ingredient',   '{"fa":"ماده مؤثره","en":"Active ingredient","ar":"المادة الفعالة"}', true, 60, true),
  ('use_location', '{"fa":"محل مصرف","en":"Area of use","ar":"منطقة الاستخدام"}',    true,  70, true),
  ('country',      '{"fa":"کشور سازنده","en":"Country","ar":"بلد المنشأ"}',          true,  80, true),
  ('type',         '{"fa":"نوع کالا","en":"Dispensing type","ar":"نوع الصرف"}',      false, 90, false),
  ('manufacturer', '{"fa":"تولیدکننده","en":"Manufacturer","ar":"المصنع"}',          false, 100, true)
on conflict (facet_key) do nothing;

-- Values of one key for one product, pseudo keys included.
create or replace function app.product_values(p public.catalog_products, p_key text) returns text[]
language sql immutable as $$
  select case p_key
    when 'section' then array_remove(array[p.category_path[1]], null)
    when 'sub'     then array_remove(array[p.category_path[2]], null)
    when 'type'    then array[p.dispensing_class]
    else case jsonb_typeof(p.facets -> p_key)
           when 'array'  then array(select jsonb_array_elements_text(p.facets -> p_key))
           when 'string' then array[p.facets ->> p_key]
           else '{}'::text[] end
  end;
$$;

-- Does a product pass every selected filter except p_except?
-- p_sel: {"brand": ["BR-1","BR-2"], "section": ["مکمل"]}
create or replace function app.product_passes(p public.catalog_products, p_sel jsonb, p_except text default null)
returns boolean language sql immutable as $$
  select not exists (
    select 1 from jsonb_each(coalesce(p_sel, '{}'::jsonb)) s(k, vals)
    where s.k is distinct from p_except
      and jsonb_typeof(s.vals) = 'array' and jsonb_array_length(s.vals) > 0
      and not (app.product_values(p, s.k) && array(select jsonb_array_elements_text(s.vals))));
$$;

-- Product search for the Dorva products page and the pharmacy page.
-- p_pharmacy set: only that pharmacy's in-stock offers, at its prices.
create or replace function public.catalog_search(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_limit int default 48, p_offset int default 0)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, list_price numeric, max_discount numeric,
              pharmacies int, total int)
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
      and app.product_passes(p, p_filters)
  ),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, min(o.list_price) lp,
           max(o.discount_pct) md, count(*)::int n
    from app.offers o
    join prods pp on pp.id = o.product_id
    where (p_city is null or o.city_id = p_city)
      and (p_pharmacy is null or o.pharmacy_id = p_pharmacy)
    group by o.product_id
  ),
  res as (
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url,
           a.mn, a.mx, a.lp, a.md, coalesce(a.n, 0) n
    from prods p left join agg a on a.product_id = p.id
    -- with a city or pharmacy chosen, only what can actually be bought there
    where (p_pharmacy is null and p_city is null) or a.n is not null
  )
  select r.*, (count(*) over ())::int
  from res r
  order by r.n = 0, r.name_fa
  limit least(greatest(coalesce(p_limit, 48), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
grant execute on function public.catalog_search(int, text, jsonb, uuid, int, int) to anon, authenticated;

-- Options for every enabled filter, with counts.
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
  vals as (
    select k.facet_key, v.code, b.id
    from keys k
    join base b on app.product_passes(b, p_filters, k.facet_key)
    cross join lateral unnest(app.product_values(b, k.facet_key)) as v(code)
  )
  select v.facet_key, v.code,
         coalesce(fv.name_fa, v.code), coalesce(fv.name_i18n, '{}'::jsonb),
         count(distinct v.id)::int
  from vals v
  left join catalog_facet_values fv on fv.facet_key = v.facet_key and fv.value_code = v.code
  group by v.facet_key, v.code, fv.name_fa, fv.name_i18n;
$$;
grant execute on function public.catalog_filter_options(int, text, jsonb, uuid, text) to anon, authenticated;
