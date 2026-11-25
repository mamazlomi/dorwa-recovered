-- T120-T124: split shipping rule, customer cancel, technical deadline (cancel / reassign)
insert into auth.users (id, email) values ('eeeeeeee-0000-0000-0000-000000000041', 'buyer3@test.local') on conflict do nothing;
update public.settings set value = '0' where key = 'cart.split_min_subtotal_rial' and scope = 'platform';

-- T120: two products that only two different Tehran pharmacies sell -> split plan
do $$
declare a uuid; b uuid; v jsonb; teh int := (select id from public.cities where slug = 'tehran');
begin
  update public.settings set value = '2' where key = 'cart.max_pharmacies' and scope = 'platform';
  select o1.product_id, o2.product_id into a, b
  from app.offers o1 join app.offers o2 on o2.pharmacy_id <> o1.pharmacy_id and o2.product_id <> o1.product_id
  join public.catalog_products c1 on c1.id = o1.product_id and c1.dispensing_class <> 'rx'
  join public.catalog_products c2 on c2.id = o2.product_id and c2.dispensing_class <> 'rx'
  where o1.city_id = teh and o2.city_id = teh
    and not exists (select 1 from app.offers x where x.product_id = o1.product_id and x.pharmacy_id = o2.pharmacy_id)
    and not exists (select 1 from app.offers x where x.product_id = o2.product_id and x.pharmacy_id = o1.pharmacy_id)
    and not exists (select 1 from app.offers x where x.product_id = o1.product_id and x.city_id = teh and x.pharmacy_id <> o1.pharmacy_id)
    and not exists (select 1 from app.offers x where x.product_id = o2.product_id and x.city_id = teh and x.pharmacy_id <> o2.pharmacy_id)
  limit 1;
  if a is null then raise notice 'SKIP T120: no split pair in seed'; return; end if;
  update public.settings set value = '"max_only"' where key = 'shipping.split_rule' and scope = 'platform';
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 1), jsonb_build_object('product_id', b, 'qty', 1)), teh, 35.70, 51.40);
  if jsonb_array_length(v->'pharmacies') <> 2 then raise notice 'SKIP T120: planner did not split (%)', v->>'strategy'; 
  else
    if (select count(*) from jsonb_array_elements(v->'pharmacies') e where (e->>'shipping')::numeric = 0) <> 1
       or (v->>'shipping_total')::numeric <> (select max((e->>'shipping_full')::numeric) from jsonb_array_elements(v->'pharmacies') e) then
      raise exception 'TEST FAIL T120: max_only %', v->'pharmacies';
    end if;
    raise notice 'PASS T120 split order charges only the dearest delivery';
  end if;
  update public.settings set value = '"each"' where key = 'shipping.split_rule' and scope = 'platform';
end $$;

-- fixtures: a Tehran supplement at a pharmacy, buyer address
create temp table t_r as
select o.product_id, o.pharmacy_id, o.final_price
from app.offers o join public.catalog_products cp on cp.id = o.product_id
join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
where o.city_id = (select id from public.cities where slug = 'tehran') and cp.dispensing_class = 'supplement' and s.quantity >= 5
order by (select count(*) from app.offers x where x.product_id = o.product_id and x.city_id = o.city_id) desc, o.final_price desc
limit 1;
grant select on t_r to authenticated;

select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
create temp table t_o (k text, id uuid);
do $$
declare c record; a uuid; o uuid; st text; ord public.orders; stock0 int;
begin
  select * into c from t_r;
  insert into public.customer_addresses (label, lat, lng) values ('خانه', 35.70, 51.40) returning id into a;
  -- T121: the customer cancels before shipping: everything comes back
  o := public.place_order(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), a, null, c.pharmacy_id);
  st := public.test_gateway_complete(o, true);
  if st <> 'paid' then raise exception 'TEST FAIL T121: pay %', st; end if;
  st := public.order_cancel(o);
  select * into ord from public.orders where id = o;
  if st <> 'cancelled' or ord.status <> 'cancelled' or ord.refunded_total <> ord.grand_total
     or (select cancel_reason from public.order_parts where order_id = o) <> 'customer' then
    raise exception 'TEST FAIL T121: % %', st, row_to_json(ord);
  end if;
  raise notice 'PASS T121 customer cancel refunds everything';
  -- orders for the deadline tests
  insert into t_o values ('cancel', public.place_order(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), a, null, c.pharmacy_id));
  perform public.test_gateway_complete((select id from t_o where k = 'cancel'), true);
end $$;
reset role;

do $$
declare c record; o uuid := (select id from t_o where k = 'cancel'); n int;
begin
  select * into c from t_r;
  if (select s.quantity from public.stock_items s where s.pharmacy_id = c.pharmacy_id and s.product_id = c.product_id) < 4 then
    raise exception 'TEST FAIL T121: stock not restored';
  end if;
  -- T122: deadline passed, rule = cancel
  update public.settings set value = '"cancel"' where key = 'tech_approval.on_timeout' and scope = 'platform';
  update public.order_parts set tech_deadline = now() - interval '1 minute' where order_id = o;
  n := public.tech_timeouts_tick();
  if (select status || '/' || coalesce(cancel_reason, '') from public.order_parts where order_id = o) <> 'cancelled/tech_timeout'
     or (select refunded_total from public.orders where id = o) <> (select grand_total from public.orders where id = o) then
    raise exception 'TEST FAIL T122: %', (select row_to_json(p) from public.order_parts p where order_id = o);
  end if;
  raise notice 'PASS T122 timeout cancels and refunds';
  update public.settings set value = '"reassign"' where key = 'tech_approval.on_timeout' and scope = 'platform';
end $$;

-- T123: deadline passed, rule = reassign: moves to another pharmacy at the same or lower price
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$
declare c record; a uuid;
begin
  select * into c from t_r;
  select id into a from public.customer_addresses limit 1;
  insert into t_o values ('reassign', public.place_order(jsonb_build_array(jsonb_build_object('product_id', c.product_id, 'qty', 1)), a, null, c.pharmacy_id));
  perform public.test_gateway_complete((select id from t_o where k = 'reassign'), true);
end $$;
reset role;
do $$
declare c record; o uuid := (select id from t_o where k = 'reassign'); p public.order_parts; other int;
begin
  select * into c from t_r;
  select count(*) into other from app.offers x join public.pharmacies ph on ph.id = x.pharmacy_id
  where x.product_id = c.product_id and x.pharmacy_id <> c.pharmacy_id and x.final_price <= c.final_price
    and extensions.earth_distance(extensions.ll_to_earth(ph.lat, ph.lng), extensions.ll_to_earth(35.70, 51.40)) <= app.ph_reach_km(ph.id) * 1000;
  update public.order_parts set tech_deadline = now() - interval '1 minute' where order_id = o;
  perform public.tech_timeouts_tick();
  select * into p from public.order_parts where order_id = o;
  if other = 0 then
    if p.status <> 'cancelled' then raise exception 'TEST FAIL T123: no candidate yet not cancelled'; end if;
    raise notice 'SKIP T123: no second pharmacy, fell back to cancel (ok)';
    return;
  end if;
  if p.pharmacy_id = c.pharmacy_id or p.reassign_count <> 1 or p.status <> 'pending_tech' or p.tech_deadline <= now()
     or not (c.pharmacy_id = any(p.tried_pharmacies)) then
    raise exception 'TEST FAIL T123: %', row_to_json(p);
  end if;
  if (select refunded_total from public.orders where id = o) <> c.final_price - (select line_total from public.order_items where part_id = p.id) then
    raise exception 'TEST FAIL T123: price difference not refunded';
  end if;
  raise notice 'PASS T123 timeout reassigns to another pharmacy and refunds the difference';
  -- T124: customer cancel disabled
  update public.settings set value = '"never"' where key = 'order.customer_cancel' and scope = 'platform';
end $$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  if public.order_cancel((select id from t_o where k = 'reassign')) <> 'not_allowed' then raise exception 'TEST FAIL T124'; end if;
  raise notice 'PASS T124 cancellation follows the setting';
end $$;
reset role;
update public.settings set value = '"before_ship"' where key = 'order.customer_cancel' and scope = 'platform';
