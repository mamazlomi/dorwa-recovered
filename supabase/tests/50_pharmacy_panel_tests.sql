-- Pharmacy panel overview: own discount vs Dorva cap, members only.
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000004', 'owner-t1@test');
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'dddddddd-0000-0000-0000-000000000004', ph.id, r.id
  from public.pharmacies ph, public.roles r
 where ph.slug = 'test-tehran-1' and r.scope = 'pharmacy' and r.code = 'owner' and r.pharmacy_id is null;
update public.discount_caps set is_active = false;
insert into public.stock_items (pharmacy_id, product_id, quantity, discount_pct, source)
select ph.id, md5('dorva-sample-product-6')::uuid, 4, 5, 'manual' from public.pharmacies ph where ph.slug = 'test-tehran-1'
on conflict (pharmacy_id, product_id) do update set discount_pct = 5, quantity = 4;
insert into public.discount_caps (scope, facet_key, facet_value, max_discount_pct) values ('facet', 'brand', 'SAMPLE-BR-B', 3)
on conflict (facet_key, facet_value) where scope = 'facet' do update set max_discount_pct = 3, is_active = true;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false) \gset ignore_
set role authenticated;
do $$
declare r record; n int;
begin
  select * into r from public.pharmacy_stock_overview((select id from public.pharmacies where slug = 'test-tehran-1'))
   where product_id = md5('dorva-sample-product-6')::uuid;
  if r.own_discount <> 5 or r.cap <> 3 or r.cap_source <> 'facet' or r.effective_discount <> 3 then
    raise exception 'TEST FAIL T54: own % cap % src % eff %', r.own_discount, r.cap, r.cap_source, r.effective_discount; end if;
  if r.final_price <> round(r.list_price * 0.97) then raise exception 'TEST FAIL T54 price: % %', r.final_price, r.list_price; end if;
  raise notice 'PASS T54 member sees own discount, Dorva cap, source and customer price';

  select count(*) into n from public.pharmacy_stock_overview((select id from public.pharmacies where slug = 'test-tehran-2'));
  if n <> 0 then raise exception 'TEST FAIL T55: non-member saw % rows', n; end if;
  raise notice 'PASS T55 another pharmacy''s stock stays hidden';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
\echo ALL PHARMACY PANEL TESTS PASSED
