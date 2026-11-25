-- T195: bulk inventory save — good rows saved, a row over the discount cap reported
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid := (select id from public.pharmacies where slug = 'test-owner-a');
        a record; b record; r jsonb;
begin
  insert into public.stock_items (pharmacy_id, product_id, quantity)
  select ph, p.id, 1 from public.catalog_products p
  where p.dispensing_class in ('otc', 'supplement') and not exists (select 1 from public.stock_items s where s.pharmacy_id = ph and s.product_id = p.id)
  order by p.id limit 2;
  select product_id, quantity into a from public.stock_items where pharmacy_id = ph order by product_id limit 1;
  select product_id into b from public.stock_items where pharmacy_id = ph order by product_id offset 1 limit 1;
  if a is null or b is null then raise notice 'SKIP T195: needs two stock rows'; return; end if;
  r := public.stock_bulk_save(ph, jsonb_build_array(
    jsonb_build_object('product_id', a.product_id, 'quantity', 37, 'discount_pct', 0, 'price', null),
    jsonb_build_object('product_id', b.product_id, 'quantity', 5, 'discount_pct', 99, 'price', null)));
  if (r->>'ok')::int <> 1 then raise exception 'TEST FAIL T195 saved count %', r; end if;
  if (r->'errors'->0->>'code') <> 'discount' then raise exception 'TEST FAIL T195 error code %', r; end if;
  if (select quantity from public.stock_items where pharmacy_id = ph and product_id = a.product_id) <> 37 then raise exception 'TEST FAIL T195 not saved'; end if;
  r := public.stock_bulk_save(ph, '[{"product_id":"00000000-0000-0000-0000-000000000000","quantity":"x","discount_pct":0}]');
  if (r->'errors'->0->>'code') <> 'value' then raise exception 'TEST FAIL T195 bad value %', r; end if;
  raise notice 'PASS T195 bulk stock save';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', false) \gset ignore_
set role authenticated;
do $$
begin
  perform public.stock_bulk_save((select id from public.pharmacies where slug = 'test-owner-a'), '[]');
  raise exception 'TEST FAIL T196 stranger could bulk save';
exception when insufficient_privilege then raise notice 'PASS T196 bulk save needs inventory.manage';
end $$;
reset role;

-- T197-T199: Dorva bulk prices, pharmacy price needs approval
reset role;
insert into public.product_listings (product_id, is_published, price_policy)
select product_id, true, 'free' from public.stock_items where pharmacy_id = (select id from public.pharmacies where slug = 'test-owner-a')
on conflict (product_id) do update set price_policy = 'free';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid := (select id from public.pharmacies where slug = 'test-owner-a'); a record;
begin
  select s.product_id into a from public.stock_items s where s.pharmacy_id = ph limit 1;
  update public.stock_items set price = null where pharmacy_id = ph and product_id = a.product_id;
  update public.stock_items set price = 1234560 where pharmacy_id = ph and product_id = a.product_id;
  if (select price from public.stock_items where pharmacy_id = ph and product_id = a.product_id) is not null
     or (select price_requested from public.stock_items where pharmacy_id = ph and product_id = a.product_id) <> 1234560 then
    raise exception 'TEST FAIL T197 price should wait for approval';
  end if;
  raise notice 'PASS T197 pharmacy price waits for Dorva';
end $$;
reset role;
do $$
declare s uuid := (select id from public.stock_items where price_requested = 1234560 limit 1);
        pid uuid := (select product_id from public.stock_items where price_requested = 1234560 limit 1);
        boss uuid := (select m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
                      where rp.permission_code = 'policy.manage' and m.pharmacy_id is null limit 1);
begin
  if boss is null then raise notice 'SKIP T198: no platform admin in seed'; return; end if;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  if public.price_requests_decide(array[s], true) <> 1 then raise exception 'TEST FAIL T198 approve'; end if;
  if (select price from public.stock_items where id = s) <> 1234560 then raise exception 'TEST FAIL T198 approved price'; end if;
  raise notice 'PASS T198 Dorva approves in bulk';
  update public.stock_items set price_requested = 1111110, price_requested_at = now() where id = s;
  if public.price_requests_decide(array[s], true, null, 'all') <> 1 then raise exception 'TEST FAIL T199 approve all'; end if;
  if (select base_price from public.product_listings where product_id = pid) <> 1111110
     or exists (select 1 from public.stock_items where product_id = pid and price is not null) then
    raise exception 'TEST FAIL T199 all pharmacies';
  end if;
  raise notice 'PASS T199 approve for all pharmacies sets the Dorva price';
end $$;

-- T200: Dorva bulk prices and caps
do $$
declare boss uuid := (select m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
                      where rp.permission_code = 'policy.manage' and m.pharmacy_id is null limit 1);
        a uuid; b uuid; r jsonb;
begin
  if boss is null then raise notice 'SKIP T200'; return; end if;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  select id into a from public.catalog_products where dispensing_class = 'supplement' order by id limit 1;
  select id into b from public.catalog_products where id <> a order by id desc limit 1;
  delete from public.product_listings where product_id = b;
  r := public.listing_bulk_save(jsonb_build_array(
    jsonb_build_object('id', a, 'base_price', 990000, 'price_policy', 'cap', 'is_published', true, 'product_cap', 7),
    jsonb_build_object('id', b, 'is_published', true)));
  if (r->>'ok')::int <> 1 or r->'errors'->0->>'code' <> 'needs_price' then raise exception 'TEST FAIL T200 listing % a=% b=%', r, a, b; end if;
  if (select base_price from public.product_listings where product_id = a) <> 990000
     or (select max_discount_pct from public.discount_cap(a)) <> 7 then raise exception 'TEST FAIL T200 saved'; end if;
  r := public.listing_bulk_save(jsonb_build_array(jsonb_build_object('id', a, 'product_cap', null)));
  if exists (select 1 from public.discount_caps where scope = 'product' and product_id = a) then raise exception 'TEST FAIL T200 cap cleared'; end if;
  r := public.discount_caps_bulk((select jsonb_agg(jsonb_build_object('id', id, 'max_discount_pct', 9)) from public.discount_caps limit 1));
  raise notice 'PASS T200 Dorva bulk prices and caps %', r->>'ok';
end $$;
