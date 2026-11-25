-- Discount rules target catalog facets by stable code (brand, manufacturer,
-- country, dosage form, ...) instead of a brand name. The table is still
-- empty. The reshape (dropping the brand column) is blocked on the hosted
-- project, so 010 moves the rules to a new table instead.
--
-- Product facets arrive from the catalog as {"<facet_key>": ["<code>", ...]}.
-- Precedence: product > facet (lowest cap if several match) > category
-- (longest path) > dispensing class > 0.

alter table public.discount_rules
  add column facet_key   text,
  add column facet_value text;
create unique index discount_rules_facet_uq on public.discount_rules (facet_key, facet_value) where scope = 'facet';

-- Labels for facet codes, synced from the catalog (brand names etc.).
create table public.catalog_facet_values (
  facet_key  text not null,
  value_code text not null,
  name_fa    text not null,
  name_i18n  jsonb not null default '{}',
  primary key (facet_key, value_code)
);
alter table public.catalog_facet_values enable row level security;
create policy read_all on public.catalog_facet_values for select using (true);
grant select on public.catalog_facet_values to anon, authenticated;

create or replace function app.product_has_facet(p_facets jsonb, p_key text, p_value text)
returns boolean language sql immutable as $$
  select coalesce(
    case jsonb_typeof(p_facets -> p_key)
      when 'array'  then (p_facets -> p_key) ? p_value
      when 'string' then (p_facets ->> p_key) = p_value
      else false end, false);
$$;

create or replace function app.max_discount(p_product uuid) returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.max_discount_pct from discount_rules r
      where r.is_active and r.scope = 'product' and r.product_id = p.id),
    (select min(r.max_discount_pct) from discount_rules r
      where r.is_active and r.scope = 'facet'
        and app.product_has_facet(p.facets, r.facet_key, r.facet_value)),
    (select r.max_discount_pct from discount_rules r
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
      when exists (select 1 from discount_rules r where r.is_active and r.scope = 'product' and r.product_id = p.id) then 'product'
      when exists (select 1 from discount_rules r where r.is_active and r.scope = 'facet'
                     and app.product_has_facet(p.facets, r.facet_key, r.facet_value)) then 'facet'
      when exists (select 1 from discount_rules r where r.is_active and r.scope = 'category'
                     and p.category_path[1:cardinality(r.category_path)] = r.category_path) then 'category'
      else 'class'
    end
  from catalog_products p where p.id = p_product;
$$;

create or replace function public.discount_rule_impact(
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
grant execute on function public.discount_rule_impact(text, text[], text, text, uuid, numeric) to authenticated;
