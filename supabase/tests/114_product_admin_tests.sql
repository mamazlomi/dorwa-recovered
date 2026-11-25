-- T237-T241: product hub — settings per product and in bulk, max per order, minimum price,
-- technical-officer override (never off for Rx), per-product commission, badges, access
reset role;
do $$
declare boss uuid := (select m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
                      where rp.permission_code = 'policy.manage' and m.pharmacy_id is null limit 1);
        ph uuid := (select id from public.pharmacies where slug = 'test-owner-a');
        a uuid; rx uuid; r jsonb; h jsonb;
begin
  if boss is null then raise notice 'SKIP T237'; return; end if;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  select s.product_id into a from public.stock_items s join public.catalog_products p on p.id = s.product_id
   where s.pharmacy_id = ph and p.dispensing_class = 'supplement' order by s.product_id limit 1;
  select id into rx from public.catalog_products where dispensing_class = 'rx' limit 1;
  if a is null or rx is null then raise notice 'SKIP T237 data'; return; end if;
  update public.stock_items set quantity = 50, price = null, discount_pct = 0 where pharmacy_id = ph and product_id = a;
  insert into public.product_listings (product_id, is_published, base_price, price_policy) values (a, true, 1000000, 'free')
  on conflict (product_id) do update set is_published = true, base_price = 1000000, price_policy = 'free';

  -- T237: one save mixes listing fields and settings; bad values reported per row
  r := public.product_admin_save(jsonb_build_array(
    jsonb_build_object('id', a, 'base_price', '1000000', 'max_per_order', '3', 'min_price', '900000', 'commission_pct', '7.5',
                       'tech_approval', 'false', 'badge', 'featured'),
    jsonb_build_object('id', rx, 'tech_approval', 'false'),
    jsonb_build_object('id', rx, 'max_per_order', '0'),
    jsonb_build_object('id', rx, 'badge', 'nope')));
  if (r->>'ok')::int <> 1 or jsonb_array_length(r->'errors') <> 3 or not (r->'errors' @> '[{"code":"rx_tech"}]') then raise exception 'TEST FAIL T237 %', r; end if;
  raise notice 'PASS T237 mixed save, per-row errors, Rx approval cannot be switched off';

  -- T238: technical approval override follows to the product and survives a catalog re-sync
  if (select requires_tech_approval from public.catalog_products where id = a) then raise exception 'TEST FAIL T238 override'; end if;
  update public.catalog_products set requires_tech_approval = true where id = a;
  if (select requires_tech_approval from public.catalog_products where id = a) then raise exception 'TEST FAIL T238 lost on write'; end if;
  perform public.product_admin_save(jsonb_build_array(jsonb_build_object('id', a, 'tech_approval', null)));
  if not (select requires_tech_approval from public.catalog_products where id = a) then raise exception 'TEST FAIL T238 back to class'; end if;
  raise notice 'PASS T238 technical approval override, back to class default when cleared';

  -- T239: max per order caps the basket and checkout lines
  if public.product_max_qty(a, ph) <> 3 then raise exception 'TEST FAIL T239 max qty %', public.product_max_qty(a, ph); end if;
  if (select qty from app.cart_lines(jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 10)))) <> 3 then raise exception 'TEST FAIL T239 cart lines'; end if;
  raise notice 'PASS T239 max per order';

  -- T240: minimum price — a discount below it is refused; an existing offer is lifted to it
  begin
    update public.stock_items set discount_pct = 15 where pharmacy_id = ph and product_id = a;
    raise exception 'TEST FAIL T240 below minimum accepted';
  exception when check_violation then null; end;
  update public.stock_items set discount_pct = 5 where pharmacy_id = ph and product_id = a;
  perform public.product_admin_save(jsonb_build_array(jsonb_build_object('id', a, 'min_price', '990000')));
  if (select final_price from app.offers where pharmacy_id = ph and product_id = a) <> 990000 then
    raise exception 'TEST FAIL T240 offer not lifted %', (select final_price from app.offers where pharmacy_id = ph and product_id = a);
  end if;
  raise notice 'PASS T240 minimum price on writes and on existing offers';

  -- T241: commission per product, hub row, extras
  if app.commission_pct('supplement', a) <> 7.5 then raise exception 'TEST FAIL T241 commission'; end if;
  select x into h from jsonb_array_elements(public.admin_products()) x where x->>'id' = a::text;
  if (h->>'maxq')::int <> 3 or h->>'badge' <> 'featured' or (h->>'comm')::numeric <> 7.5 or (h->>'tech_eff')::boolean is not true then
    raise exception 'TEST FAIL T241 hub row %', h;
  end if;
  if public.product_extras(array[a])->a::text->'badge'->>'code' <> 'featured' then raise exception 'TEST FAIL T241 extras'; end if;
  raise notice 'PASS T241 per-product commission, hub row and public extras';
end $$;

-- the same save as a signed-in Dorva manager (row security on, no direct table access)
select set_config('request.jwt.claim.sub', (select m.user_id::text from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
  where rp.permission_code = 'policy.manage' and m.pharmacy_id is null limit 1), false) \gset ignore_
set role authenticated;
do $$
declare a uuid := (select id from public.catalog_products where dispensing_class = 'supplement' order by id desc limit 1); r jsonb;
begin
  r := public.product_admin_save(jsonb_build_array(jsonb_build_object('id', a, 'max_per_order', '4', 'badge', 'new', 'commission_pct', '3')));
  if (r->>'ok')::int <> 1 then raise exception 'TEST FAIL T242a signed-in save %', r; end if;
  if jsonb_array_length(public.admin_products()) < 1 then raise exception 'TEST FAIL T242a hub'; end if;
  raise notice 'PASS T242a Dorva manager saves through the hub';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare a uuid := (select id from public.catalog_products limit 1); r jsonb;
begin
  begin perform public.admin_products(); raise exception 'TEST FAIL T242 hub open to pharmacy';
  exception when insufficient_privilege then null; end;
  r := public.product_admin_save(jsonb_build_array(jsonb_build_object('id', a, 'max_per_order', '2')));
  if r->'errors'->0->>'code' <> 'forbidden' then raise exception 'TEST FAIL T242 save %', r; end if;
  begin insert into public.product_settings (product_id, max_per_order) values (a, 1); raise exception 'TEST FAIL T242 direct write';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T242 pharmacies cannot read the hub or change Dorva settings';
end $$;
reset role;

-- T243: price approval per product overrides the general setting
do $$
declare boss uuid := (select m.user_id from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
                      where rp.permission_code = 'policy.manage' and m.pharmacy_id is null limit 1);
        ph uuid := (select id from public.pharmacies where slug = 'test-owner-a'); a uuid; r jsonb;
begin
  if boss is null then raise notice 'SKIP T243'; return; end if;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  select s.product_id into a from public.stock_items s join public.product_listings l on l.product_id = s.product_id and l.price_policy = 'free'
   where s.pharmacy_id = ph limit 1;
  if a is null then raise notice 'SKIP T243 data'; return; end if;
  r := public.product_admin_save(jsonb_build_array(jsonb_build_object('id', a, 'price_approval', 'false', 'min_price', null)));
  if (r->>'ok')::int <> 1 then raise exception 'TEST FAIL T243 save %', r; end if;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  update public.stock_items set price = 1200000, discount_pct = 0 where pharmacy_id = ph and product_id = a;
  if (select price from public.stock_items where pharmacy_id = ph and product_id = a) <> 1200000 then raise exception 'TEST FAIL T243 price waited for approval'; end if;
  perform set_config('request.jwt.claim.sub', boss::text, true);
  perform public.product_admin_save(jsonb_build_array(jsonb_build_object('id', a, 'price_approval', 'true')));
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  update public.stock_items set price = 1300000 where pharmacy_id = ph and product_id = a;
  if (select price_requested from public.stock_items where pharmacy_id = ph and product_id = a) <> 1300000 then raise exception 'TEST FAIL T243 approval not asked'; end if;
  raise notice 'PASS T243 pharmacy price approval set per product';
end $$;

-- T244-T246: configuration snapshots
select set_config('request.jwt.claim.sub', (select m.user_id::text from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
  where rp.permission_code = 'settings.manage' and m.pharmacy_id is null limit 1), false) \gset ignore_
set role authenticated;
do $$
declare sid bigint; r jsonb; v_before text; n_coll int; a uuid;
begin
  v_before := (select value::text from public.settings where key = 'catalog.sync_minutes' and scope = 'platform');
  n_coll := (select count(*) from public.collections);
  select product_id into a from public.product_listings order by product_id limit 1;
  sid := public.config_snapshot_create('پیش از سند ۵', array['settings', 'pages', 'products', 'stock']);
  -- test-time changes: a setting, a new collection, a deleted listing, a changed stock row
  update public.settings set value = '42' where key = 'catalog.sync_minutes' and scope = 'platform';
  insert into public.collections (slug, title, status) values ('snap-test', '{"fa":"آزمون"}', 'draft');
  delete from public.product_listings where product_id = a;
  if public.config_snapshot_restore(sid, array['settings', 'pages', 'products'], 'نام اشتباه')->>'error' <> 'confirm' then raise exception 'TEST FAIL T244 confirm'; end if;
  r := public.config_snapshot_restore(sid, array['settings', 'pages', 'products'], 'پیش از سند ۵');
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'TEST FAIL T245 restore %', r; end if;
  if (select value::text from public.settings where key = 'catalog.sync_minutes' and scope = 'platform') <> v_before then raise exception 'TEST FAIL T245 setting'; end if;
  if (select count(*) from public.collections) <> n_coll then raise exception 'TEST FAIL T245 collection kept'; end if;
  if not exists (select 1 from public.product_listings where product_id = a) then raise exception 'TEST FAIL T245 listing'; end if;
  -- the restore saved the replaced state first, and triggers are back on
  if not exists (select 1 from jsonb_array_elements(public.config_snapshots()) x where (x->>'auto')::boolean and (x->>'id')::bigint = (r->>'safety')::bigint) then
    raise exception 'TEST FAIL T246 safety snapshot';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.collections'::regclass and not tgisinternal and tgenabled = 'D') then raise exception 'TEST FAIL T246 triggers left off'; end if;
  raise notice 'PASS T244-T246 snapshot, confirm by name, restore of settings/pages/products, safety snapshot, triggers back on';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  begin perform public.config_snapshots(); raise exception 'TEST FAIL T246 pharmacy sees snapshots';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T246b pharmacies cannot use snapshots';
end $$;
reset role;
