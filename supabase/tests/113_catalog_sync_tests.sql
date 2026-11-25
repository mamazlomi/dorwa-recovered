-- T231-T236: catalog API sync — key in Vault, mapping, upsert by id, withdrawals, single product, access
reset role;

-- T231: only Dorva settings managers set the key; nobody reads it back; format checked
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
begin
  begin perform public.catalog_key_set('pk_live_0123456789abcdef'); raise exception 'TEST FAIL T231 pharmacy set key';
  exception when insufficient_privilege then null; end;
  begin perform public.catalog_sync_admin(); raise exception 'TEST FAIL T231 pharmacy admin view';
  exception when insufficient_privilege then null; end;
  begin perform public.catalog_sync_begin(); raise exception 'TEST FAIL T231 begin open';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T231a pharmacies cannot touch the catalog key or sync';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare a jsonb;
begin
  if public.catalog_sync_request('incremental') <> 'no_key' then raise exception 'TEST FAIL T231 run without key'; end if;
  if public.catalog_key_set('secret-without-prefix') <> 'format' then raise exception 'TEST FAIL T231 format'; end if;
  if public.catalog_key_set('pk_live_0123456789abcdef0123') <> 'ok' then raise exception 'TEST FAIL T231 set'; end if;
  if public.catalog_key_set('pk_live_aaaaaaaaaaaaaaaaaaaa') <> 'ok' then raise exception 'TEST FAIL T231 replace'; end if;
  a := public.catalog_sync_admin();
  if not (a->>'has_key')::boolean or a::text like '%aaaaaaaaaaaaaaaaaaaa%' then raise exception 'TEST FAIL T231 key exposed %', a->>'key_hint'; end if;
  begin perform 1 from vault.secrets; raise exception 'TEST FAIL T231 vault readable';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T231 key stored in Vault, write-only, format checked';
end $$;
reset role;

-- T232-T233: a full load maps the API shape; absent fields stay absent; second run is "unchanged"
set role service_role;
do $$
declare b jsonb; r jsonb; p record; run bigint;
  item1 jsonb := '{"id":"11111111-aaaa-4000-8000-000000000001","internal_code":"SUP-1","slug":"iron-plus","class":"supplement",
    "name":{"fa":"آهن پلاس","en":"Iron Plus"},"brand":{"id":"t1","fa":"برند آزمون","en":"Test Brand","code":"BR-T1"},
    "codes":{"irc":["IRC-1"],"gtin":["6260000000011"]},
    "components":[{"ingredient":{"fa":"آهن","en":"Iron"},"amount":30,"primary":true},{"ingredient":{"fa":"ویتامین ث","en":"Vitamin C"},"amount":100}],
    "facets":{"import_subcategory":[{"fa":"آهن"}],"ingredient":[{"fa":"آهن","en":"Iron","code":"ING-T1"}]},
    "texts":{"short_description":"مکمل آهن"},"images":[{"url":"https://x.test/a.jpg","primary":true}],
    "completeness":{"complete":false,"missing":["IMAGE_MISSING","ERX_MISSING"]},"changed_at":"2026-11-16T10:00:00Z"}';
  item2 jsonb := '{"id":"11111111-aaaa-4000-8000-000000000002","internal_code":"SUP-2","name":{"fa":"زینک آزمون"},
    "completeness":{"complete":true},"changed_at":"2026-11-16T10:00:00Z"}';
begin
  b := public.catalog_sync_begin();
  if b->>'mode' <> 'full' or b->>'key' is null or b->>'base' not like 'https://%' then raise exception 'TEST FAIL T232 begin %', b - 'key'; end if;
  run := (b->>'run')::bigint;
  if (public.catalog_sync_begin()->>'busy')::boolean is not true then raise exception 'TEST FAIL T232 second run not blocked'; end if;
  r := public.catalog_sync_ingest(run, jsonb_build_array(item1, item2, '{"id":"bad"}'::jsonb, '{"id":"11111111-aaaa-4000-8000-000000000003"}'::jsonb), 'cur1', '2026-11-16T10:05:00Z');
  if (r->>'new')::int <> 2 or (r->>'skipped')::int <> 2 then raise exception 'TEST FAIL T232 ingest %', r; end if;
  perform public.catalog_sync_finish(run, true, true, '2026-11-16T10:06:00Z');
  select * into p from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000001';
  if p.source <> 'api' or p.irc <> 'IRC-1' or p.gtin <> '6260000000011' or p.internal_code <> 'SUP-1' or p.image_url <> 'https://x.test/a.jpg'
     or p.dispensing_class <> 'supplement' or not p.requires_tech_approval or p.category_path <> array['مکمل', 'آهن']
     or p.generic_name <> 'Iron' or p.complete or p.missing <> array['IMAGE_MISSING', 'ERX_MISSING']
     or p.facets->'brand' <> '["BR-T1"]' or p.name_i18n->>'en' <> 'Iron Plus' then
    raise exception 'TEST FAIL T232 mapping % % % %', p.category_path, p.generic_name, p.facets, p.missing;
  end if;
  if (select name_fa from public.catalog_facet_values where facet_key = 'brand' and value_code = 'BR-T1') <> 'برند آزمون' then raise exception 'TEST FAIL T232 facet label'; end if;
  select * into p from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000002';
  if p.name_en is not null or p.image_url is not null or p.irc is not null or p.detail ? 'texts' or p.generic_name is not null then
    raise exception 'TEST FAIL T233 absent fields filled';
  end if;
  if (select last_server_time from public.catalog_sync_state) <> '2026-11-16T10:05:00Z' then raise exception 'TEST FAIL T232 server time of first page'; end if;
  raise notice 'PASS T232-T233 full load maps the API, absent stays absent, bad items skipped';
end $$;
reset role;

-- T234: incremental uses updated_since with overlap; older data never overwrites newer; withdrawn products go off on full load
update public.catalog_sync_state set last_ok_at = now() - interval '1 hour';
set role service_role;
do $$
declare b jsonb; r jsonb; run bigint;
begin
  b := public.catalog_sync_begin();
  if b->>'mode' <> 'incremental' or (b->>'since')::timestamptz <> '2026-11-16T10:00:00Z' then raise exception 'TEST FAIL T234 since %', b - 'key'; end if;
  run := (b->>'run')::bigint;
  r := public.catalog_sync_ingest(run, '[{"id":"11111111-aaaa-4000-8000-000000000002","name":{"fa":"زینک آزمون نو"},"changed_at":"2026-11-16T11:00:00Z"},
                                         {"id":"11111111-aaaa-4000-8000-000000000001","name":{"fa":"نسخه قدیمی"},"changed_at":"2026-11-16T09:00:00Z"}]');
  if (r->>'updated')::int <> 1 or (r->>'same')::int <> 1 then raise exception 'TEST FAIL T234 ingest %', r; end if;
  perform public.catalog_sync_finish(run, true, true, '2026-11-16T11:05:00Z');
  if (select name_fa from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000001') <> 'آهن پلاس' then raise exception 'TEST FAIL T234 older overwrote'; end if;
  if (select name_fa from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000002') <> 'زینک آزمون نو' then raise exception 'TEST FAIL T234 update'; end if;
  -- forced full: product 2 is no longer in the published list
  update public.catalog_sync_state set pending_mode = 'full';
  b := public.catalog_sync_begin(); run := (b->>'run')::bigint;
  perform public.catalog_sync_ingest(run, '[{"id":"11111111-aaaa-4000-8000-000000000001","internal_code":"SUP-1","name":{"fa":"آهن پلاس"},"changed_at":"2026-11-16T12:00:00Z"}]', null, '2026-11-16T12:01:00Z');
  -- ran out of time first: continues later from the cursor, nothing switched off yet
  perform public.catalog_sync_finish(run, true, false, null);
  if not (select is_active from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000002') then raise exception 'TEST FAIL T234 partial switched off'; end if;
  b := public.catalog_sync_begin();
  if (b->>'run')::bigint <> run or b->>'mode' <> 'full' then raise exception 'TEST FAIL T234 resume %', b - 'key'; end if;
  perform public.catalog_sync_finish(run, true, true, '2026-11-16T12:09:00Z');
  if (select is_active from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000002') then raise exception 'TEST FAIL T234 withdrawn kept'; end if;
  if not (select is_active from public.catalog_products where id = '11111111-aaaa-4000-8000-000000000001') then raise exception 'TEST FAIL T234 seen switched off'; end if;
  if exists (select 1 from public.catalog_products where source = 'seed' and not is_active) then raise exception 'TEST FAIL T234 seed touched'; end if;
  raise notice 'PASS T234 incremental with overlap, newer wins, resumable full load, withdrawals switched off';
end $$;
reset role;

-- T235: single product refresh; 404 switches off; errors are logged
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$ begin
  if public.catalog_sync_request('one', '') <> 'id' then raise exception 'TEST FAIL T235 empty id'; end if;
  if public.catalog_sync_request('one', 'SUP-1') <> 'ok' then raise exception 'TEST FAIL T235 request'; end if;
end $$;
reset role;
set role service_role;
do $$
declare b jsonb; run bigint;
begin
  b := public.catalog_sync_begin(); run := (b->>'run')::bigint;
  if b->>'mode' <> 'one' or b->>'id' <> 'SUP-1' then raise exception 'TEST FAIL T235 begin %', b - 'key'; end if;
  if public.catalog_sync_gone(run, 'SUP-1') <> 1 then raise exception 'TEST FAIL T235 gone'; end if;
  perform public.catalog_sync_finish(run, true, true, null);
  update public.catalog_sync_state set pending_mode = 'incremental';
  b := public.catalog_sync_begin(); run := (b->>'run')::bigint;
  perform public.catalog_sync_finish(run, false, false, null, 'HTTP 401 invalid_api_key');
  if (select last_error from public.catalog_sync_state) <> 'HTTP 401 invalid_api_key' or (select running_since from public.catalog_sync_state) is not null then
    raise exception 'TEST FAIL T235 error state';
  end if;
  raise notice 'PASS T235 single product refresh, 404 switches off, errors logged and lock released';
end $$;
reset role;

-- T236: admin view, incomplete list, seed switch (reversible)
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare a jsonb; n int;
begin
  a := public.catalog_sync_admin();
  if (a->'counts'->>'api_off')::int <> 2 or jsonb_array_length(a->'runs') < 4 then raise exception 'TEST FAIL T236 admin %', a->'counts'; end if;
  n := public.catalog_seed_active(false);
  if n < 1 or exists (select 1 from public.catalog_products where source = 'seed' and is_active) then raise exception 'TEST FAIL T236 seed off'; end if;
  if public.catalog_seed_active(true) <> n then raise exception 'TEST FAIL T236 seed back'; end if;
  if public.catalog_key_clear() <> 'ok' or (public.catalog_sync_admin()->>'has_key')::boolean then raise exception 'TEST FAIL T236 clear'; end if;
  raise notice 'PASS T236 admin status, seed products switch off and back, key removable';
end $$;
reset role;
