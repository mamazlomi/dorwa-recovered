-- Dorva-layer product settings, single or in bulk, from the product hub (Dorva panel › products):
--   max per order, minimum price, per-product commission, technical-officer approval override, display badge.
-- Kept in their own table so a product needs no price or listing to get them.
-- Catalog data stays read-only; price, publishing and discount caps stay where they were.

set search_path = public, extensions;

create table if not exists public.product_badges (
  code       text primary key check (code ~ '^[a-z_]{2,30}$'),
  label      jsonb not null,
  tone       text not null default 'brand' check (tone in ('brand', 'accent', 'amber', 'red', 'gray')),
  sort       int not null default 0,
  is_active  boolean not null default true
);
alter table public.product_badges enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_badges' and policyname = 'product_badges_read') then
    create policy product_badges_read on public.product_badges for select using (true);
  end if;
end $$;
insert into public.product_badges (code, label, tone, sort) values
  ('featured', '{"fa":"پیشنهاد ویژه","en":"Featured","ar":"عرض خاص"}', 'accent', 10),
  ('new', '{"fa":"جدید","en":"New","ar":"جديد"}', 'brand', 20),
  ('bestseller', '{"fa":"پرفروش","en":"Best seller","ar":"الأكثر مبيعاً"}', 'amber', 30),
  ('limited', '{"fa":"تعداد محدود","en":"Limited","ar":"كمية محدودة"}', 'red', 40)
on conflict (code) do nothing;

create table if not exists public.product_settings (
  product_id      uuid primary key references public.catalog_products(id) on delete cascade,
  max_per_order   int check (max_per_order between 1 and 999),
  min_price       numeric(14,0) check (min_price > 0),          -- Rial; the lowest final price a pharmacy may sell at
  commission_pct  numeric(5,2) check (commission_pct between 0 and 100),
  tech_approval   boolean,                                      -- null = by product class
  badge           text references public.product_badges(code) on update cascade on delete set null,
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);
alter table public.product_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_settings' and policyname = 'product_settings_read') then
    create policy product_settings_read on public.product_settings for select using (true);
  end if;
end $$;

-- ---------------------------------------------------------------- technical-officer approval
create or replace function app.class_needs_tech(p_class text) returns boolean
language sql immutable as $$ select p_class in ('supplement', 'otc', 'rx') $$;

-- the catalog sync (or anything else) writes the class default; a Dorva override wins
create or replace function app.catalog_tech_override() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v boolean;
begin
  -- Rx keeps its own value (the table constraint refuses Rx without approval)
  if new.dispensing_class = 'rx' then return new; end if;
  select tech_approval into v from product_settings where product_id = new.id;
  if v is not null then new.requires_tech_approval := v; end if;
  return new;
end $$;
create or replace trigger catalog_tech_override before insert or update of requires_tech_approval, dispensing_class
  on public.catalog_products for each row execute function app.catalog_tech_override();

create or replace function app.product_settings_apply() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update catalog_products p
     set requires_tech_approval = case when p.dispensing_class = 'rx' then true
                                       else coalesce(new.tech_approval, app.class_needs_tech(p.dispensing_class)) end
   where p.id = new.product_id;
  return new;
end $$;
create or replace trigger product_settings_apply after insert or update of tech_approval
  on public.product_settings for each row execute function app.product_settings_apply();

-- ---------------------------------------------------------------- max per order
create or replace function public.product_max_qty(p_product uuid, p_pharmacy uuid default null)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select least(coalesce(max(s.quantity), 0), 99,
               coalesce((select max_per_order from product_settings where product_id = p_product), 999))::int
  from stock_items s join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
  where s.product_id = p_product and (p_pharmacy is null or s.pharmacy_id = p_pharmacy);
$$;

create or replace function app.cart_lines(p_items jsonb)
returns table (product_id uuid, qty integer, dispensing_class text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select x.product_id, least(greatest(sum(x.qty), 1), 99, coalesce(max(ps.max_per_order), 999))::int, p.dispensing_class
  from (
    select (e->>'product_id')::uuid as product_id, coalesce((e->>'qty')::int, 1) as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where e ? 'product_id'
  ) x
  join public.catalog_products p on p.id = x.product_id and p.is_active
  join public.product_listings l on l.product_id = x.product_id and l.is_published
  left join public.product_settings ps on ps.product_id = x.product_id
  group by x.product_id, p.dispensing_class;
$$;

-- ---------------------------------------------------------------- per-product commission
create or replace function app.commission_pct(p_class text, p_product uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select commission_pct from product_settings where product_id = p_product), app.commission_pct(p_class));
$$;
do $$
declare d text;
begin
  d := pg_get_functiondef('app.refresh_settlement(uuid)'::regprocedure);
  if position('app.commission_pct(i.dispensing_class)' in d) > 0 then
    execute replace(d, 'app.commission_pct(i.dispensing_class)', 'app.commission_pct(i.dispensing_class, i.product_id)');
  elsif position('app.commission_pct(i.dispensing_class, i.product_id)' in d) = 0 then
    raise exception 'refresh_settlement: commission expression not found';
  end if;
end $$;

-- ---------------------------------------------------------------- minimum price
create or replace function app.check_stock_policy() returns trigger
language plpgsql as $$
declare
  l public.product_listings;
  max_disc numeric;
  v_min numeric;
begin
  select * into l from public.product_listings where product_id = new.product_id;
  max_disc := app.max_discount(new.product_id);

  if max_disc is not null and new.discount_pct > max_disc then
    raise exception 'discount % exceeds max allowed % for this product', new.discount_pct, max_disc
      using errcode = 'check_violation';
  end if;
  if l.price_policy = 'cap' and new.price > l.base_price then
    raise exception 'price above Dorva cap' using errcode = 'check_violation';
  end if;
  if l.price_policy = 'floor' and new.price < l.base_price then
    raise exception 'price below Dorva floor' using errcode = 'check_violation';
  end if;
  if l.price_policy = 'free' and new.price is null and l.base_price is null then
    raise exception 'price required for this product' using errcode = 'check_violation';
  end if;
  select min_price into v_min from public.product_settings where product_id = new.product_id;
  if v_min is not null and app.effective_price(coalesce(l.price_policy, 'free'), l.base_price, new.price,
                                               least(new.discount_pct, coalesce(max_disc, 100))) < v_min then
    raise exception 'final price below Dorva minimum' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
alter function app.check_stock_policy() set search_path = public, extensions, pg_temp;

-- a minimum set later also holds for prices already on offer
create or replace view app.offers
with (security_barrier = true) as
select s.pharmacy_id, s.product_id, ph.slug as pharmacy_slug, ph.city_id,
       greatest(app.effective_price(l.price_policy, l.base_price, s.price, least(s.discount_pct, m.cap)), coalesce(ps.min_price, 0)) as final_price,
       coalesce(s.price, l.base_price) as list_price,
       least(s.discount_pct, m.cap)::numeric(5,2) as discount_pct
from public.stock_items s
join public.pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
join public.product_listings l on l.product_id = s.product_id and l.is_published
join public.catalog_products p on p.id = s.product_id and p.is_active
join app.product_caps m on m.product_id = s.product_id
left join public.product_settings ps on ps.product_id = s.product_id
where s.quantity > 0;

-- ---------------------------------------------------------------- the product hub
create or replace function public.admin_products() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_platform_permission('catalog.publish') or app.has_platform_permission('policy.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'name_fa', p.name_fa, 'name_i18n', p.name_i18n, 'cls', p.dispensing_class, 'path', p.category_path,
      'brand', (select coalesce(v.name_fa, b) from jsonb_array_elements_text(case when jsonb_typeof(p.facets->'brand') = 'array' then p.facets->'brand' else '[]' end) b
                 left join catalog_facet_values v on v.facet_key = 'brand' and v.value_code = b limit 1),
      'maker', (select coalesce(v.name_fa, b) from jsonb_array_elements_text(case when jsonb_typeof(p.facets->'manufacturer') = 'array' then p.facets->'manufacturer' else '[]' end) b
                 left join catalog_facet_values v on v.facet_key = 'manufacturer' and v.value_code = b limit 1),
      'src', p.source, 'complete', p.complete, 'missing', case when cardinality(p.missing) > 0 then p.missing end,
      'code', p.internal_code, 'irc', p.irc, 'gtin', p.gtin,
      'pub', coalesce(l.is_published, false), 'price', l.base_price, 'policy', coalesce(l.price_policy, 'fixed'),
      'pcap', r.max_discount_pct, 'cap', c.max_discount_pct, 'cap_src', c.source,
      'stock', (select count(*) from stock_items s join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
                 where s.product_id = p.id and s.quantity > 0),
      'min', ps.min_price, 'maxq', ps.max_per_order, 'comm', ps.commission_pct, 'comm_eff', app.commission_pct(p.dispensing_class, p.id),
      'tech', ps.tech_approval, 'tech_eff', p.requires_tech_approval, 'badge', ps.badge)) order by p.name_fa), '[]'::jsonb)
    from catalog_products p
    left join product_listings l on l.product_id = p.id
    left join product_settings ps on ps.product_id = p.id
    left join discount_caps r on r.scope = 'product' and r.product_id = p.id and r.is_active
    cross join lateral public.discount_cap(p.id) c
    where p.is_active);
end $$;

-- one save for the whole hub: listing fields go through listing_bulk_save, the rest are settled here
-- security definer: product_settings has no write policy; every write is checked here by permission
create or replace function public.product_admin_save(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; v_pid uuid; v_list jsonb := '[]'; v_res jsonb; v_err jsonb := '[]'; v_bad text[] := '{}'; v_n int := 0;
  k text; v_cls text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    return jsonb_build_object('ok', 0, 'errors', jsonb_build_array(jsonb_build_object('id', null, 'code', 'too_many')));
  end if;
  select coalesce(jsonb_agg(x), '[]') into v_list
    from (select jsonb_object_agg(e.key, e.value) x
            from jsonb_array_elements(p_items) with ordinality t(i, n), jsonb_each(t.i) e
           where e.key in ('id', 'is_published', 'base_price', 'price_policy', 'product_cap')
           group by n having count(*) > 1) y;
  if jsonb_array_length(v_list) > 0 then
    v_res := public.listing_bulk_save(v_list);
    v_err := v_err || coalesce(v_res->'errors', '[]');
    select coalesce(array_agg(e->>'id'), '{}') into v_bad from jsonb_array_elements(v_err) e;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    continue when (it->>'id') = any (v_bad);
    if not (it ?| array['max_per_order', 'min_price', 'commission_pct', 'tech_approval', 'badge']) then
      v_n := v_n + 1; continue;
    end if;
    begin
      v_pid := (it->>'id')::uuid;
      select dispensing_class into v_cls from catalog_products where id = v_pid;
      if v_cls is null then v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'missing'); continue; end if;
      if (it ? 'max_per_order' and it->>'max_per_order' is not null and (it->>'max_per_order' !~ '^[0-9]{1,3}$' or (it->>'max_per_order')::int < 1))
         or (it ? 'min_price' and it->>'min_price' is not null and it->>'min_price' !~ '^[0-9]{1,13}$')
         or (it ? 'commission_pct' and it->>'commission_pct' is not null and (it->>'commission_pct' !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or (it->>'commission_pct')::numeric > 100))
         or (it ? 'tech_approval' and it->>'tech_approval' is not null and it->>'tech_approval' not in ('true', 'false'))
         or (it ? 'badge' and it->>'badge' is not null and not exists (select 1 from product_badges where code = it->>'badge' and is_active)) then
        v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'value'); continue;
      end if;
      if v_cls = 'rx' and it->>'tech_approval' = 'false' then
        v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'rx_tech'); continue;
      end if;
      if it ? 'commission_pct' and not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
      if (it ?| array['max_per_order', 'min_price', 'tech_approval', 'badge']) and not app.has_platform_permission('catalog.publish') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      insert into product_settings as s (product_id, max_per_order, min_price, commission_pct, tech_approval, badge, updated_by, updated_at)
      values (v_pid, (it->>'max_per_order')::int, (it->>'min_price')::numeric, (it->>'commission_pct')::numeric,
              (it->>'tech_approval')::boolean, it->>'badge', auth.uid(), now())
      on conflict (product_id) do update set
        max_per_order = case when it ? 'max_per_order' then excluded.max_per_order else s.max_per_order end,
        min_price = case when it ? 'min_price' then excluded.min_price else s.min_price end,
        commission_pct = case when it ? 'commission_pct' then excluded.commission_pct else s.commission_pct end,
        tech_approval = case when it ? 'tech_approval' then excluded.tech_approval else s.tech_approval end,
        badge = case when it ? 'badge' then excluded.badge else s.badge end,
        updated_by = auth.uid(), updated_at = now();
      v_n := v_n + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('id', it->>'id', 'code', case when sqlstate = '42501' then 'forbidden' when sqlstate = '23514' then 'value' else 'unknown' end);
    end;
  end loop;
  return jsonb_build_object('ok', v_n, 'errors', v_err);
end $$;

-- the product page and cards read the badge and limits of a product
create or replace function public.product_extras(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(ps.product_id, jsonb_strip_nulls(jsonb_build_object(
           'badge', case when b.is_active then jsonb_build_object('code', b.code, 'label', b.label, 'tone', b.tone) end,
           'max_per_order', ps.max_per_order))), '{}'::jsonb)
  from product_settings ps left join product_badges b on b.code = ps.badge
  where ps.product_id = any (p_ids[1:500]);
$$;

grant execute on function public.admin_products() to authenticated;
grant execute on function public.product_admin_save(jsonb) to authenticated;
grant execute on function public.product_extras(uuid[]) to anon, authenticated;
