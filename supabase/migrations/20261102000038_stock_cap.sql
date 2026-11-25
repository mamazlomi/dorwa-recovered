-- The most a basket may hold of one product: that pharmacy's stock, or the
-- largest stock among active pharmacies when no pharmacy was chosen.
create or replace function public.product_max_qty(p_product uuid, p_pharmacy uuid default null)
returns int language sql stable security definer set search_path = public, pg_temp as $$
  select least(coalesce(max(s.quantity), 0), 99)::int
  from stock_items s join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
  where s.product_id = p_product and (p_pharmacy is null or s.pharmacy_id = p_pharmacy);
$$;
grant execute on function public.product_max_qty(uuid, uuid) to anon, authenticated;

-- /about explains how Dorva works; a pharmacy cannot take that address
create or replace function app.pharmacy_slug_guard() returns trigger
language plpgsql as $$
begin
  if new.slug::text in ('holding', 'holdings', 'product', 'products', 'orders', 'staff', 'shipping', 'complements',
                        'signin-link', 'finder', 'darooyabi', 'pharmacies', 'pharmacy', 'account', 'cart', 'checkout',
                        'login', 'admin', 'pages', 'about') then
    raise exception 'slug % is reserved', new.slug using errcode = '23514';
  end if;
  return new;
end $$;

-- every item of the home "why Dorva" band now opens a page that explains it
update public.page_layouts l
set published = (
  select jsonb_agg(case when b->>'type' = 'features' and b->>'id' = 'why' then
           jsonb_set(b, '{items}', (
             select jsonb_agg(case
                      when i->>'icon' = 'pharmacist' then i || '{"link":{"kind":"path","value":"/about#pharmacist"}}'
                      when i->>'icon' = 'shield' then i || '{"link":{"kind":"path","value":"/about#escrow"}}'
                      when i->>'icon' = 'chat' then i || '{"link":{"kind":"path","value":"/about#advice"}}'
                      when i->>'icon' = 'rx' then i || '{"link":{"kind":"path","value":"/about#rx"}}'
                      else i end order by n)
             from jsonb_array_elements(b->'items') with ordinality as x(i, n)))
         else b end order by m)
  from jsonb_array_elements(l.published) with ordinality as y(b, m))
where l.pharmacy_id is null and l.published is not null
  and jsonb_path_exists(l.published, '$[*] ? (@.type == "features" && @.id == "why")');

-- internal page links may point at a section of a page (/about#escrow)
create or replace function app.page_link_ok(p_link jsonb, p_pharmacy uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := coalesce(p_link->>'kind', 'none'); v text := coalesce(p_link->>'value', '');
begin
  if p_link is null or k = 'none' then return 'ok'; end if;
  if k = 'collection' then
    return case when exists (select 1 from collections c where c.slug = v and c.status = 'published'
                               and (c.pharmacy_id is null or c.pharmacy_id = p_pharmacy)) then 'ok' else 'collection' end;
  elsif k = 'product' then
    if v !~ '^[0-9a-f-]{36}$' then return 'link'; end if;
    if exists (select 1 from catalog_products p where p.id = v::uuid and p.dispensing_class = 'rx') then return 'rx'; end if;
    return case when exists (select 1 from catalog_products p where p.id = v::uuid) then 'ok' else 'link' end;
  elsif k = 'search' then
    return case when length(trim(v)) between 1 and 60 then 'ok' else 'link' end;
  elsif k = 'path' then
    -- internal pages only; never another site
    return case when v ~ '^/[a-z0-9/_?=&%.-]{0,150}(#[a-z0-9_-]{1,40})?$' and v !~ '^//' then 'ok' else 'link' end;
  end if;
  return 'link';
end $$;
