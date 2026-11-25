-- T201-T205: barcode lookup, suggestions reviewed by Dorva, points, receiving stock, Excel import
reset role;
create temp table t_se as select
  (select id from public.pharmacies where slug = 'test-owner-a') ph,
  (select id from public.catalog_products where gtin is not null order by id limit 1) known,
  (select id from public.catalog_products where gtin is null order by id limit 1) unknown,
  (select m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
    where rp.permission_code = 'catalog.publish' and m.pharmacy_id is null limit 1) boss;
grant select on t_se to anon, authenticated;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare c record; g text;
begin
  select * into c from t_se;
  select gtin into g from public.catalog_products where id = c.known;
  if (select product_id from public.product_by_code(g, c.ph) limit 1) <> c.known then raise exception 'TEST FAIL T201 catalog gtin'; end if;
  if (select product_id from public.product_by_code('0' || g, c.ph) limit 1) <> c.known then raise exception 'TEST FAIL T201 leading zero'; end if;
  g := public.code_suggest(c.ph, '6260000999991', c.unknown);
  if g <> 'ok' then raise exception 'TEST FAIL T202 suggest % unknown=%', g, c.unknown; end if;
  select gtin into g from public.catalog_products where id = c.known;
  if public.code_suggest(c.ph, g, c.known) <> 'known' then raise exception 'TEST FAIL T202 known'; end if;
  if (select source from public.product_by_code('6260000999991', c.ph) limit 1) <> 'pending' then raise exception 'TEST FAIL T202 own pending visible'; end if;
  if public.stock_receive(c.ph, c.unknown, 4, 'B12', current_date + 300, 'UID1') <> 'ok' then raise exception 'TEST FAIL T204 receive'; end if;
  if public.stock_receive(c.ph, c.unknown, 1, null, current_date - 1) <> 'expired' then raise exception 'TEST FAIL T204 expired'; end if;
  if (select count(*) from public.stock_batches b join public.stock_items s on s.id = b.stock_item_id
      where s.pharmacy_id = c.ph and s.product_id = c.unknown and b.batch_no = 'B12') <> 1 then raise exception 'TEST FAIL T204 batch'; end if;
  g := public.stock_import_apply(c.ph, jsonb_build_array(jsonb_build_object('product_id', c.unknown, 'quantity', 9, 'discount_pct', 0, 'price', null)))::text;
  if (select quantity from public.stock_items where pharmacy_id = c.ph and product_id = c.unknown) <> 9 then
    raise exception 'TEST FAIL T205 import %', g;
  end if;
  raise notice 'PASS T201-T202, T204-T205 lookup, suggest, receive, import';
end $$;
reset role;

-- another pharmacy cannot see that pending suggestion; Dorva approves and points are granted
do $$
declare c record; sid uuid; pts int;
begin
  select * into c from t_se;
  if exists (select 1 from public.product_by_code('6260000999991', null)) then raise exception 'TEST FAIL T203 pending leaked'; end if;
  if c.boss is null then raise notice 'SKIP T203: no catalog admin'; return; end if;
  perform set_config('request.jwt.claim.sub', c.boss::text, true);
  select id into sid from public.code_suggestions() where code = '6260000999991';
  update public.settings set value = 'true' where key = 'enrich.priority_enabled';
  update public.settings set value = '5' where key = 'enrich.priority_points';
  update public.settings set value = '5' where key = 'enrich.points_per_code';
  if public.code_review(array[sid], true) <> 1 then raise exception 'TEST FAIL T203 review'; end if;
  if (select product_id from public.product_by_code('6260000999991', null) limit 1) <> c.unknown then raise exception 'TEST FAIL T203 approved lookup'; end if;
  pts := app.pharmacy_points_total(c.ph);
  if pts < 1 then raise exception 'TEST FAIL T203 points'; end if;
  if app.contribution_bonus(c.ph) <> 1 then raise exception 'TEST FAIL T203 bonus %', app.contribution_bonus(c.ph); end if;
  update public.settings set value = 'false' where key = 'enrich.priority_enabled';
  if app.contribution_bonus(c.ph) <> 0 then raise exception 'TEST FAIL T203 bonus off'; end if;
  raise notice 'PASS T203 Dorva review, points and switchable priority';
end $$;
