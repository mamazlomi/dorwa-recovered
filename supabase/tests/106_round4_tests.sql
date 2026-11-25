-- T190-T194: category translations, new theme keys, page builder options and tabs
do $$
begin
  if (select count(*) from public.category_names) < 140 then raise exception 'TEST FAIL T190 category names seeded'; end if;
  if (select name_i18n->>'en' from public.category_names where name_fa = 'آمینو') <> 'Amino acids' then raise exception 'TEST FAIL T190 en name'; end if;
  raise notice 'PASS T190 category names';
end $$;

do $$
begin
  if app.theme_validate('{"extras":{"toTop":"ring","toTopSide":"center","toBottom":true,"progress":true},"footer":{"divider":"bump"},"app":{"bottomNav":"mobile","quickGrid":"app","install":true}}') <> 'ok'
     then raise exception 'TEST FAIL T191 new theme keys'; end if;
  if app.theme_validate('{"extras":{"toTop":"rocket"}}') = 'ok' then raise exception 'TEST FAIL T191 bad value accepted'; end if;
  raise notice 'PASS T191 theme keys';
end $$;

do $$
declare col uuid := (select id from public.collections where pharmacy_id is null and status = 'published' limit 1);
        rx uuid := (select id from public.catalog_products where dispensing_class = 'rx' limit 1);
begin
  -- devices, band and divider on any block
  if app.page_validate(null, '[{"id":"t1","type":"text","title":{"fa":"سلام"},"devices":["mobile"],"band":"soft","divider":"wave"}]') <> 'ok'
     then raise exception 'TEST FAIL T192 devices/band ok'; end if;
  if app.page_validate(null, '[{"id":"t1","type":"text","title":{"fa":"x"},"devices":["watch"]}]') <> 'block'
     or app.page_validate(null, '[{"id":"t1","type":"text","title":{"fa":"x"},"devices":["mobile","mobile"]}]') <> 'block'
     or app.page_validate(null, '[{"id":"t1","type":"text","title":{"fa":"x"},"devices":[]}]') <> 'block'
     or app.page_validate(null, '[{"id":"t1","type":"text","title":{"fa":"x"},"band":"neon"}]') <> 'block'
     then raise exception 'TEST FAIL T192 bad options accepted'; end if;
  -- banner shapes and modes
  if app.page_validate(null, '[{"id":"b1","type":"banner","height":"xl","shape":"wave","display":"bento","slides":[{"tone":"brand","title":{"fa":"x"}}]}]') <> 'ok'
     or app.page_validate(null, '[{"id":"b1","type":"banner","shape":"star","slides":[{"tone":"brand","title":{"fa":"x"}}]}]') <> 'block'
     then raise exception 'TEST FAIL T193 banner options'; end if;
  -- tiles
  if app.page_validate(null, '[{"id":"c1","type":"categories","display":"circles","size":"l","items":[{"label":{"fa":"x"}}]}]') <> 'ok'
     or app.page_validate(null, '[{"id":"c1","type":"categories","display":"strip","items":[{"label":{"fa":"x"}}]}]') <> 'block'
     or app.page_validate(null, '[{"id":"f1","type":"features","display":"icons","items":[{"label":{"fa":"x"}}]}]') <> 'ok'
     then raise exception 'TEST FAIL T193 tile options'; end if;
  -- tabs: 2-5 tabs, each a valid source, never prescription items
  if app.page_validate(null, jsonb_build_array(jsonb_build_object('id', 'tb1', 'type', 'tabs', 'tabs', jsonb_build_array(
       jsonb_build_object('title', jsonb_build_object('fa', 'پرفروش'), 'source', 'bestselling'),
       jsonb_build_object('title', jsonb_build_object('fa', 'تخفیف'), 'source', 'discount'))))) <> 'ok'
     then raise exception 'TEST FAIL T194 tabs ok'; end if;
  if app.page_validate(null, '[{"id":"tb1","type":"tabs","tabs":[{"title":{"fa":"x"},"source":"newest"}]}]') <> 'block'
     then raise exception 'TEST FAIL T194 one tab accepted'; end if;
  if rx is not null and app.page_validate(null, jsonb_build_array(jsonb_build_object('id', 'tb1', 'type', 'tabs', 'tabs', jsonb_build_array(
       jsonb_build_object('title', jsonb_build_object('fa', 'a'), 'source', 'newest'),
       jsonb_build_object('title', jsonb_build_object('fa', 'b'), 'source', 'manual', 'products', jsonb_build_array(rx)))))) <> 'rx'
     then raise exception 'TEST FAIL T194 rx in a tab'; end if;
  if col is not null and app.page_validate(null, jsonb_build_array(jsonb_build_object('id', 'p1', 'type', 'products', 'source', 'collection',
       'collection', col, 'display', 'bento'))) <> 'ok' then raise exception 'TEST FAIL T194 products bento'; end if;
  raise notice 'PASS T192-T194 page builder options';
end $$;
