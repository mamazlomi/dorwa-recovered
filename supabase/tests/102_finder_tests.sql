-- T150-T156: medicine finder (shortage list, declarations, patient search, reports, suggestions, stats)
insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000051', 'r1@finder.test'),
  ('ffffffff-0000-0000-0000-000000000052', 'r2@finder.test'),
  ('ffffffff-0000-0000-0000-000000000053', 'r3@finder.test')
on conflict do nothing;
update public.pharmacies set status = 'active', phone = '02100000001' where slug = 'test-owner-a';
update public.pharmacies set phone = '02100000002' where slug = 'test-tehran-1';

create temp table t_f as select
  (select id from public.pharmacies where slug = 'test-owner-a') ph_a,
  (select id from public.pharmacies where slug = 'test-tehran-1') ph_t1,
  (select id from public.pharmacies where slug = 'test-isfahan-1') ph_i1,
  (select id from public.cities where slug = 'tehran') teh,
  (select id from public.cities where slug = 'isfahan') isf,
  (select id from public.catalog_products where is_active order by name_fa limit 1) p1,
  (select id from public.catalog_products where is_active order by name_fa offset 1 limit 1) p2,
  (select id from public.catalog_products where is_active order by name_fa offset 2 limit 1) p3;
grant select on t_f to anon, authenticated;

-- T150: only Dorva builds the list
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  begin perform public.finder_admin_set((select p1 from t_f), 'add'); raise exception 'TEST FAIL T150 customer added';
  exception when insufficient_privilege then null; end;
  begin perform public.finder_set_stock((select ph_a from t_f), gen_random_uuid(), true); raise exception 'TEST FAIL T150 customer declared';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$ declare c record; begin
  select * into c from t_f;
  if public.finder_admin_set(c.p1, 'add', 'کمبود آزمایشی') <> 'ok' or public.finder_admin_set(c.p2, 'add') <> 'ok' then
    raise exception 'TEST FAIL T150 admin add';
  end if;
  if (select count(*) from public.finder_admin_list() where status = 'active') <> 2 then raise exception 'TEST FAIL T150 list'; end if;
  raise notice 'PASS T150 Dorva builds the shortage list; others cannot';
end $$;
reset role;
create temp table t_d as select id, product_id from public.finder_drugs;
grant select on t_d to anon, authenticated;

-- T151: a pharmacy declares "I have it"; the patient finds it without signing in; it expires
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select drug_id into d from public.finder_pharmacy_list(c.ph_a) where product_id = c.p1;
  if public.finder_set_stock(c.ph_a, d, true) <> 'ok' then raise exception 'TEST FAIL T151 declare'; end if;
  begin perform public.finder_pharmacy_list(c.ph_t1); raise exception 'TEST FAIL T151 other pharmacy readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ declare c record; d uuid; r record; begin
  select * into c from t_f;
  select drug_id into d from public.finder_search(null, c.teh) where product_id = c.p1;
  if d is null or (select in_city from public.finder_search(null, c.teh) where drug_id = d) <> 1 then raise exception 'TEST FAIL T151 search'; end if;
  select * into r from public.finder_pharmacies(d, c.teh) limit 1;
  if r.pharmacy_id is distinct from c.ph_a or r.phone <> '02100000001' or not r.in_city or r.distance_km is null then
    raise exception 'TEST FAIL T151 result %', row_to_json(r);
  end if;
end $$;
reset role;
update public.finder_stock set confirmed_at = now() - interval '4 days';
set role anon;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p1;
  if exists (select 1 from public.finder_pharmacies(d, c.teh)) then raise exception 'TEST FAIL T151 expired still shown'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p1;
  if (select fresh from public.finder_pharmacy_list(c.ph_a) where drug_id = d) then raise exception 'TEST FAIL T151 shows fresh'; end if;
  if public.finder_confirm_all(c.ph_a) <> 1 then raise exception 'TEST FAIL T151 re-confirm count'; end if;
end $$;
reset role;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p1;
  if not exists (select 1 from public.finder_pharmacies(d, c.teh)) then raise exception 'TEST FAIL T151 re-confirm'; end if;
  raise notice 'PASS T151 declare, anonymous search with phone, expiry after 3 days, re-confirm';
end $$;
reset role;

-- T152: the patient's city first; other cities only when none there
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p2;
  insert into public.finder_stock (pharmacy_id, drug_id) values (c.ph_i1, d);
end $$;
set role anon;
do $$ declare c record; d uuid; r record; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p2;
  select * into r from public.finder_pharmacies(d, c.teh);
  if r.pharmacy_id is distinct from c.ph_i1 or r.in_city then raise exception 'TEST FAIL T152 fallback %', row_to_json(r); end if;
end $$;
reset role;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p2;
  insert into public.finder_stock (pharmacy_id, drug_id) values (c.ph_t1, d);
  if (select count(*) from public.finder_pharmacies(d, c.teh)) <> 1 or not (select in_city from public.finder_pharmacies(d, c.teh)) then
    raise exception 'TEST FAIL T152 other city shown while the city has it';
  end if;
  delete from public.finder_stock where pharmacy_id = c.ph_t1 and drug_id = d;
  update public.settings set value = 'false' where key = 'finder.other_cities' and scope = 'platform';
  if exists (select 1 from public.finder_pharmacies(d, c.teh)) then raise exception 'TEST FAIL T152 setting off'; end if;
  update public.settings set value = 'true' where key = 'finder.other_cities' and scope = 'platform';
  raise notice 'PASS T152 city first, other cities only when none (setting)';
end $$;

-- T153: "didn't have it" needs sign-in, has a cooldown, and 3 reports push the pharmacy down
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p1;
  begin
    if public.finder_report(d, c.ph_a) <> 'login' then raise exception 'TEST FAIL T153 anon report'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ declare c record; d uuid; begin
  select * into c from t_f;
  select id into d from t_d where product_id = c.p1;
  insert into public.finder_stock (pharmacy_id, drug_id) values (c.ph_t1, d);
  -- make test-owner-a the nearest to the city centre so demotion is visible
  update public.pharmacies set lat = (select lat from public.cities where id = c.teh), lng = (select lng from public.cities where id = c.teh) where id = c.ph_a;
  if (select pharmacy_id from public.finder_pharmacies(d, c.teh) limit 1) <> c.ph_a then raise exception 'TEST FAIL T153 setup'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000051', false) \gset ignore_
set role authenticated;
do $$ declare c record; d uuid; begin
  select * into c from t_f; select id into d from t_d where product_id = c.p1;
  if public.finder_report(d, c.ph_a, 'نداشت') <> 'ok' or public.finder_report(d, c.ph_a) <> 'cooldown' then raise exception 'TEST FAIL T153 cooldown'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000052', false) \gset ignore_
set role authenticated;
do $$ declare c record; d uuid; begin
  select * into c from t_f; select id into d from t_d where product_id = c.p1;
  perform public.finder_report(d, c.ph_a);
  if (select pharmacy_id from public.finder_pharmacies(d, c.teh) limit 1) <> c.ph_a then raise exception 'TEST FAIL T153 demoted too early'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000053', false) \gset ignore_
set role authenticated;
do $$ declare c record; d uuid; r record; begin
  select * into c from t_f; select id into d from t_d where product_id = c.p1;
  perform public.finder_report(d, c.ph_a);
  select * into r from public.finder_pharmacies(d, c.teh) limit 1;
  if r.pharmacy_id = c.ph_a then raise exception 'TEST FAIL T153 not demoted'; end if;
  if not (select demoted from public.finder_pharmacies(d, c.teh) where pharmacy_id = c.ph_a) then raise exception 'TEST FAIL T153 flag'; end if;
  raise notice 'PASS T153 reports need sign-in, cooldown, 3 reports push the pharmacy down';
end $$;
reset role;

-- T154: pharmacy suggestions wait for Dorva unless "direct" is on
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare c record; begin
  select * into c from t_f;
  if public.finder_suggest(c.ph_a, c.p3, 'در منطقه کم است') <> 'pending' then raise exception 'TEST FAIL T154 pending'; end if;
  if public.finder_suggest(c.ph_a, c.p3) <> 'exists' then raise exception 'TEST FAIL T154 duplicate'; end if;
  if public.finder_suggest(c.ph_a, c.p1) <> 'listed' then raise exception 'TEST FAIL T154 listed'; end if;
  if exists (select 1 from public.finder_pharmacy_list(c.ph_a) where product_id = c.p3) then raise exception 'TEST FAIL T154 joined without approval'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$ declare c record; s uuid; begin
  select * into c from t_f;
  select id into s from public.finder_admin_suggestions() where product_id = c.p3;
  if s is null or public.finder_admin_decide(s, true) <> 'ok' then raise exception 'TEST FAIL T154 approve'; end if;
  if not exists (select 1 from public.finder_admin_list() where product_id = c.p3 and status = 'active' and origin = 'suggestion') then
    raise exception 'TEST FAIL T154 not listed after approval';
  end if;
  perform public.finder_admin_set(c.p3, 'off');
end $$;
reset role;
update public.settings set value = 'true' where key = 'finder.direct_suggestions' and scope = 'platform';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare c record; begin
  select * into c from t_f;
  if public.finder_suggest(c.ph_a, c.p3) <> 'added' then raise exception 'TEST FAIL T154 direct'; end if;
  raise notice 'PASS T154 suggestions need Dorva approval; direct entry follows the setting';
end $$;
reset role;
update public.settings set value = 'false' where key = 'finder.direct_suggestions' and scope = 'platform';

-- T155: searches and call clicks are logged and counted; stats stay private
set role anon;
do $$ declare c record; d uuid; begin
  select * into c from t_f; select id into d from t_d where product_id = c.p1;
  perform public.finder_log('search', null, null, 'zzqx', 0, c.teh);
  perform public.finder_log('view', d, null, null, null, c.teh);
  perform public.finder_log('call', d, c.ph_t1, null, null, c.teh);
  perform public.finder_log('call', d, null);               -- incomplete call: ignored
  if exists (select 1 from public.finder_events) then raise exception 'TEST FAIL T155 events readable'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$ declare c record; m jsonb; begin
  select * into c from t_f;
  m := public.finder_stats(null, 30);
  if (m->>'calls')::int <> 1 or (m->>'reports')::int <> 3 or (m->>'searches')::int <> 1 or jsonb_array_length(m->'unmet') <> 1
     or (m->>'demoted')::int < 1 then
    raise exception 'TEST FAIL T155 platform %', m;
  end if;
  m := public.finder_stats(c.ph_t1, 30);
  if (m->>'calls')::int <> 1 or (m->>'reports')::int <> 0 or m->'unmet' <> '[]'::jsonb then raise exception 'TEST FAIL T155 pharmacy %', m; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  begin perform public.finder_stats(null, 30); raise exception 'TEST FAIL T155 customer stats';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T155 searches, views and calls logged anonymously; statistics private';
end $$;
reset role;

-- T156: switched off, the patient side returns nothing
update public.settings set value = 'false' where key = 'finder.enabled' and scope = 'platform';
set role anon;
do $$ declare c record; begin
  select * into c from t_f;
  if exists (select 1 from public.finder_search(null, c.teh)) then raise exception 'TEST FAIL T156'; end if;
  raise notice 'PASS T156 the finder can be switched off';
end $$;
reset role;
update public.settings set value = 'true' where key = 'finder.enabled' and scope = 'platform';
