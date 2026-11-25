-- Core behaviour tests. Run with psql -v ON_ERROR_STOP=1.
-- Each check raises 'TEST FAIL' on failure; expected errors are trapped by SQLSTATE.
\set QUIET on
\set ON_ERROR_STOP 1

-- ---------- fixtures (as superuser) ----------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'owner-b@test'),
  ('cccccccc-0000-0000-0000-000000000003', 'platform@test');
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'cccccccc-0000-0000-0000-000000000003', null, id from public.roles
 where scope = 'platform' and code = 'super_admin';

select id as tehran_id from public.cities where slug = 'tehran' \gset
select md5('dorva-sample-product-5')::uuid as vit_d \gset
select md5('dorva-sample-product-13')::uuid as metformin \gset

-- ---------- T1 owner A registers a pharmacy ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
select public.register_pharmacy('داروخانه آزمون الف', 'test-owner-a', 'LIC-A-001', :tehran_id,
       'تهران، خیابان آزمون', 35.70, 51.40, '021000', 'دکتر آزمون', 'TO-1', array['tamin']) as pa \gset
do $$ begin
  if (select status from public.pharmacies where slug = 'test-owner-a') <> 'pending' then
    raise exception 'TEST FAIL T1: new pharmacy should be pending'; end if;
  if not app.has_pharmacy_permission((select id from public.pharmacies where slug='test-owner-a'), 'inventory.manage') then
    raise exception 'TEST FAIL T1: registrant should be owner'; end if;
  raise notice 'PASS T1 registration creates pending pharmacy + owner membership';
end $$;

-- ---------- T2/T3 visibility of pending pharmacy ----------
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$ begin
  if exists (select 1 from public.pharmacies where slug = 'test-owner-a') then
    raise exception 'TEST FAIL T2: anon must not see pending pharmacy'; end if;
  raise notice 'PASS T2 pending pharmacy hidden from public';
end $$;
reset role;

-- ---------- T4/T5 owner cannot self-approve but can edit profile ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  update public.pharmacies set status = 'active' where slug = 'test-owner-a';
  raise exception 'TEST FAIL T4: owner self-approved';
exception when insufficient_privilege then
  raise notice 'PASS T4 owner cannot change status';
end $$;
update public.pharmacies set about_fa = 'معرفی آزمایشی' where slug = 'test-owner-a';
do $$ begin
  if (select about_fa from public.pharmacies where slug = 'test-owner-a') is distinct from 'معرفی آزمایشی' then
    raise exception 'TEST FAIL T5: owner profile edit lost'; end if;
  raise notice 'PASS T5 owner edits own profile';
end $$;
reset role;

-- ---------- T6/T7 platform approves; becomes public ----------
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
select public.review_pharmacy(:'pa', true, 'مدارک کامل');
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$ begin
  if not exists (select 1 from public.pharmacies where slug = 'test-owner-a' and status = 'active') then
    raise exception 'TEST FAIL T7: approved pharmacy not public'; end if;
  raise notice 'PASS T6/T7 platform approval makes pharmacy public';
end $$;
reset role;

-- ---------- T8/T9 Dorva price and discount policy on stock ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  insert into public.stock_items (pharmacy_id, product_id, quantity, discount_pct)
  values ((select id from public.pharmacies where slug='test-owner-a'), md5('dorva-sample-product-5')::uuid, 10, 50);
  raise exception 'TEST FAIL T8: 50%% discount accepted';
exception when check_violation then
  raise notice 'PASS T8 discount above category cap rejected';
end $$;
insert into public.stock_items (pharmacy_id, product_id, quantity, discount_pct)
values (:'pa', :'vit_d', 10, 5);
do $$ begin
  update public.stock_items set price = 700000
   where product_id = md5('dorva-sample-product-5')::uuid
     and pharmacy_id = (select id from public.pharmacies where slug='test-owner-a');
  raise exception 'TEST FAIL T9: price above cap accepted';
exception when check_violation then
  raise notice 'PASS T9 price above Dorva cap rejected';
end $$;
do $$ begin
  insert into public.stock_items (pharmacy_id, product_id, quantity, discount_pct)
  values ((select id from public.pharmacies where slug='test-owner-a'), md5('dorva-sample-product-13')::uuid, 5, 1);
  raise exception 'TEST FAIL T9b: discount on Rx accepted';
exception when check_violation then
  raise notice 'PASS T9b any discount on prescription drugs rejected';
end $$;
reset role;

-- ---------- T10 tenant isolation between pharmacies ----------
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false) \gset ignore_
set role authenticated;
select public.register_pharmacy('داروخانه آزمون ب', 'test-owner-b', 'LIC-B-001', :tehran_id,
       'تهران', 35.72, 51.41, '021111', 'دکتر ب', 'TO-2') as pb \gset
do $$ begin
  if exists (select 1 from public.stock_items
              where pharmacy_id = (select id from public.pharmacies where slug='test-owner-a')) then
    raise exception 'TEST FAIL T10: owner B reads owner A stock'; end if;
  raise notice 'PASS T10a pharmacy B cannot read pharmacy A stock';
end $$;
do $$ begin
  insert into public.stock_items (pharmacy_id, product_id, quantity)
  values ((select id from public.pharmacies where slug='test-owner-a'), md5('dorva-sample-product-1')::uuid, 99);
  raise exception 'TEST FAIL T10b: owner B wrote into pharmacy A';
exception when insufficient_privilege then
  raise notice 'PASS T10b pharmacy B cannot write pharmacy A stock';
end $$;
reset role;

-- ---------- T11/T12 anonymous access ----------
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$ begin
  perform 1 from public.stock_items limit 1;
  raise exception 'TEST FAIL T11: anon read stock_items';
exception when insufficient_privilege then
  raise notice 'PASS T11 anon blocked from raw stock';
end $$;
do $$ begin
  if (select count(*) from public.list_offers(null, (select id from public.cities where slug='tehran'))) = 0 then
    raise exception 'TEST FAIL T12: no public offers'; end if;
  if (select count(*) from public.list_offers()) <> 0 then
    raise exception 'TEST FAIL T12: unfiltered offer dump allowed'; end if;
  begin
    perform 1 from app.offers limit 1;
    raise exception 'TEST FAIL T12: anon read internal offers view';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T12 public offers only via filtered function, no quantities, no raw view';
end $$;
do $$ begin
  perform public.register_pharmacy('x','xxx-anon','L',1,'',35.7,51.4,'','','');
  raise exception 'TEST FAIL T19: anon registered a pharmacy';
exception when insufficient_privilege then
  raise notice 'PASS T19 anon cannot register a pharmacy';
end $$;

-- ---------- T13 allocation ----------
do $$
declare r record; n int := 0; prev_items int := 99; isfahan int;
begin
  for r in select * from public.nearest_pharmacies(35.6892, 51.3890,
             (select array_agg(id) from public.catalog_products), 5) loop
    n := n + 1;
    if r.distance_km > 5 then raise exception 'TEST FAIL T13: % km outside radius', r.distance_km; end if;
    if r.items_available > prev_items then raise exception 'TEST FAIL T13: not ranked by basket coverage'; end if;
    prev_items := r.items_available;
  end loop;
  if n = 0 then raise exception 'TEST FAIL T13: no pharmacy found in Tehran'; end if;
  select count(*) into isfahan from public.nearest_pharmacies(35.6892, 51.3890, null, 5) x
   where x.slug like 'test-isfahan%';
  if isfahan > 0 then raise exception 'TEST FAIL T13: Isfahan pharmacy returned for Tehran'; end if;
  raise notice 'PASS T13 nearest pharmacies: % found, within radius, ranked by coverage', n;
end $$;
reset role;

-- ---------- T14 no-code setting drives radius + audit ----------
do $$
declare small int; big int;
begin
  select count(*) into small from public.nearest_pharmacies(35.6892, 51.3890);
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false);
  execute 'set role authenticated';
  update public.settings set value = '50' where key = 'allocation.initial_radius_km' and scope = 'platform';
  execute 'reset role';
  select count(*) into big from public.nearest_pharmacies(35.6892, 51.3890);
  if big <= small then raise exception 'TEST FAIL T14: radius setting had no effect (% vs %)', small, big; end if;
  if not exists (select 1 from public.settings_audit
                  where key = 'allocation.initial_radius_km'
                    and changed_by = 'cccccccc-0000-0000-0000-000000000003') then
    raise exception 'TEST FAIL T14: settings change not audited'; end if;
  raise notice 'PASS T14 radius from settings (% -> % pharmacies), change audited', small, big;
end $$;

-- ---------- T15 pharmacy-level override, platform keys protected ----------
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  update public.settings set value = '1' where key = 'allocation.initial_radius_km' and scope = 'platform';
  if (select value from public.settings where key='allocation.initial_radius_km' and scope='platform') = '1' then
    raise exception 'TEST FAIL T15: owner changed platform setting'; end if;
  raise notice 'PASS T15a owner cannot change platform settings';
end $$;
insert into public.settings (key, scope, scope_id, value)
values ('tech_approval.window_min', 'pharmacy', :'pa', '30');
do $$ begin
  if app.setting('tech_approval.window_min', (select id from public.pharmacies where slug='test-owner-a')) <> '30'::jsonb
     or app.setting('tech_approval.window_min') <> '15'::jsonb then
    raise exception 'TEST FAIL T15b: setting resolution order wrong'; end if;
  raise notice 'PASS T15b pharmacy override resolves before platform default';
end $$;
reset role;

-- ---------- T16/T17/T18 integrity rules ----------
do $$ begin
  insert into public.memberships (user_id, pharmacy_id, role_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          (select id from public.pharmacies where slug='test-owner-a'),
          (select id from public.roles where scope='platform' and code='super_admin'));
  raise exception 'TEST FAIL T16: platform role granted inside a pharmacy';
exception when raise_exception then
  if sqlerrm like 'TEST FAIL%' then raise; end if;
  raise notice 'PASS T16 role scope enforced on memberships';
end $$;
do $$ begin
  insert into public.catalog_products (id, name_fa, dispensing_class, requires_tech_approval)
  values (gen_random_uuid(), 'نسخه‌ای بدون تایید', 'rx', false);
  raise exception 'TEST FAIL T17: rx without tech approval accepted';
exception when check_violation then
  raise notice 'PASS T17 prescription drugs always require technical approval';
end $$;
do $$ begin
  perform app.upsert_catalog_product(jsonb_build_object(
    'id', md5('dorva-sample-product-1'), 'name_fa', 'نسخه قدیمی', 'dispensing_class', 'general', 'version', 0));
  if (select name_fa from public.catalog_products where id = md5('dorva-sample-product-1')::uuid) = 'نسخه قدیمی' then
    raise exception 'TEST FAIL T18: stale catalog event overwrote newer data'; end if;
  perform app.upsert_catalog_product(jsonb_build_object(
    'id', md5('dorva-sample-product-1'), 'name_fa', 'پوشک بچه سایز ۴ (نمونه، نسخه ۲)', 'dispensing_class', 'general', 'version', 2));
  if (select catalog_version from public.catalog_products where id = md5('dorva-sample-product-1')::uuid) <> 2 then
    raise exception 'TEST FAIL T18: newer catalog event not applied'; end if;
  raise notice 'PASS T18 catalog sync ignores stale versions, applies newer ones';
end $$;

do $$ begin
  insert into public.pharmacies (slug, name_fa, license_no, city_id, lat, lng)
  values ('admin', 'رزرو', 'LIC-RESERVED', 1, 35.7, 51.4);
  raise exception 'TEST FAIL T20: reserved slug accepted';
exception when check_violation then
  raise notice 'PASS T20 reserved route names cannot be pharmacy slugs';
end $$;

select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$ begin
  if not ('pharmacy.approve' = any(public.my_platform_permissions())) then
    raise exception 'TEST FAIL T21: platform admin permissions missing'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  if cardinality(public.my_platform_permissions()) <> 0 then
    raise exception 'TEST FAIL T21: pharmacy owner has platform permissions'; end if;
  raise notice 'PASS T21 platform permissions reported only to platform staff';
end $$;
reset role;

-- ---------- T22–T25 search, filters, districts, translations ----------
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$
declare tehran int := (select id from public.cities where slug = 'tehran');
        d int; n_all int; n_d int; n_ins int; n_q int; n_near int;
begin
  select count(*) into n_all from public.search_pharmacies(p_city => tehran);
  select min(district_id) into d from public.search_pharmacies(p_city => tehran) where district_id is not null;
  select count(*) into n_d from public.search_pharmacies(p_city => tehran, p_district => d);
  if n_all = 0 or d is null or n_d = 0 or n_d >= n_all then
    raise exception 'TEST FAIL T22: district filter (% of %, district %)', n_d, n_all, d; end if;
  raise notice 'PASS T22 district filter narrows Tehran list (% -> %)', n_all, n_d;

  select count(*) into n_ins from public.search_pharmacies(p_insurer => 'armed');
  if n_ins <> 0 then raise exception 'TEST FAIL T23: insurer filter returned % for unused insurer', n_ins; end if;
  select count(*) into n_ins from public.search_pharmacies(p_insurer => 'tamin');
  if n_ins = 0 then raise exception 'TEST FAIL T23: insurer filter found nothing for tamin'; end if;
  raise notice 'PASS T23 insurer filter (tamin: %, armed: 0)', n_ins;

  select count(*) into n_q from public.search_pharmacies(p_query => 'Virtual pharmacy Shiraz');
  if n_q <> 2 then raise exception 'TEST FAIL T24: English text search found % (want 2)', n_q; end if;
  select count(*) into n_q from public.search_pharmacies(p_query => 'اصفهان');
  if n_q <> 3 then raise exception 'TEST FAIL T24: Persian text search found % (want 3)', n_q; end if;
  select count(*) into n_near from public.search_pharmacies(p_lat => 35.6892, p_lng => 51.3890, p_radius_km => 10);
  if n_near = 0 or exists (select 1 from public.search_pharmacies(p_lat => 35.6892, p_lng => 51.3890, p_radius_km => 10) x
                            where x.distance_km > 10) then
    raise exception 'TEST FAIL T24: near-me search'; end if;
  raise notice 'PASS T24 text search in Persian and English, near-me radius (% found)', n_near;
end $$;
reset role;
do $$ begin
  update public.pharmacies set district_id = (select id from public.districts where code = 'd1' limit 1)
   where slug = 'test-isfahan-1';
  raise exception 'TEST FAIL T25: Tehran district accepted for an Isfahan pharmacy';
exception when check_violation then
  raise notice 'PASS T25 district must belong to the pharmacy city';
end $$;

\echo ALL CORE TESTS PASSED
