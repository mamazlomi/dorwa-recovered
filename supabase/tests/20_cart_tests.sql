-- Cart allocation tests on a controlled fixture in Mashhad (no seeded pharmacies there).
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
update public.settings set value = '10' where key = 'allocation.max_radius_km' and scope = 'platform';
update public.settings set value = '2' where key in ('allocation.initial_radius_km','allocation.radius_step_km','cart.max_pharmacies') and scope = 'platform';
-- T26–T36 test the distance logic itself: no fairness band, no split threshold
update public.settings set value = '"nearest"' where key = 'allocation.tiebreak' and scope = 'platform';
update public.settings set value = '0' where key = 'cart.split_min_subtotal_rial' and scope = 'platform';

-- products: A,B,C,D general/supplement; E nobody stocks; R is Rx
select md5('dorva-sample-product-1')::uuid as pa,  md5('dorva-sample-product-2')::uuid as pb,
       md5('dorva-sample-product-5')::uuid as pc,  md5('dorva-sample-product-6')::uuid as pd,
       md5('dorva-sample-product-7')::uuid as pe,  md5('dorva-sample-product-13')::uuid as pr \gset

insert into public.pharmacies (id, slug, name_fa, license_no, status, city_id, lat, lng) select
  v.id::uuid, v.slug, v.slug, 'LIC-' || v.slug, 'active', c.id, 36.2970 + v.dlat, 59.6062
from public.cities c, (values
  ('11111111-0000-0000-0000-00000000000a', 'cart-p1',  0.0),      -- centre
  ('11111111-0000-0000-0000-00000000000b', 'cart-p2',  0.009),    -- ~1 km
  ('11111111-0000-0000-0000-00000000000c', 'cart-p3',  0.045),    -- ~5 km
  ('11111111-0000-0000-0000-00000000000d', 'cart-p4', -0.0045)    -- ~0.5 km
) v(id, slug, dlat) where c.slug = 'mashhad';

insert into public.stock_items (pharmacy_id, product_id, quantity) values
  ('11111111-0000-0000-0000-00000000000a', :'pa', 5), ('11111111-0000-0000-0000-00000000000a', :'pb', 5),
  ('11111111-0000-0000-0000-00000000000b', :'pa', 5), ('11111111-0000-0000-0000-00000000000b', :'pb', 5),
  ('11111111-0000-0000-0000-00000000000b', :'pc', 5),
  ('11111111-0000-0000-0000-00000000000c', :'pa', 5), ('11111111-0000-0000-0000-00000000000c', :'pb', 5),
  ('11111111-0000-0000-0000-00000000000c', :'pc', 5), ('11111111-0000-0000-0000-00000000000c', :'pd', 5),
  ('11111111-0000-0000-0000-00000000000d', :'pd', 5), ('11111111-0000-0000-0000-00000000000d', :'pr', 5);

create temp table t_ids as select :'pa'::uuid a, :'pb'::uuid b, :'pc'::uuid c, :'pd'::uuid d, :'pe'::uuid e, :'pr'::uuid r;
grant select on t_ids to anon;

set role anon;
do $$
declare
  i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
  p1 uuid := '11111111-0000-0000-0000-00000000000a'; p2 uuid := '11111111-0000-0000-0000-00000000000b';
  p3 uuid := '11111111-0000-0000-0000-00000000000c'; p4 uuid := '11111111-0000-0000-0000-00000000000d';
  lat float := 36.2970; lng float := 59.6062;
  function_items jsonb;
begin
  select * into i from t_ids;

  -- T26 nearest pharmacy with the whole basket
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b, 'qty', 2)),
                           mashhad, lat, lng);
  if plan->>'strategy' <> 'single' or (plan->'pharmacies'->0->>'pharmacy_id')::uuid <> p1 then
    raise exception 'TEST FAIL T26: %', plan; end if;
  if (plan->>'total')::numeric <> (select sum(o.final_price * case when o.product_id = i.b then 2 else 1 end)
        from public.list_offers(p1, null) o where o.product_id in (i.a, i.b)) then
    raise exception 'TEST FAIL T26 total: %', plan->>'total'; end if;
  raise notice 'PASS T26 nearest complete pharmacy chosen, total = price x qty';

  -- T27 completeness beats raw distance inside the radius
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b),
                           jsonb_build_object('product_id', i.c)), mashhad, lat, lng);
  if (plan->'pharmacies'->0->>'pharmacy_id')::uuid <> p2 or jsonb_array_length(plan->'pharmacies') <> 1 then
    raise exception 'TEST FAIL T27: %', plan; end if;
  raise notice 'PASS T27 single pharmacy with full basket (1 km) preferred';

  -- T28 radius widens step by step until a complete pharmacy is found
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b),
                           jsonb_build_object('product_id', i.c), jsonb_build_object('product_id', i.d)), mashhad, lat, lng);
  if (plan->'pharmacies'->0->>'pharmacy_id')::uuid <> p3 or (plan->>'radius_km')::numeric <> 6 then
    raise exception 'TEST FAIL T28: %', plan; end if;
  raise notice 'PASS T28 radius widened 2 -> 4 -> 6 km to find complete basket';

  -- T30 unknown stock is reported, not dropped; T31 Rx goes to prescription flow
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.e),
                           jsonb_build_object('product_id', i.r)), mashhad, lat, lng);
  if not (plan->'unavailable') @> to_jsonb(array[i.e]) then raise exception 'TEST FAIL T30: %', plan; end if;
  raise notice 'PASS T30 out-of-stock line reported as unavailable';
  if not (plan->'needs_prescription') @> to_jsonb(array[i.r]) or plan::text like '%' || p4 || '%' then
    raise exception 'TEST FAIL T31: %', plan; end if;
  raise notice 'PASS T31 Rx line excluded from cart plan (prescription only)';

  -- T32 customer override wins; missing lines reported
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.c)),
                           mashhad, lat, lng, null, p1);
  if plan->>'strategy' <> 'chosen' or (plan->'pharmacies'->0->>'pharmacy_id')::uuid <> p1
     or not (plan->'unavailable') @> to_jsonb(array[i.c]) then raise exception 'TEST FAIL T32: %', plan; end if;
  raise notice 'PASS T32 customer choice overrides allocation';

  -- T33 pharmacy the customer shopped from is kept when it has everything
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a)), mashhad, lat, lng, p3);
  if plan->>'strategy' <> 'preferred' or (plan->'pharmacies'->0->>'pharmacy_id')::uuid <> p3 then
    raise exception 'TEST FAIL T33: %', plan; end if;
  raise notice 'PASS T33 preferred pharmacy kept';

  -- T34 quantity above stock is not coverage
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.c, 'qty', 9)), mashhad, lat, lng);
  if jsonb_array_length(plan->'pharmacies') <> 0 or not (plan->'unavailable') @> to_jsonb(array[i.c]) then
    raise exception 'TEST FAIL T34: %', plan; end if;
  raise notice 'PASS T34 requested quantity must be in stock';

  -- T35 no location: city scope, still complete
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.c), jsonb_build_object('product_id', i.d)), mashhad);
  if (plan->'pharmacies'->0->>'pharmacy_id')::uuid <> p3 then raise exception 'TEST FAIL T35: %', plan; end if;
  raise notice 'PASS T35 without location, city-wide complete pharmacy';
end $$;

-- T29 with a 4 km cap, the basket splits across two nearby pharmacies
reset role;
update public.settings set value = '4' where key = 'allocation.max_radius_km' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b),
                           jsonb_build_object('product_id', i.c), jsonb_build_object('product_id', i.d)), mashhad, 36.2970, 59.6062);
  if plan->>'strategy' <> 'split' or jsonb_array_length(plan->'pharmacies') <> 2
     or jsonb_array_length(plan->'unavailable') <> 0 then raise exception 'TEST FAIL T29: %', plan; end if;
  if (select array_agg(x->>'slug' order by x->>'slug') from jsonb_array_elements(plan->'pharmacies') x) <> array['cart-p2','cart-p4'] then
    raise exception 'TEST FAIL T29 pair: %', plan; end if;
  raise notice 'PASS T29 basket split across 2 nearest pharmacies when no single one is in range';

  -- T36 setting max 1 pharmacy: partial plan, remainder unavailable
end $$;
reset role;
update public.settings set value = '1' where key = 'cart.max_pharmacies' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b),
                           jsonb_build_object('product_id', i.c), jsonb_build_object('product_id', i.d)), mashhad, 36.2970, 59.6062);
  if plan->>'strategy' <> 'partial' or jsonb_array_length(plan->'pharmacies') <> 1
     or jsonb_array_length(plan->'unavailable') <> 1 then raise exception 'TEST FAIL T36: %', plan; end if;
  raise notice 'PASS T36 cart.max_pharmacies=1 gives best single pharmacy + missing list (no-code setting)';
end $$;
reset role;
update public.settings set value = '10' where key = 'allocation.max_radius_km' and scope = 'platform';
update public.settings set value = '2' where key = 'cart.max_pharmacies' and scope = 'platform';


-- ---------- T37–T44 fairness rules and settings validation ----------
reset role;
insert into public.pharmacy_daily_load (pharmacy_id, day, orders) values
  ('11111111-0000-0000-0000-00000000000a', current_date, 3),
  ('11111111-0000-0000-0000-00000000000b', current_date, 0);
update public.settings set value = '1.5' where key = 'allocation.equal_band_km' and scope = 'platform';
update public.settings set value = '"round_robin"' where key = 'allocation.tiebreak' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b)),
                           mashhad, 36.2970, 59.6062);
  if plan->'pharmacies'->0->>'slug' <> 'cart-p2' or (plan->>'band_size')::int <> 2 then
    raise exception 'TEST FAIL T37: %', plan; end if;
  raise notice 'PASS T37 round robin: equally near pharmacy with fewer orders today wins (band of 2)';
end $$;

reset role;
update public.settings set value = '"nearest"' where key = 'allocation.tiebreak' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b)),
                           mashhad, 36.2970, 59.6062);
  if plan->'pharmacies'->0->>'slug' <> 'cart-p1' then raise exception 'TEST FAIL T38: %', plan; end if;
  raise notice 'PASS T38 tiebreak=nearest ignores the band';
end $$;

reset role;
update public.settings set value = '"score"' where key = 'allocation.tiebreak' and scope = 'platform';
update public.settings set value = '{"distance":0,"quality":0,"price":0,"load":1}' where key = 'allocation.weights' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b)),
                           mashhad, 36.2970, 59.6062);
  if plan->'pharmacies'->0->>'slug' <> 'cart-p2' then raise exception 'TEST FAIL T39a: %', plan; end if;
end $$;
reset role;
update public.settings set value = '{"distance":1,"quality":0,"price":0,"load":0}' where key = 'allocation.weights' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b)),
                           mashhad, 36.2970, 59.6062);
  if plan->'pharmacies'->0->>'slug' <> 'cart-p1' then raise exception 'TEST FAIL T39b: %', plan; end if;
  raise notice 'PASS T39 score mode follows the configured weights (load -> p2, distance -> p1)';
end $$;

-- T40 a second delivery only when its share is worth it
reset role;
update public.settings set value = '4' where key = 'allocation.max_radius_km' and scope = 'platform';
update public.settings set value = '2000000' where key = 'cart.split_min_subtotal_rial' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a), jsonb_build_object('product_id', i.b),
                           jsonb_build_object('product_id', i.c), jsonb_build_object('product_id', i.d)), mashhad, 36.2970, 59.6062);
  if plan->>'strategy' <> 'partial' or jsonb_array_length(plan->'pharmacies') <> 1
     or not (plan->'unavailable') @> to_jsonb(array[i.d]) then raise exception 'TEST FAIL T40: %', plan; end if;
  raise notice 'PASS T40 small remainder is not split into a second delivery (split_min_subtotal)';
end $$;

-- T41 settings are validated against their definitions
reset role;
do $$ begin
  begin update public.settings set value = '"bogus"' where key = 'allocation.tiebreak' and scope = 'platform';
        raise exception 'TEST FAIL T41: invalid enum accepted';
  exception when check_violation then null; end;
  begin update public.settings set value = '9' where key = 'cart.max_pharmacies' and scope = 'platform';
        raise exception 'TEST FAIL T41: out-of-range number accepted';
  exception when check_violation then null; end;
  begin update public.settings set value = '{"distance":1.5,"quality":0,"price":0,"load":0}' where key = 'allocation.weights' and scope = 'platform';
        raise exception 'TEST FAIL T41: weight > 1 accepted';
  exception when check_violation then null; end;
  begin update public.settings set value = '"yes"' where key = 'allocation.prefer_shopped_pharmacy' and scope = 'platform';
        raise exception 'TEST FAIL T41: non-boolean accepted';
  exception when check_violation then null; end;
  raise notice 'PASS T41 invalid setting values rejected (enum, range, weights, boolean)';
end $$;

-- T42 location requirement flag; T43 preferring the shopped pharmacy can be switched off
reset role;
update public.settings set value = '10' where key = 'allocation.max_radius_km' and scope = 'platform';
update public.settings set value = 'false' where key = 'allocation.prefer_shopped_pharmacy' and scope = 'platform';
set role anon;
do $$
declare i t_ids; plan jsonb; mashhad int := (select id from public.cities where slug = 'mashhad');
begin
  select * into i from t_ids;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a)), mashhad);
  if not (plan->>'location_required')::boolean then raise exception 'TEST FAIL T42a: %', plan; end if;
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a)), mashhad, 36.2970, 59.6062);
  if (plan->>'location_required')::boolean then raise exception 'TEST FAIL T42b: %', plan; end if;
  raise notice 'PASS T42 checkout.location_required=point flags carts without a location';
  plan := public.plan_cart(jsonb_build_array(jsonb_build_object('product_id', i.a)), mashhad, 36.2970, 59.6062,
                           '11111111-0000-0000-0000-00000000000c');
  if plan->>'strategy' = 'preferred' then raise exception 'TEST FAIL T43: %', plan; end if;
  raise notice 'PASS T43 prefer_shopped_pharmacy=false ignores the shopped pharmacy';
end $$;

reset role;
update public.settings set value = '"round_robin"' where key = 'allocation.tiebreak' and scope = 'platform';
update public.settings set value = '1' where key = 'allocation.equal_band_km' and scope = 'platform';
update public.settings set value = '500000' where key = 'cart.split_min_subtotal_rial' and scope = 'platform';
update public.settings set value = 'true' where key = 'allocation.prefer_shopped_pharmacy' and scope = 'platform';
update public.settings set value = '{"distance":0.4,"quality":0.3,"price":0.15,"load":0.15}' where key = 'allocation.weights' and scope = 'platform';

\echo ALL CART TESTS PASSED
