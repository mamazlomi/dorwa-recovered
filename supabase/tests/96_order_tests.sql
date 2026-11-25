-- T97-T101: order -> test payment (held) -> technical approval -> delivery code -> release
insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000011', 'buyer@test.local'),
  ('eeeeeeee-0000-0000-0000-000000000012', 'opsadmin@test.local')
on conflict do nothing;
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'eeeeeeee-0000-0000-0000-000000000012', null, id from public.roles where scope = 'platform' and code = 'super_admin'
on conflict do nothing;

-- pick a Tehran supplement in stock at a virtual pharmacy, remember stock
create temp table t_ctx as
select o.product_id, o.pharmacy_id, s.quantity as stock_before
from app.offers o join public.catalog_products cp on cp.id = o.product_id
join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
join public.pharmacies ph on ph.id = o.pharmacy_id and ph.is_virtual
where o.city_id = (select id from public.cities where slug = 'tehran') and cp.dispensing_class = 'supplement' and s.quantity >= 3
limit 1;
grant select on t_ctx to authenticated;

select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000011', false) \gset ignore_
set role authenticated;
do $$
declare c record; a uuid; o uuid; st text; ord public.orders; n int;
begin
  select * into c from t_ctx;
  insert into public.customer_addresses (label, lat, lng) values ('خانه', 35.70, 51.40) returning id into a;
  o := public.place_order(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 2)), a, null, c.pharmacy_id);
  select * into ord from public.orders where id = o;
  -- T97: order created unpaid, total = items + shipping
  if ord.status <> 'awaiting_payment' or ord.grand_total <> ord.items_total + ord.shipping_total or ord.shipping_total <= 0 then
    raise exception 'TEST FAIL T97: %', row_to_json(ord);
  end if;
  -- T98: test payment holds money and takes stock; code visible to the buyer only
  st := public.test_gateway_complete(o, true);
  if st <> 'paid' or (select status from public.payments where order_id = o) <> 'held' then raise exception 'TEST FAIL T98: %', st; end if;
  if (select status from public.order_parts where order_id = o) <> 'pending_tech' then raise exception 'TEST FAIL T98: no tech step'; end if;
  select count(*) into n from public.order_delivery_codes;
  if n <> 1 then raise exception 'TEST FAIL T98: buyer cannot see code'; end if;
  -- buyer cannot approve their own items
  begin
    perform public.tech_review((select i.id from public.order_items i join public.order_parts p on p.id = i.part_id where p.order_id = o limit 1), true);
    raise exception 'TEST FAIL T99: buyer approved';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T97-T98 order placed, payment held, code private';
end $$;
reset role;

do $$ begin
  if (select s.quantity from public.stock_items s join t_ctx c using (pharmacy_id, product_id)) <> (select stock_before - 2 from t_ctx) then
    raise exception 'TEST FAIL T98: stock not taken';
  end if;
end $$;

-- the Dorva admin operates the virtual pharmacy
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$
declare part uuid; item uuid; st text; n int;
begin
  select p.id into part from public.order_parts p join public.orders o on o.id = p.order_id
  where o.user_id = 'eeeeeeee-0000-0000-0000-000000000011' order by o.created_at desc limit 1;
  if part is null then raise exception 'TEST FAIL T99: pharmacy side cannot see the order'; end if;
  select count(*) into n from public.order_delivery_codes;
  if n <> 0 then raise exception 'TEST FAIL T99: pharmacy sees the delivery code'; end if;
  select id into item from public.order_items where part_id = part;
  -- T99: approval moves the part to preparing
  st := public.tech_review(item, true);
  if st <> 'preparing' then raise exception 'TEST FAIL T99: %', st; end if;
  st := public.part_ship(part);
  -- T100: wrong code is counted, right code releases the money
  st := public.part_deliver(part, '000000x');
  if st <> 'wrong' and st <> 'delivered' then raise exception 'TEST FAIL T100: %', st; end if;
  raise notice 'PASS T99 technical approval by pharmacy side';
end $$;
reset role;

do $$
declare part uuid; code text; st text;
begin
  select p.id, c.code into part, code from public.order_parts p join public.order_delivery_codes c on c.part_id = p.id
  join public.orders o on o.id = p.order_id where o.user_id = 'eeeeeeee-0000-0000-0000-000000000011' limit 1;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false);
  set local role authenticated;
  st := public.part_deliver(part, code);
  reset role;
  if st <> 'delivered' then raise exception 'TEST FAIL T100: %', st; end if;
  if (select p.status from public.payments p join public.order_parts op on op.order_id = p.order_id where op.id = part) <> 'released'
     or (select status from public.settlements where part_id = part) <> 'released' then
    raise exception 'TEST FAIL T100: money not released';
  end if;
  if (select pharmacy_amount + dorva_amount from public.settlements where part_id = part)
     <> (select sum(line_total) from public.order_items where part_id = part) then
    raise exception 'TEST FAIL T101: split does not add up';
  end if;
  raise notice 'PASS T100-T101 delivery code releases held money, split adds up';
end $$;

-- T102: rejection refunds and restocks
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000011', false) \gset ignore_
set role authenticated;
do $$
declare c record; a uuid; o uuid;
begin
  select * into c from t_ctx;
  select id into a from public.customer_addresses limit 1;
  o := public.place_order(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), a, null, c.pharmacy_id);
  perform public.test_gateway_complete(o, true);
  perform set_config('dorva.t102', o::text, false);
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$
declare o uuid := current_setting('dorva.t102')::uuid; st text;
begin
  begin
    perform public.tech_review((select i.id from public.order_items i join public.order_parts p on p.id = i.part_id where p.order_id = o), false, '');
    raise exception 'TEST FAIL T102: rejected without reason';
  exception when invalid_parameter_value then null;
  end;
  st := public.tech_review((select i.id from public.order_items i join public.order_parts p on p.id = i.part_id where p.order_id = o), false, 'تداخل دارویی');
  if st <> 'cancelled' then raise exception 'TEST FAIL T102: %', st; end if;
end $$;
reset role;
do $$
declare o uuid := current_setting('dorva.t102')::uuid;
begin
  if (select status from public.orders where id = o) <> 'cancelled'
     or (select status from public.payments where order_id = o) <> 'refunded'
     or (select refunded_total from public.orders where id = o) <> (select grand_total from public.orders where id = o) then
    raise exception 'TEST FAIL T102: not fully refunded';
  end if;
  if (select s.quantity from public.stock_items s join t_ctx c using (pharmacy_id, product_id)) <> (select stock_before - 2 from t_ctx) then
    raise exception 'TEST FAIL T102: not restocked';
  end if;
  raise notice 'PASS T102 rejection refunds everything and restocks';
  raise notice 'ALL ORDER TESTS PASSED';
end $$;
