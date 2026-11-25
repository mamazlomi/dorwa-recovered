-- Fine-grained discount caps (Dorva pricing policy, no code needed).
-- Most specific rule wins: product > brand > category (longest path) >
-- dispensing class (category_policies) > 0.
-- A specific rule may be higher or lower than the class cap.

create table public.discount_rules (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null check (scope in ('category', 'brand', 'product')),
  category_path    text[],
  brand            text,
  product_id       uuid references public.catalog_products(id),
  max_discount_pct numeric(5,2) not null check (max_discount_pct between 0 and 100),
  note             text,
  is_active        boolean not null default true,
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  constraint discount_rules_target check (
       (scope = 'category' and category_path is not null and cardinality(category_path) > 0
                           and brand is null and product_id is null)
    or (scope = 'brand'    and nullif(trim(brand), '') is not null
                           and category_path is null and product_id is null)
    or (scope = 'product'  and product_id is not null
                           and category_path is null and brand is null))
);
create unique index discount_rules_category_uq on public.discount_rules (category_path) where scope = 'category';
create unique index discount_rules_brand_uq    on public.discount_rules (lower(trim(brand))) where scope = 'brand';
create unique index discount_rules_product_uq  on public.discount_rules (product_id) where scope = 'product';

alter table public.discount_rules enable row level security;
create policy read_all on public.discount_rules for select using (true);
create policy manage on public.discount_rules for all to authenticated
  using (app.has_platform_permission('settings.manage'))
  with check (app.has_platform_permission('settings.manage'));
grant select on public.discount_rules to anon, authenticated;
grant insert, update, delete on public.discount_rules to authenticated;

create or replace function app.touch_discount_rule() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger discount_rules_touch before insert or update on public.discount_rules
  for each row execute function app.touch_discount_rule();

-- The cap that applies to one product right now.
create or replace function app.max_discount(p_product uuid) returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.max_discount_pct from discount_rules r
      where r.is_active and r.scope = 'product' and r.product_id = p.id),
    (select r.max_discount_pct from discount_rules r
      where r.is_active and r.scope = 'brand'
        and lower(trim(r.brand)) = lower(trim(p.facets ->> 'brand'))),
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

-- Public helper: the cap and which rule set it (for the admin and pharmacy UI).
create or replace function public.discount_cap(p_product uuid)
returns table(max_discount_pct numeric, source text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.max_discount(p.id),
    case
      when exists (select 1 from discount_rules r where r.is_active and r.scope = 'product' and r.product_id = p.id) then 'product'
      when exists (select 1 from discount_rules r where r.is_active and r.scope = 'brand'
                     and lower(trim(r.brand)) = lower(trim(p.facets ->> 'brand'))) then 'brand'
      when exists (select 1 from discount_rules r where r.is_active and r.scope = 'category'
                     and p.category_path[1:cardinality(r.category_path)] = r.category_path) then 'category'
      else 'class'
    end
  from catalog_products p where p.id = p_product;
$$;
grant execute on function public.discount_cap(uuid) to anon, authenticated;

-- Impact preview before saving a rule: how many live offers have a
-- discount above the proposed cap for that scope.
create or replace function public.discount_rule_impact(
  p_scope text, p_category_path text[] default null, p_brand text default null,
  p_product uuid default null, p_max numeric default 0)
returns table(products int, offers_above int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with target as (
    select p.id from catalog_products p
    where case p_scope
      when 'product'  then p.id = p_product
      when 'brand'    then lower(trim(p.facets ->> 'brand')) = lower(trim(p_brand))
      when 'category' then p.category_path[1:cardinality(p_category_path)] = p_category_path
      else false end)
  select (select count(*) from target)::int,
         (select count(*) from stock_items s join target t on t.id = s.product_id
           where s.quantity > 0 and s.discount_pct > p_max)::int
  where app.has_platform_permission('settings.manage');
$$;
grant execute on function public.discount_rule_impact(text, text[], text, uuid, numeric) to authenticated;

-- Writes: reject a discount above the cap that applies to the product.
create or replace function app.check_stock_policy() returns trigger
language plpgsql as $$
declare
  l public.product_listings;
  max_disc numeric;
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
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- Reads: if a cap is lowered later, existing discounts are clipped to it
-- at once, so every price the customer sees respects the current policy.
create or replace view app.offers
with (security_barrier = true) as
select s.pharmacy_id, s.product_id, ph.slug as pharmacy_slug, ph.city_id,
       app.effective_price(l.price_policy, l.base_price, s.price,
                           least(s.discount_pct, app.max_discount(s.product_id))) as final_price,
       coalesce(s.price, l.base_price) as list_price,
       least(s.discount_pct, app.max_discount(s.product_id))::numeric(5,2) as discount_pct
from public.stock_items s
join public.pharmacies ph      on ph.id = s.pharmacy_id and ph.status = 'active'
join public.product_listings l on l.product_id = s.product_id and l.is_published
join public.catalog_products p on p.id = s.product_id and p.is_active
where s.quantity > 0;
