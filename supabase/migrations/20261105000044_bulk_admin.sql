-- Bulk editing in the Dorva panel:
--  * prices and publishing of catalog products (product_listings) and each
--    product's own discount cap, edited many at a time;
--  * discount cap rules (category / brand / product) edited many at a time.
-- The save functions run as the caller: row security (catalog.publish,
-- policy.manage) and table checks apply to every row; a failing row is
-- reported and the others are saved.

create or replace function public.admin_catalog_prices()
returns table (product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[], brand text,
               is_published boolean, base_price numeric, price_policy text, product_cap numeric, cap numeric, cap_source text,
               pharmacies int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_platform_permission('catalog.publish') or app.has_platform_permission('policy.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path,
           case jsonb_typeof(p.facets->'brand') when 'array' then p.facets->'brand'->>0 else p.facets->>'brand' end,
           coalesce(l.is_published, false), l.base_price, coalesce(l.price_policy, 'fixed'),
           r.max_discount_pct, c.max_discount_pct, c.source,
           (select count(*)::int from stock_items s join pharmacies ph on ph.id = s.pharmacy_id
             where s.product_id = p.id and s.quantity > 0 and ph.status = 'active')
    from catalog_products p
    left join product_listings l on l.product_id = p.id
    left join discount_caps r on r.scope = 'product' and r.product_id = p.id and r.is_active
    cross join lateral public.discount_cap(p.id) c
    where p.is_active
    order by p.name_fa;
end $$;

create or replace function public.listing_bulk_save(p_items jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare it jsonb; v_ok int := 0; v_err jsonb := '[]'::jsonb; v_pid uuid; v_code text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    return jsonb_build_object('ok', 0, 'errors', jsonb_build_array(jsonb_build_object('id', null, 'code', 'too_many')));
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      v_pid := (it->>'id')::uuid;
      if (it ? 'base_price' and it->>'base_price' is not null and it->>'base_price' !~ '^[0-9]{1,13}$')
         or (it ? 'product_cap' and it->>'product_cap' is not null and (it->>'product_cap' !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or (it->>'product_cap')::numeric > 100))
         or (it ? 'price_policy' and it->>'price_policy' not in ('fixed', 'cap', 'floor', 'free')) then
        v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'value'); continue;
      end if;
      if it ? 'is_published' or it ? 'base_price' or it ? 'price_policy' then
        if not app.has_platform_permission('catalog.publish') then raise exception 'forbidden' using errcode = '42501'; end if;
        insert into product_listings (product_id, is_published, base_price, price_policy, updated_by, updated_at)
        values (v_pid, coalesce((it->>'is_published')::boolean, false), nullif(it->>'base_price', '')::numeric,
                coalesce(it->>'price_policy', 'fixed'), auth.uid(), now())
        on conflict (product_id) do update set
          is_published = case when it ? 'is_published' then (it->>'is_published')::boolean else product_listings.is_published end,
          base_price = case when it ? 'base_price' then nullif(it->>'base_price', '')::numeric else product_listings.base_price end,
          price_policy = case when it ? 'price_policy' then it->>'price_policy' else product_listings.price_policy end,
          updated_by = auth.uid(), updated_at = now();
      end if;
      if it ? 'product_cap' then
        if not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
        if it->>'product_cap' is null then
          delete from discount_caps where scope = 'product' and product_id = v_pid;
        else
          insert into discount_caps (scope, product_id, max_discount_pct, is_active, updated_by)
          values ('product', v_pid, (it->>'product_cap')::numeric, true, auth.uid())
          on conflict (product_id) where scope = 'product' do update set max_discount_pct = excluded.max_discount_pct, is_active = true, updated_by = auth.uid();
        end if;
      end if;
      v_ok := v_ok + 1;
    exception when others then
      v_code := case when sqlstate = '42501' then 'forbidden'
                     when sqlstate = '23514' and (sqlerrm like '%base_price%' or sqlerrm like '%product_listings_check%') then 'needs_price'
                     when sqlstate = '23514' then 'value' else 'unknown' end;
      v_err := v_err || jsonb_build_object('id', it->>'id', 'code', v_code);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_err);
end $$;

create or replace function public.discount_caps_bulk(p_items jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare it jsonb; v_ok int := 0; v_err jsonb := '[]'::jsonb; n int;
begin
  if not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    return jsonb_build_object('ok', 0, 'errors', jsonb_build_array(jsonb_build_object('id', null, 'code', 'too_many')));
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if (it ? 'max_discount_pct' and (coalesce(it->>'max_discount_pct', '') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or (it->>'max_discount_pct')::numeric > 100)) then
        v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'value'); continue;
      end if;
      update discount_caps set
        max_discount_pct = case when it ? 'max_discount_pct' then (it->>'max_discount_pct')::numeric else max_discount_pct end,
        is_active = case when it ? 'is_active' then (it->>'is_active')::boolean else is_active end,
        updated_by = auth.uid()
      where id = (it->>'id')::uuid;
      get diagnostics n = row_count;
      if n = 0 then v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'missing'); else v_ok := v_ok + 1; end if;
    exception when others then
      v_err := v_err || jsonb_build_object('id', it->>'id', 'code', case when sqlstate = '42501' then 'forbidden' else 'unknown' end);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_err);
end $$;

grant execute on function public.admin_catalog_prices() to authenticated;
grant execute on function public.listing_bulk_save(jsonb) to authenticated;
grant execute on function public.discount_caps_bulk(jsonb) to authenticated;

-- ---------------------------------------------------------------- pharmacy price changes need Dorva's approval
-- Prices are Dorva's. When a pharmacy sets or changes its own price, the request
-- waits in price_requested and the current price stays live until Dorva approves.
-- Going back to Dorva's price (empty price) needs no approval. Dorva staff with
-- policy.manage (e.g. running virtual pharmacies) change prices directly.
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('pricing.approval', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"تغییر قیمت داروخانه‌ها با تأیید دوروا","en":"Pharmacy price changes need Dorva approval","ar":"تغيير أسعار الصيدليات بموافقة دوروا"}',
   '{"fa":"روشن: قیمتی که داروخانه وارد می‌کند تا تأیید دوروا اعمال نمی‌شود و قیمت قبلی می‌ماند. برگشت به قیمت دوروا تأیید لازم ندارد.","en":"On: a price a pharmacy enters waits for Dorva; the previous price stays live. Going back to Dorva''s price needs no approval.","ar":"تشغيل: السعر ينتظر موافقة دوروا."}', 640)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('pricing.approval', 'platform', 'true', 'تغییر قیمت داروخانه‌ها با تأیید دوروا')
on conflict do nothing;

alter table public.stock_items add column if not exists price_requested numeric(14,0) check (price_requested is null or price_requested > 0);
alter table public.stock_items add column if not exists price_requested_at timestamptz;
alter table public.stock_items add column if not exists price_review_note text check (price_review_note is null or length(price_review_note) <= 300);
create index if not exists stock_items_price_requests on public.stock_items (price_requested_at) where price_requested is not null;

-- runs after stock_items_policy (alphabetical), so a requested price has already passed the cap/floor checks
create or replace function app.stock_price_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old numeric := case when tg_op = 'UPDATE' then old.price end;
begin
  if current_setting('app.price_approving', true) = 'on' then return new; end if;
  if new.price is not distinct from v_old then return new; end if;
  if new.price is null then                                   -- back to Dorva's price: immediate
    new.price_requested := null; new.price_requested_at := null;
    return new;
  end if;
  if not app.setting_bool('pricing.approval', true) or app.has_platform_permission('policy.manage')
     or auth.uid() is null then                               -- off, Dorva staff, or system jobs
    new.price_requested := null; new.price_requested_at := null;
    return new;
  end if;
  new.price_requested := new.price;
  new.price_requested_at := now();
  new.price_review_note := null;
  new.price := v_old;
  return new;
end $$;
drop trigger if exists stock_items_price_approval on public.stock_items;
create trigger stock_items_price_approval before insert or update on public.stock_items
  for each row execute function app.stock_price_approval();

-- inventory overview, now with the pending request and Dorva's last note
drop function if exists public.pharmacy_stock_overview(uuid);
create function public.pharmacy_stock_overview(p_pharmacy uuid)
returns table(
  stock_id uuid, product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text,
  category_path text[], facets jsonb, quantity int, own_price numeric, own_discount numeric,
  cap numeric, cap_source text, effective_discount numeric, list_price numeric, final_price numeric,
  published boolean, price_requested numeric, price_review_note text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.facets,
         s.quantity, s.price, s.discount_pct,
         c.max_discount_pct, c.source,
         least(s.discount_pct, c.max_discount_pct),
         coalesce(s.price, l.base_price),
         app.effective_price(l.price_policy, l.base_price, s.price, least(s.discount_pct, c.max_discount_pct)),
         coalesce(l.is_published, false), s.price_requested, s.price_review_note
  from stock_items s
  join catalog_products p on p.id = s.product_id
  left join product_listings l on l.product_id = s.product_id
  cross join lateral public.discount_cap(s.product_id) c
  where s.pharmacy_id = p_pharmacy
    and (app.is_pharmacy_member(p_pharmacy) or app.has_platform_permission('pharmacy.read_all'));
$$;
revoke execute on function public.pharmacy_stock_overview(uuid) from anon, public;
grant execute on function public.pharmacy_stock_overview(uuid) to authenticated;

-- Dorva's queue of price requests
create or replace function public.price_requests()
returns table (stock_id uuid, pharmacy_id uuid, pharmacy_name text, city_name text, product_id uuid, product_name text,
               dispensing_class text, base_price numeric, price_policy text, current_price numeric, requested numeric,
               requested_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, ph.id, ph.name_fa, c.name_fa, p.id, p.name_fa, p.dispensing_class, l.base_price, coalesce(l.price_policy, 'fixed'),
           coalesce(s.price, l.base_price), s.price_requested, s.price_requested_at
    from stock_items s join pharmacies ph on ph.id = s.pharmacy_id join catalog_products p on p.id = s.product_id
    left join cities c on c.id = ph.city_id left join product_listings l on l.product_id = s.product_id
    where s.price_requested is not null
    order by s.price_requested_at;
end $$;

-- approve or reject many requests at once; returns how many were decided.
-- p_scope 'this': the pharmacy's own price becomes the requested one.
-- p_scope 'all': the requested price becomes Dorva's price for the product, and every
-- pharmacy's own price for it is cleared, so all pharmacies sell at that price.
drop function if exists public.price_requests_decide(uuid[], boolean, text);
create or replace function public.price_requests_decide(p_stock uuid[], p_approve boolean, p_note text default null, p_scope text default 'this')
returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; r record;
begin
  if not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'note' using errcode = '22023'; end if;
  if p_scope not in ('this', 'all') then raise exception 'scope' using errcode = '22023'; end if;
  perform set_config('app.price_approving', 'on', true);
  if not p_approve then
    update stock_items set price_requested = null, price_requested_at = null, price_review_note = left(trim(p_note), 300)
    where id = any(p_stock) and price_requested is not null;
    get diagnostics n = row_count;
  elsif p_scope = 'this' then
    update stock_items set price = price_requested, price_requested = null, price_requested_at = null, price_review_note = null,
                           updated_at = now()
    where id = any(p_stock) and price_requested is not null;
    get diagnostics n = row_count;
  else
    -- one request per product wins (the newest) when several pharmacies asked for the same product
    for r in select distinct on (product_id) id, product_id, price_requested from stock_items
             where id = any(p_stock) and price_requested is not null order by product_id, price_requested_at desc loop
      insert into product_listings (product_id, is_published, base_price, updated_by, updated_at)
      values (r.product_id, false, r.price_requested, auth.uid(), now())
      on conflict (product_id) do update set base_price = excluded.base_price, updated_by = auth.uid(), updated_at = now();
      update stock_items set price = null, updated_at = now() where product_id = r.product_id and price is not null;
      update stock_items set price_requested = null, price_requested_at = null, price_review_note = null
      where product_id = r.product_id and id = any(p_stock);
      n := n + 1;
    end loop;
  end if;
  perform set_config('app.price_approving', 'off', true);
  return n;
end $$;
grant execute on function public.price_requests() to authenticated;
grant execute on function public.price_requests_decide(uuid[], boolean, text, text) to authenticated;
