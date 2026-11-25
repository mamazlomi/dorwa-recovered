-- T103-T108: two-layer shipping (Dorva / pharmacy) and complementary products
create temp table t_sh as
select o.product_id, o.pharmacy_id
from app.offers o join public.catalog_products cp on cp.id = o.product_id
join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
join public.pharmacies ph on ph.id = o.pharmacy_id and ph.is_virtual
where o.city_id = (select id from public.cities where slug = 'tehran') and cp.dispensing_class = 'general' and s.quantity >= 3
limit 1;
grant select on t_sh to authenticated;

-- the Dorva admin (super_admin from 96) acts for the virtual pharmacy
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$
declare c record; v jsonb; st text; dorva_fee numeric;
begin
  select * into c from t_sh;
  if c.pharmacy_id is null then raise notice 'SKIP T103-T106: no general product at a virtual pharmacy'; return; end if;
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), null, 35.70, 51.40, null, c.pharmacy_id);
  dorva_fee := (v->'pharmacies'->0->>'shipping')::numeric;

  -- T105: values outside Dorva's bounds are refused
  st := public.pharmacy_shipping_save(c.pharmacy_id, true, 999999999, 1000, 0, 5, 3, 20, true);
  if st <> 'base_fee' then raise exception 'TEST FAIL T105: %', st; end if;
  st := public.pharmacy_shipping_save(c.pharmacy_id, true, 100000, 1000, 0, 10, 3, 20, true);
  if st <> 'ok' then raise exception 'TEST FAIL T105: valid values refused %', st; end if;

  -- T103: while Dorva delivers (default), the pharmacy's own rates are ignored
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), null, 35.70, 51.40, null, c.pharmacy_id);
  if (v->'pharmacies'->0->>'shipping')::numeric <> dorva_fee or v->'pharmacies'->0->>'provider' <> 'dorva' then
    raise exception 'TEST FAIL T103: %', v->'pharmacies'->0;
  end if;

  -- T104: pharmacies allowed -> its own rate and provider
  update public.settings set value = '"pharmacy_allowed"' where key = 'shipping.provider_mode' and scope = 'platform';
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), null, 35.70, 51.40, null, c.pharmacy_id);
  if v->'pharmacies'->0->>'provider' <> 'pharmacy'
     or (v->'pharmacies'->0->>'shipping')::numeric <> round(100000 + 1000 * (v->'pharmacies'->0->>'distance_km')::numeric, -4) then
    raise exception 'TEST FAIL T104: %', v->'pharmacies'->0;
  end if;

  -- T106: a per-pharmacy block wins over the default
  perform public.admin_pharmacy_shipping_allow(c.pharmacy_id, false);
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), null, 35.70, 51.40, null, c.pharmacy_id);
  if v->'pharmacies'->0->>'provider' <> 'dorva' then raise exception 'TEST FAIL T106: block ignored'; end if;
  perform public.admin_pharmacy_shipping_allow(c.pharmacy_id, null);

  -- T107: a pharmacy's own reach limits the carts it is offered
  st := public.pharmacy_shipping_save(c.pharmacy_id, true, 100000, 1000, 0, 0.5, 0.5, 20, true);
  if exists (select 1 from public.cart_candidates(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)),
                                                  null, 35.95, 51.10, 100) x
             where x.pharmacy_id = c.pharmacy_id and x.distance_km > 0.5) then
    raise exception 'TEST FAIL T107: pharmacy offered beyond its radius';
  end if;
  st := public.pharmacy_shipping_save(c.pharmacy_id, true, 100000, 1000, 0, 10, 3, 20, true);
  raise notice 'PASS T103-T107 Dorva/pharmacy shipping layers, bounds, block, reach';
end $$;
reset role;

-- T104b: order snapshot and settlement payee follow the provider
insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000021', 'buyer2@test.local') on conflict do nothing;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000021', false) \gset ignore_
set role authenticated;
do $$
declare c record; a uuid; o uuid;
begin
  select * into c from t_sh;
  if c.pharmacy_id is null then return; end if;
  insert into public.customer_addresses (label, lat, lng) values ('کار', 35.70, 51.40) returning id into a;
  o := public.place_order(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), a, null, c.pharmacy_id);
  perform public.test_gateway_complete(o, true);
  if (select shipping_provider from public.order_parts where order_id = o) <> 'pharmacy' then
    raise exception 'TEST FAIL T104b: part provider';
  end if;
  raise notice 'PASS T104b order remembers who delivers';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.settlements s join public.order_parts p on p.id = s.part_id
             join public.orders o on o.id = p.order_id
             where o.user_id = 'eeeeeeee-0000-0000-0000-000000000021' and s.logistics_payee <> 'pharmacy') then
    raise exception 'TEST FAIL T104b: settlement payee';
  end if;
  -- centralise again: one setting, pharmacy values kept
  update public.settings set value = '"dorva"' where key = 'shipping.provider_mode' and scope = 'platform';
  if not exists (select 1 from public.pharmacy_shipping where own_courier) then raise exception 'TEST FAIL T104b: values lost'; end if;
end $$;

-- T106b: a pharmacy cannot write Dorva-only settings at pharmacy scope
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  begin
    insert into public.settings (key, scope, scope_id, value)
    values ('commission.general_pct', 'pharmacy', (select id::text from public.pharmacies where slug = 'test-owner-a'), '0');
    raise exception 'TEST FAIL T106b: pharmacy changed its commission';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_pharmacy_shipping_allow((select id from public.pharmacies where slug = 'test-owner-a'), true);
    raise exception 'TEST FAIL T106b: pharmacy granted itself delivery';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T106b pharmacy-scope guard and admin-only permission';
end $$;
reset role;

-- T108: complements follow approved rules only; never on Rx; block rules win
do $$
declare brush uuid; paste uuid; n int; iron uuid; rx uuid;
begin
  select o.product_id into brush from app.offers o join public.catalog_products p on p.id = o.product_id
  where p.category_path[1:2] = '{آرایشی و بهداشتی,مسواک}'
    and exists (select 1 from app.offers x join public.catalog_products q on q.id = x.product_id
                where x.pharmacy_id = o.pharmacy_id and q.category_path[1:2] = '{آرایشی و بهداشتی,خمیردندان}')
  limit 1;
  if brush is null then raise notice 'SKIP T108: no toothbrush with toothpaste in the same pharmacy'; return; end if;
  select count(*) into n from public.product_complements_for(brush);
  if n <> 0 then raise exception 'TEST FAIL T108: proposed rule shown before approval'; end if;
  update public.complement_rules set status = 'active'
  where source_path = '{آرایشی و بهداشتی,مسواک}' and target_path = '{آرایشی و بهداشتی,خمیردندان}';
  select count(*) into n from public.product_complements_for(brush) c where c.category_path[2] = 'خمیردندان';
  if n = 0 then raise exception 'TEST FAIL T108: approved rule gives nothing'; end if;
  -- block pair wins over the rule
  select c.product_id into paste from public.product_complements_for(brush) c limit 1;
  insert into public.product_complements (product_id, complement_id, kind) values (paste, brush, 'never');
  if exists (select 1 from public.product_complements_for(brush) c where c.product_id = paste) then
    raise exception 'TEST FAIL T108: block pair ignored';
  end if;
  select id into rx from public.catalog_products where dispensing_class = 'rx' limit 1;
  if rx is not null and exists (select 1 from public.product_complements_for(rx)) then
    raise exception 'TEST FAIL T108: suggestions on Rx';
  end if;
  raise notice 'PASS T108 complements: approval, block, never on Rx';
end $$;
