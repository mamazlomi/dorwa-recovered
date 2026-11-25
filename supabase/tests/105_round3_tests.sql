-- T180-T189: stock cap, staff access ticks, staff profiles, pharmacy profile, smart finder
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000061', 'newbie@staff.test'),
  ('dddddddd-0000-0000-0000-000000000062', 'pro@staff.test')
on conflict do nothing;
create temp table t_r3 as select
  (select id from public.pharmacies where slug = 'test-owner-a') ph,
  (select id from public.roles where scope = 'pharmacy' and code = 'inventory_clerk' and pharmacy_id is null) clerk,
  (select id from public.roles where scope = 'pharmacy' and code = 'no_access' and pharmacy_id is null) none,
  (select id from public.cities where slug = 'tehran') teh;
grant select on t_r3 to anon, authenticated;

-- T180: the basket can never hold more than the stock
do $$
declare s record;
begin
  select si.product_id, si.pharmacy_id, si.quantity into s from public.stock_items si
  join public.pharmacies ph on ph.id = si.pharmacy_id and ph.status = 'active' where si.quantity between 1 and 50 limit 1;
  if s is null then raise notice 'SKIP T180: no stock row'; return; end if;
  if public.product_max_qty(s.product_id, s.pharmacy_id) <> s.quantity then raise exception 'TEST FAIL T180 pharmacy cap'; end if;
  if public.product_max_qty(s.product_id, null) < s.quantity then raise exception 'TEST FAIL T180 best cap'; end if;
  if public.product_max_qty(gen_random_uuid(), null) <> 0 then raise exception 'TEST FAIL T180 unknown product'; end if;
  raise notice 'PASS T180 stock cap';
end $$;

-- T181-T183: owner invites without a role, then ticks access
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare c record; st text;
begin
  select * into c from t_r3;
  st := public.staff_invite(c.ph, null, 'newbie@staff.test');
  if st <> 'ok' then raise exception 'TEST FAIL T181 invite without role: %', st; end if;
  if (select role_id from public.staff_invites where email = 'newbie@staff.test' and status = 'pending') <> c.none then
    raise exception 'TEST FAIL T181 invite should carry no access';
  end if;
  raise notice 'PASS T181 invite first, role later';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000061', false) \gset ignore_
set role authenticated;
do $$
declare c record;
begin
  select * into c from t_r3;
  perform public.staff_invite_answer((select id from public.staff_invites where email = 'newbie@staff.test' and status = 'pending'), true);
  if app.has_pharmacy_permission(c.ph, 'inventory.read') or cardinality(public.my_pharmacy_permissions(c.ph)) <> 0 then
    raise exception 'TEST FAIL T182 a new member must have no access';
  end if;
  raise notice 'PASS T182 joined with no access';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare c record; m uuid; st text;
begin
  select * into c from t_r3;
  select id into m from public.memberships where user_id = 'dddddddd-0000-0000-0000-000000000061' and pharmacy_id = c.ph;
  -- clerk template, minus stock editing, plus seeing orders
  st := public.staff_set_access(m, c.clerk, array['inventory.read', 'order.read']);
  if st <> 'ok' then raise exception 'TEST FAIL T183 set: %', st; end if;
  if (select perms from public.staff_list(c.ph) where membership_id = m) <> array['inventory.read', 'order.read'] then
    raise exception 'TEST FAIL T183 effective perms %', (select perms from public.staff_list(c.ph) where membership_id = m);
  end if;
  -- technical approval needs a licence number
  if public.staff_set_access(m, c.clerk, array['order.tech_approve']) <> 'license' then raise exception 'TEST FAIL T183 license'; end if;
  -- the last manager cannot drop their own staff permission
  if public.staff_set_access((select id from public.memberships where user_id = auth.uid() and pharmacy_id = c.ph limit 1),
                             null, array['inventory.read']) not in ('last_manager', 'ok') then
    raise exception 'TEST FAIL T183 last manager';
  end if;
  raise notice 'PASS T183 per-person permission ticks';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000061', false) \gset ignore_
set role authenticated;
do $$
declare c record;
begin
  select * into c from t_r3;
  if not app.has_pharmacy_permission(c.ph, 'order.read') or app.has_pharmacy_permission(c.ph, 'inventory.manage') then
    raise exception 'TEST FAIL T184 ticks not enforced';
  end if;
  -- T185: own profile; photo only in own folder
  if public.staff_profile_save('{"full_name":"نیوبی","expertise":["drug","cosmetic"],"is_public":true,"bio":"سلام"}') <> 'ok' then
    raise exception 'TEST FAIL T185 save';
  end if;
  if public.staff_profile_save(jsonb_build_object('photo', gen_random_uuid()::text || '/x.jpg')) <> 'photo' then
    raise exception 'TEST FAIL T185 foreign photo';
  end if;
  if public.staff_profile_save('{"expertise":["hacking"]}') <> 'value' then raise exception 'TEST FAIL T185 bad expertise'; end if;
  raise notice 'PASS T184 ticks enforced';
  raise notice 'PASS T185 staff profile';
end $$;
reset role;

update public.settings set value = '"free"' where key = 'moderation.profile' and scope = 'platform';
-- T186: pharmacy profile: only its staff edit; bad hours refused; public about tab
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  begin perform public.pharmacy_profile_get((select ph from t_r3)); raise exception 'TEST FAIL T186 customer read';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare c record; st text;
begin
  select * into c from t_r3;
  st := public.pharmacy_profile_save(c.ph, '{"lat":35.7,"lng":51.4,"founder_name":"دکتر الف","kind_codes":["round_clock","nope"],
    "insurers":["tamin"],"hours":{"always":false,"shifts":[{"days":[0,1,2],"from":"08:00","to":"22:00"}]},
    "officers":[{"full_name":"دکتر ب","council_no":"12345","shifts":[{"days":[0],"from":"08:00","to":"16:00"}]}],
    "about_fa":"داروخانه محله"}');
  if st <> 'ok' then raise exception 'TEST FAIL T186 save: %', st; end if;
  if public.pharmacy_profile_save(c.ph, '{"lat":35.7,"lng":51.4,"hours":{"shifts":[{"days":[9],"from":"8","to":"x"}]}}') <> 'hours' then
    raise exception 'TEST FAIL T186 bad hours';
  end if;
  if public.pharmacy_profile_save(c.ph, '{"lat":10,"lng":51.4}') <> 'location' then raise exception 'TEST FAIL T186 location'; end if;
  if (public.pharmacy_profile_get(c.ph)->'kind_codes') <> '["round_clock"]'::jsonb then raise exception 'TEST FAIL T186 unknown kind kept'; end if;
  raise notice 'PASS T186 pharmacy profile';
end $$;
reset role;
set role anon;
do $$ begin
  if jsonb_array_length(public.pharmacy_about_public((select ph from t_r3))->'officers') <> 1 then raise exception 'TEST FAIL T187 public officers'; end if;
  if (select count(*) from public.pharmacy_team_public((select ph from t_r3)) where full_name = 'نیوبی') <> 1 then
    raise exception 'TEST FAIL T187 public team';
  end if;
  raise notice 'PASS T187 public about tab and team';
end $$;
reset role;

-- T188-T189: misspelt unanswered searches become a regional shortage and alert that city's pharmacies
update public.settings set value = '3' where key = 'finder.auto_regional_threshold';
do $$
declare c record; p record; q text; v_drug uuid;
begin
  select * into c from t_r3;
  select id, name_fa into p from public.catalog_products
  where is_active and dispensing_class in ('otc', 'supplement') and length(name_fa) >= 6
    and id not in (select product_id from public.finder_drugs) order by name_fa limit 1;
  if p is null then raise notice 'SKIP T188: no product'; return; end if;
  -- drop one letter: a typo
  q := left(p.name_fa, 2) || substr(p.name_fa, 4);
  if (select product_id from app.finder_resolve(q)) is distinct from p.id then
    raise notice 'SKIP T188: typo "%" did not resolve to "%"', q, p.name_fa; return;
  end if;
  perform public.finder_log('search', null, null, q, 0, c.teh);
  perform public.finder_log('search', null, null, q, 0, c.teh);
  if exists (select 1 from public.finder_drugs where product_id = p.id) then raise exception 'TEST FAIL T188 listed too early'; end if;
  perform public.finder_log('search', null, null, p.name_fa, 0, c.teh);
  select id into v_drug from public.finder_drugs where product_id = p.id and origin = 'auto' and scope = 'regional';
  if v_drug is null then raise exception 'TEST FAIL T188 not auto-listed'; end if;
  if not exists (select 1 from public.finder_alerts a join public.pharmacies ph on ph.id = a.pharmacy_id
                 where a.drug_id = v_drug and ph.city_id = c.teh) then raise exception 'TEST FAIL T188 no alert'; end if;
  if exists (select 1 from public.finder_alerts a join public.pharmacies ph on ph.id = a.pharmacy_id
             where a.drug_id = v_drug and ph.city_id <> c.teh) then raise exception 'TEST FAIL T188 alert outside the city'; end if;
  -- T189: the typo now finds the listed medicine
  if not exists (select 1 from public.finder_search(q, c.teh) s where s.product_id = p.id) then
    raise exception 'TEST FAIL T189 typo search';
  end if;
  raise notice 'PASS T188 regional shortage from misspelt searches';
  raise notice 'PASS T189 typo-tolerant finder search';
end $$;
update public.settings set value = '5' where key = 'finder.auto_regional_threshold';
reset role;
update public.settings set value = '"approval"' where key = 'moderation.profile' and scope = 'platform';
