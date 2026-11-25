-- T140-T146: page builder (drafts, validation, Dorva review, no prescription items)
select id as ph_a from public.pharmacies where slug = 'test-owner-a' \gset
create temp table t_p as select :'ph_a'::uuid ph,
  (select id from public.catalog_products where dispensing_class = 'rx' limit 1) rx,
  (select s.product_id from public.stock_items s join public.catalog_products p on p.id = s.product_id
    where s.pharmacy_id = :'ph_a'::uuid and p.dispensing_class <> 'rx' and s.quantity > 0 limit 1) ok_prod;
grant select on t_p to anon, authenticated;

-- T140: a customer cannot edit any page
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  begin perform public.page_editor(null); raise exception 'TEST FAIL T140: home';
  exception when insufficient_privilege then null; end;
  begin perform public.page_save((select ph from t_p), '[]'); raise exception 'TEST FAIL T140: pharmacy';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T140 customers cannot edit pages';
end $$;
reset role;

-- T141-T142: the owner of test-owner-a edits their page
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare c record; f text; st text;
begin
  select * into c from t_p;
  f := c.ph::text;
  -- T141: validation
  st := public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'banner',
          'slides', jsonb_build_array(jsonb_build_object('image', 'home/x.webp')))));
  if st <> 'image' then raise exception 'TEST FAIL T141 image in another page''s folder: %', st; end if;
  st := public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'banner',
          'slides', jsonb_build_array(jsonb_build_object('image', f || '/x.webp', 'link', jsonb_build_object('kind', 'path', 'value', '//evil.com'))))));
  if st <> 'link' then raise exception 'TEST FAIL T141 external link: %', st; end if;
  st := public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'banner',
          'slides', jsonb_build_array(jsonb_build_object('image', f || '/x.webp', 'link', jsonb_build_object('kind', 'product', 'value', c.rx))))));
  if c.rx is not null and st <> 'rx' then raise exception 'TEST FAIL T141 banner to rx: %', st; end if;
  st := public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b2', 'type', 'products', 'source', 'manual',
          'products', jsonb_build_array(c.rx, c.ok_prod))));
  if c.rx is not null and st <> 'rx' then raise exception 'TEST FAIL T141 rx in a row: %', st; end if;
  st := public.page_save(c.ph, (select jsonb_agg(jsonb_build_object('id', 'tx' || g, 'type', 'text', 'body', jsonb_build_object('fa', 'سلام')))
                                from generate_series(1, 16) g));
  if st <> 'too_many' then raise exception 'TEST FAIL T141 block count: %', st; end if;
  st := public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b3', 'type', 'video')));
  if st <> 'block_type' then raise exception 'TEST FAIL T141 unknown type: %', st; end if;
  raise notice 'PASS T141 page validation (folder, external link, rx, count, type)';

  -- T142: a valid page goes to Dorva review, not live
  st := public.page_save(c.ph, jsonb_build_array(
          jsonb_build_object('id', 'b1', 'type', 'banner', 'slides', jsonb_build_array(
            jsonb_build_object('image', f || '/banner-1.webp', 'link', jsonb_build_object('kind', 'search', 'value', 'ویتامین')))),
          jsonb_build_object('id', 'b2', 'type', 'products', 'source', 'manual', 'products', jsonb_build_array(c.ok_prod),
                             'title', jsonb_build_object('fa', 'پیشنهاد ما')),
          jsonb_build_object('id', 'b3', 'type', 'text', 'style', 'info', 'body', jsonb_build_object('fa', 'ساعت کاری ۸ تا ۲۲'))));
  if st <> 'ok' then raise exception 'TEST FAIL T142 save: %', st; end if;
  st := public.page_publish(c.ph);
  if st <> 'pending' or public.page_public(c.ph) is not null then raise exception 'TEST FAIL T142 publish: %', st; end if;
  if (public.page_editor(c.ph)->>'status') <> 'pending' then raise exception 'TEST FAIL T142 status'; end if;
  begin perform public.page_review(c.ph, 'approve'); raise exception 'TEST FAIL T142 owner approved own page';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T142 pharmacy page waits for Dorva review';
end $$;
reset role;

-- T143: Dorva approves; then a change is rejected with a note
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$
declare c record;
begin
  select * into c from t_p;
  if not exists (select 1 from public.page_queue() q where q.pharmacy_id = c.ph and q.status = 'pending') then
    raise exception 'TEST FAIL T143 queue';
  end if;
  if public.page_review(c.ph, 'approve') <> 'ok' or jsonb_array_length(public.page_public(c.ph)) <> 3 then
    raise exception 'TEST FAIL T143 approve';
  end if;
  raise notice 'PASS T143 approved page goes live';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare c record; begin
  select * into c from t_p;
  perform public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b3', 'type', 'text', 'body', jsonb_build_object('fa', 'بهترین داروخانه شهر'))));
  perform public.page_publish(c.ph);
  if jsonb_array_length(public.page_public(c.ph)) <> 3 then raise exception 'TEST FAIL T143 live page changed before review'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$ declare c record; begin
  select * into c from t_p;
  if public.page_review(c.ph, 'reject', 'ادعای تبلیغاتی مجاز نیست') <> 'ok' then raise exception 'TEST FAIL T143 reject'; end if;
  raise notice 'PASS T143b rejected change keeps the live page and returns a note';
end $$;
reset role;

-- T144: Dorva turns off banners for pharmacies
update public.settings set value = 'false' where key = 'pages.ph_banner' and scope = 'platform';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare c record; st text; begin
  select * into c from t_p;
  if (public.page_editor(c.ph)->>'review_note') is null then raise exception 'TEST FAIL T144 note not shown'; end if;
  st := public.page_save(c.ph, jsonb_build_array(jsonb_build_object('id', 'b1', 'type', 'banner', 'slides',
          jsonb_build_array(jsonb_build_object('image', c.ph::text || '/a.webp')))));
  if st <> 'block_type' then raise exception 'TEST FAIL T144: %', st; end if;
  if (public.page_editor(c.ph)->'allowed') ? 'banner' then raise exception 'TEST FAIL T144 editor still offers banners'; end if;
  raise notice 'PASS T144 block types follow Dorva settings';
end $$;
reset role;
update public.settings set value = 'true' where key = 'pages.ph_banner' and scope = 'platform';

-- T145: product rows never show prescription items
set role anon;
do $$ declare c record; n int; begin
  select * into c from t_p;
  if c.rx is not null and exists (select 1 from public.page_products('manual', null, array[c.rx, c.ok_prod], null, null, 12) x
                                  where x.dispensing_class = 'rx') then
    raise exception 'TEST FAIL T145 manual';
  end if;
  if not exists (select 1 from public.page_products('manual', null, array[c.ok_prod], c.ph, null, 12)) then
    raise exception 'TEST FAIL T145 chosen product missing';
  end if;
  if exists (select 1 from public.page_products('bestselling', null, null, null, null, 24) x where x.dispensing_class = 'rx')
     or exists (select 1 from public.page_products('discount', null, null, null, null, 24) x where coalesce(x.max_discount, 0) = 0) then
    raise exception 'TEST FAIL T145 automatic rows';
  end if;
  raise notice 'PASS T145 rows exclude prescription items; discount row only discounted';
end $$;
reset role;

-- T146: Dorva's home page publishes directly
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$ begin
  if public.page_save(null, '[{"id":"h1","type":"products","source":"bestselling","limit":8,"title":{"fa":"پرفروش‌ها"}}]') <> 'ok'
     or public.page_publish(null) <> 'published' then
    raise exception 'TEST FAIL T146';
  end if;
end $$;
-- page_public is STABLE: check it in a new statement so it sees the publish
do $$ begin
  if jsonb_array_length(public.page_public(null)) <> 1 then raise exception 'TEST FAIL T146 live'; end if;
  raise notice 'PASS T146 Dorva home page publishes directly';
end $$;
reset role;
