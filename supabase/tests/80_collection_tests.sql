-- Collections: rules, include/exclude, pharmacy copies, permissions.
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000008', 'admin-col@test'),
  ('dddddddd-0000-0000-0000-000000000009', 'owner-col@test')
on conflict do nothing;
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'dddddddd-0000-0000-0000-000000000008', null, r.id from public.roles r
 where r.scope = 'platform' and r.code = 'content_moderator';
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'dddddddd-0000-0000-0000-000000000009', ph.id, r.id
  from public.pharmacies ph, public.roles r
 where ph.slug = 'test-tehran-1' and r.scope = 'pharmacy' and r.code = 'owner' and r.pharmacy_id is null;

-- T70-T72 as anon
set role anon;
do $$
declare n int; t int;
begin
  -- T70: seeded section collection = same products as the section filter
  select count(*) into n from public.shop_search(p_collection => (select id from public.collections where slug = 'supplements' and pharmacy_id is null), p_limit => 200);
  select count(*) into t from public.shop_search(p_filters => '{"section":["مکمل"]}', p_limit => 200);
  if n = 0 or n <> t then raise exception 'TEST FAIL T70: supplements % vs section %', n, t; end if;
  raise notice 'PASS T70 section collection matches its rule';

  -- T71: drafts are invisible to the public, even through search
  select count(*) into n from public.collections where status = 'draft';
  if n <> 0 then raise exception 'TEST FAIL T71: anon sees drafts'; end if;
  raise notice 'PASS T71 drafts hidden';

  -- T72: anon cannot create collections
  begin
    insert into public.collections (slug) values ('hack');
    raise exception 'TEST FAIL T72: anon inserted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T72 anon cannot write';
end $$;
reset role;

-- T73-T75 as a Dorva content moderator
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000008', false) \gset ignore_
set role authenticated;
do $$
declare c uuid; n int; ids uuid[];
begin
  -- T73: OR across groups, include adds, exclude removes
  insert into public.collections (slug, title, rules, status)
  values ('t-mix', '{"fa":"آزمون"}', '[{"brand":["SAMPLE-BR-A"]},{"brand":["SAMPLE-BR-B"],"country":["DE"]}]', 'draft')
  returning id into c;
  select count(*) into n from public.shop_search(p_collection => c, p_limit => 200);
  if n <> 4 then raise exception 'TEST FAIL T73: A or (B and DE) expected 4, got %', n; end if;
  select array_agg(product_id) into ids from public.shop_search(p_collection => c, p_limit => 200);
  update public.collections set exclude_ids = array[ids[1]], include_ids = array[md5('dorva-sample-product-9')::uuid] where id = c;
  select count(*) into n from public.shop_search(p_collection => c, p_limit => 200);
  if n <> 4 then raise exception 'TEST FAIL T73: after +1 -1 expected 4, got %', n; end if;
  if exists (select 1 from public.shop_search(p_collection => c, p_limit => 200) where product_id = ids[1]) then
    raise exception 'TEST FAIL T73: excluded product still listed'; end if;
  raise notice 'PASS T73 rule groups OR, include and exclude work';

  -- T74: the moderator sees its own draft, options are limited to the collection
  select count(*) into n from public.shop_filter_options(p_scope => 'all', p_collection => c) where facet_key = 'brand';
  if n < 1 then raise exception 'TEST FAIL T74: no brand options in collection'; end if;
  raise notice 'PASS T74 admin previews drafts with options';

  -- T75: deals row only lists discounted offers
  if exists (select 1 from public.shop_search(p_collection => (select id from public.collections where slug = 'deals' and pharmacy_id is null), p_limit => 200)
             where coalesce(max_discount, 0) <= 0) then
    raise exception 'TEST FAIL T75: undiscounted product in deals'; end if;
  raise notice 'PASS T75 deals show only discounted items';
end $$;
reset role;

-- T76-T78 as a pharmacy owner (moderation is tested in 110; here the policy is free)
update public.settings set value = '"free"' where key = 'moderation.collection' and scope = 'platform';
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000009', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid; other uuid; c uuid; src uuid; n int; r jsonb;
begin
  select id into ph from public.pharmacies where slug = 'test-tehran-1';
  select id into other from public.pharmacies where slug <> 'test-tehran-1' order by slug limit 1;
  select id into src from public.collections where slug = 'supplements' and pharmacy_id is null;

  -- T76: copy follows Dorva rules, ignores own rules, lists only own stock
  insert into public.collections (pharmacy_id, slug, title, source_id, rules, status)
  values (ph, 'my-supps', '{"fa":"مکمل‌های ما"}', src, '[{"type":["rx"]}]', 'published') returning id into c;
  select rules into r from public.collections where id = c;
  if r <> '[]'::jsonb then raise exception 'TEST FAIL T76: pharmacy wrote rules %', r; end if;
  select count(*) into n from public.shop_search(p_collection => c, p_limit => 200) s
   where not exists (select 1 from public.stock_items si where si.pharmacy_id = ph and si.product_id = s.product_id and si.quantity > 0);
  if n <> 0 then raise exception 'TEST FAIL T76: % items not in own stock', n; end if;
  if exists (select 1 from public.shop_search(p_collection => c, p_limit => 200) where dispensing_class <> 'supplement') then
    raise exception 'TEST FAIL T76: copy does not follow the Dorva rule'; end if;
  raise notice 'PASS T76 pharmacy copy follows Dorva rules within own stock';

  -- T77: cannot write to another pharmacy or to Dorva collections
  begin
    insert into public.collections (pharmacy_id, slug) values (other, 'x-other');
    raise exception 'TEST FAIL T77: wrote another pharmacy';
  exception when insufficient_privilege then null;
  end;
  update public.collections set title = '{"fa":"x"}' where id = src;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAIL T77: owner edited a Dorva collection'; end if;
  raise notice 'PASS T77 pharmacy writes only its own collections';

  -- T78: featured rows appear on the pharmacy page
  update public.collections set featured = true where id = c;
  select count(distinct collection_id) into n from public.featured_collections(p_pharmacy => ph);
  if n <> 1 then raise exception 'TEST FAIL T78: featured rows %', n; end if;
  raise notice 'PASS T78 featured pharmacy rows';
  if not public.can_manage_collections(ph) or public.can_manage_collections(other) or public.can_manage_collections(null) then
    raise exception 'TEST FAIL T79: permission check'; end if;
  raise notice 'PASS T79 permission check for edit controls';
end $$;
reset role;
update public.settings set value = '"approval"' where key = 'moderation.collection' and scope = 'platform';
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
\echo ALL COLLECTION TESTS PASSED

-- T80-T83: ordering policy, archive, preview, sizes
reset role;
do $$
declare a uuid; b text; n int; t int;
begin
  -- T80: customer choice wins over the Dorva policy; Dorva policy decides otherwise
  if app.resolve_sort(null, 'default', null) <> 'discount' then raise exception 'TEST FAIL T80: dorva default'; end if;
  if app.resolve_sort('cheapest', 'discount', null) <> 'price_asc' then raise exception 'TEST FAIL T80: customer wins'; end if;
  if app.resolve_sort(null, 'name', null) <> 'name' then raise exception 'TEST FAIL T80: collection override'; end if;
  update public.settings set value = '"stock_name"' where key = 'catalog.sort_policy' and scope = 'platform';
  if app.resolve_sort(null, 'default', null) <> 'name' then raise exception 'TEST FAIL T80: policy change'; end if;
  update public.settings set value = '"stock_discount"' where key = 'catalog.sort_policy' and scope = 'platform';
  update public.pharmacies set sort_policy = 'stock_price' where slug = 'test-tehran-1';
  if app.resolve_sort(null, 'default', (select id from public.pharmacies where slug = 'test-tehran-1')) <> 'price_asc' then
    raise exception 'TEST FAIL T80: pharmacy policy'; end if;
  update public.pharmacies set sort_policy = null where slug = 'test-tehran-1';
  raise notice 'PASS T80 sort layers: customer > collection > pharmacy > Dorva';
end $$;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000008', false) \gset ignore_
set role authenticated;
do $$
declare c uuid; n int; t int;
begin
  -- T81: archived collections disappear from the shop, managers still see them
  select id into c from public.collections where slug = 't-mix' and pharmacy_id is null;
  update public.collections set status = 'archived' where id = c;
  select count(*) into n from public.collections where id = c;
  if n <> 1 then raise exception 'TEST FAIL T81: manager lost archived row'; end if;
  -- T82: live preview of unsaved rules
  select total into t from public.collection_preview('[{"brand":["SAMPLE-BR-A"]}]') limit 1;
  if t is distinct from 2 then raise exception 'TEST FAIL T82: preview brand A %', t; end if;
  -- T83: sizes
  select products into n from public.collection_sizes() where collection_id = (select id from public.collections where slug='supplements' and pharmacy_id is null);
  select count(*) into t from public.shop_search(p_filters => '{"section":["مکمل"]}', p_limit => 200);
  if n <> t then raise exception 'TEST FAIL T83: size % vs %', n, t; end if;
  raise notice 'PASS T81-T83 archive, live preview, sizes';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$
declare n int;
begin
  select count(*) into n from public.collections where slug = 't-mix';
  if n <> 0 then raise exception 'TEST FAIL T81: anon sees archived'; end if;
  select count(*) into n from public.collection_preview('[{"brand":["SAMPLE-BR-A"]}]');
  if n <> 0 then raise exception 'TEST FAIL T82: anon used preview'; end if;
  raise notice 'PASS T81/T82 archived hidden, preview protected';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_

-- T84-T87: popularity signals, tabs, row order
set role anon;
do $$
declare p1 uuid; p2 uuid; top uuid;
begin
  -- T84: anonymous view tracking counts per day; most_viewed sort uses it
  select product_id into p1 from public.shop_search(p_limit => 1, p_offset => 5);
  select product_id into p2 from public.shop_search(p_limit => 1, p_offset => 6);
  perform public.track_view(p1); perform public.track_view(p1); perform public.track_view(p2);
  select product_id into top from public.shop_search(p_sort => 'most_viewed', p_limit => 1);
  if top <> p1 then raise exception 'TEST FAIL T84: most viewed first'; end if;
  if exists (select 1 from public.product_views) then raise exception 'TEST FAIL T84: anon reads raw views'; end if;
  raise notice 'PASS T84 view tracking and most-viewed sort';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000008', false) \gset ignore_
set role authenticated;
do $$
declare p uuid; top uuid; n int; ids uuid[];
begin
  -- T85: favorites are private to their owner and drive the popular sort
  select product_id into p from public.shop_search(p_limit => 1, p_offset => 9);
  insert into public.favorites (user_id, product_id) values (auth.uid(), p);
  select product_id into top from public.shop_search(p_sort => 'popular', p_limit => 1);
  if top <> p then raise exception 'TEST FAIL T85: popular first'; end if;
  begin
    insert into public.favorites (user_id, product_id) values ('dddddddd-0000-0000-0000-000000000001', p);
    raise exception 'TEST FAIL T85: wrote someone else''s favorite';
  exception when insufficient_privilege or check_violation or foreign_key_violation then null;
  end;
  -- T86: move a row up renumbers cleanly and swaps neighbours
  select array_agg(id order by sort, slug) into ids from public.collections where pharmacy_id is null and status <> 'archived';
  perform public.move_collection(ids[2], -1);
  select count(*) into n from public.collections where pharmacy_id is null and status <> 'archived' and sort % 10 <> 0;
  if n <> 0 then raise exception 'TEST FAIL T86: not renumbered'; end if;
  if (select id from public.collections where pharmacy_id is null and status <> 'archived' order by sort, slug limit 1) <> ids[2] then
    raise exception 'TEST FAIL T86: not moved up'; end if;
  perform public.move_collection(ids[2], 1);
  raise notice 'PASS T85-T86 favorites, popular sort, row order';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$
declare n int;
begin
  -- T87: tabs are public, one default at most; anon cannot reorder
  select count(*) into n from public.product_tabs() where is_default;
  if n > 1 then raise exception 'TEST FAIL T87: several defaults'; end if;
  begin
    perform public.move_collection((select id from public.collections where status = 'published' limit 1), 1);
    raise exception 'TEST FAIL T87: anon reordered';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T87 tabs public, reorder protected';
end $$;
reset role;

-- T88-T89: product page offers and similar products
set role anon;
do $$
declare p uuid; r record; n int; g int;
begin
  select product_id into p from public.shop_search(p_limit => 1);
  -- T88: offers carry a delivery estimate; distance only with a location
  select * into r from public.product_offers_v2(p) limit 1;
  if r.delivery is not null or r.distance_km is not null then raise exception 'TEST FAIL T88: % %', r.delivery, r.distance_km; end if;
  select * into r from public.product_offers_v2(p, null, 35.7, 51.4) limit 1;
  if r.distance_km is null or r.delivery not in ('today', 'tomorrow', 'out') then raise exception 'TEST FAIL T88: no distance with location'; end if;
  -- T89: similar products never include the product itself
  select count(*) into n from public.product_similar(p) s where s.product_id = p;
  select count(*) into g from public.product_similar(p);
  if n <> 0 then raise exception 'TEST FAIL T89: self in similar'; end if;
  raise notice 'PASS T88-T89 offers with delivery estimate, similar products (% rows)', g;
end $$;
reset role;
