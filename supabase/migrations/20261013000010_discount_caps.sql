-- Discount caps by catalog code, in a fresh table.
-- The hosted project blocks destructive DDL, so instead of reshaping the
-- (still empty) discount_rules table we create discount_caps and point the
-- price logic at it. discount_rules and discount_rule_impact are unused from
-- here on and can be dropped later by the owner.
--
-- Precedence: product > facet (lowest cap if several match) > category
-- (longest path) > dispensing class (category_policies) > 0.

create table public.discount_caps (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('category', 'facet', 'product')),
  category_path    text[],
  facet_key        text,
  facet_value      text,
  product_id       uuid references public.catalog_products(id),
  max_discount_pct numeric(5,2) not null check (max_discount_pct between 0 and 100),
  note             text,
  is_active        boolean not null default true,
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  constraint discount_caps_target check (
       (scope = 'category' and category_path is not null and cardinality(category_path) > 0
                           and facet_key is null and facet_value is null and product_id is null)
    or (scope = 'facet'    and nullif(trim(facet_key), '') is not null and nullif(trim(facet_value), '') is not null
                           and category_path is null and product_id is null)
    or (scope = 'product'  and product_id is not null
                           and category_path is null and facet_key is null and facet_value is null))
);
create unique index discount_caps_category_uq on public.discount_caps (category_path) where scope = 'category';
create unique index discount_caps_facet_uq    on public.discount_caps (facet_key, facet_value) where scope = 'facet';
create unique index discount_caps_product_uq  on public.discount_caps (product_id) where scope = 'product';

alter table public.discount_caps enable row level security;
create policy read_all on public.discount_caps for select using (true);
create policy manage on public.discount_caps for all to authenticated
  using (app.has_platform_permission('settings.manage'))
  with check (app.has_platform_permission('settings.manage'));
grant select on public.discount_caps to anon, authenticated;
grant insert, update on public.discount_caps to authenticated;  -- rules are switched off, not deleted (audit)

create trigger discount_caps_touch before insert or update on public.discount_caps
  for each row execute function app.touch_discount_rule();

create or replace function app.max_discount(p_product uuid) returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.max_discount_pct from discount_caps r
      where r.is_active and r.scope = 'product' and r.product_id = p.id),
    (select min(r.max_discount_pct) from discount_caps r
      where r.is_active and r.scope = 'facet'
        and app.product_has_facet(p.facets, r.facet_key, r.facet_value)),
    (select r.max_discount_pct from discount_caps r
      where r.is_active and r.scope = 'category'
        and p.category_path[1:cardinality(r.category_path)] = r.category_path
      order by cardinality(r.category_path) desc
      limit 1),
    (select cp.max_discount_pct from category_policies cp
      where cp.dispensing_class = p.dispensing_class),
    0)
  from catalog_products p
  where p.id = p_product;
$$;

create or replace function public.discount_cap(p_product uuid)
returns table(max_discount_pct numeric, source text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.max_discount(p.id),
    case
      when exists (select 1 from discount_caps r where r.is_active and r.scope = 'product' and r.product_id = p.id) then 'product'
      when exists (select 1 from discount_caps r where r.is_active and r.scope = 'facet'
                     and app.product_has_facet(p.facets, r.facet_key, r.facet_value)) then 'facet'
      when exists (select 1 from discount_caps r where r.is_active and r.scope = 'category'
                     and p.category_path[1:cardinality(r.category_path)] = r.category_path) then 'category'
      else 'class'
    end
  from catalog_products p where p.id = p_product;
$$;

create or replace function public.discount_caps_impact(
  p_scope text, p_category_path text[] default null, p_facet_key text default null,
  p_facet_value text default null, p_product uuid default null, p_max numeric default 0)
returns table(products int, offers_above int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with target as (
    select p.id from catalog_products p
    where case p_scope
      when 'product'  then p.id = p_product
      when 'facet'    then app.product_has_facet(p.facets, p_facet_key, p_facet_value)
      when 'category' then p.category_path[1:cardinality(p_category_path)] = p_category_path
      else false end)
  select (select count(*) from target)::int,
         (select count(*) from stock_items s join target t on t.id = s.product_id
           where s.quantity > 0 and s.discount_pct > p_max)::int
  where app.has_platform_permission('settings.manage');
$$;
grant execute on function public.discount_caps_impact(text, text[], text, text, uuid, numeric) to authenticated;
