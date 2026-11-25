-- T90-T93: address book, nearest city, map markers
insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'addr-a@test.local'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'addr-b@test.local')
on conflict do nothing;

select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare r record;
begin
  -- T90: own address saved, city filled from the pin (Tehran centre area)
  insert into public.customer_addresses (label, lat, lng) values ('خانه', 35.70, 51.40) returning * into r;
  if r.city_id is null or r.city_id <> (select id from public.cities where slug = 'tehran') then
    raise exception 'TEST FAIL T90: city %', r.city_id;
  end if;
  -- outside Iran is rejected
  begin
    insert into public.customer_addresses (label, lat, lng) values ('x', 48.8, 2.3);
    raise exception 'TEST FAIL T90: outside Iran accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS T90 address saved with city from map pin';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000002', false) \gset ignore_
set role authenticated;
do $$
declare n int;
begin
  -- T91: another customer cannot see, change or delete it
  select count(*) into n from public.customer_addresses;
  if n <> 0 then raise exception 'TEST FAIL T91: sees others'; end if;
  update public.customer_addresses set label = 'hack';
  delete from public.customer_addresses;
  begin
    insert into public.customer_addresses (user_id, label, lat, lng) values ('eeeeeeee-0000-0000-0000-000000000001', 'x', 35.7, 51.4);
    raise exception 'TEST FAIL T91: inserted for another user';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T91 address book is private';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$
declare n int; s text;
begin
  -- T92: anon sees no addresses
  begin
    select count(*) into n from public.customer_addresses;
    if n <> 0 then raise exception 'TEST FAIL T92: anon sees addresses'; end if;
  exception when insufficient_privilege then null;
  end;
  -- T93: nearest city and map markers
  select slug into s from public.nearest_city(35.75, 51.35);
  if s is distinct from 'tehran' then raise exception 'TEST FAIL T93: nearest %', s; end if;
  select count(*) into n from public.nearest_city(30.0, 60.0);
  select count(*) into n from public.map_pharmacies();
  if n = 0 then raise exception 'TEST FAIL T93: no markers'; end if;
  raise notice 'PASS T92-T93 anon blocked, nearest city, % markers', n;
end $$;
reset role;

do $$ begin
  if (select label from public.customer_addresses where user_id = 'eeeeeeee-0000-0000-0000-000000000001') <> 'خانه' then
    raise exception 'TEST FAIL T91: changed by another user';
  end if;
  raise notice 'ALL ADDRESS TESTS PASSED';
end $$;
