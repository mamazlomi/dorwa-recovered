-- T130-T135: dashboard metrics, behaviour events, saved layouts
select id as ph_a from public.pharmacies where slug = 'test-owner-a' \gset
create temp table t_a as select :'ph_a'::uuid ph,
  (select product_id from public.stock_items where pharmacy_id = :'ph_a'::uuid limit 1) prod;
grant select on t_a to anon, authenticated;

-- T130: behaviour events from anonymous visitors
set role anon;
do $$
declare c record;
begin
  select * into c from t_a;
  perform public.track_view(c.prod);
  perform public.track_event('search', null, '  Vitamin D  ', 0, null);
  perform public.track_event('search', null, '   ', 3, null);          -- empty query is ignored
  perform public.track_event('cart_add', c.prod);
  perform public.track_event('bogus', c.prod);                          -- unknown kind is ignored
  if exists (select 1 from public.activity_events) then raise exception 'TEST FAIL T130: events readable by anon'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.activity_events where kind = 'search' and query = 'vitamin d' and results = 0) <> 1
     or (select count(*) from public.activity_events where kind = 'search') <> 1
     or (select count(*) from public.activity_events where kind = 'view') < 1
     or (select count(*) from public.activity_events where kind = 'cart_add') <> 1 then
    raise exception 'TEST FAIL T130: %', (select jsonb_agg(e) from public.activity_events e);
  end if;
  raise notice 'PASS T130 views, searches and cart additions are logged anonymously';
end $$;

-- T131: a customer cannot read any dashboard
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  begin perform public.dash_metrics(null, 30); raise exception 'TEST FAIL T131: platform';
  exception when insufficient_privilege then null; end;
  begin perform public.dash_metrics((select ph from t_a), 30); raise exception 'TEST FAIL T131: pharmacy';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T131 customers cannot read dashboards';
end $$;
reset role;

-- T132: the Dorva dashboard sees orders, cancels, heat map and searches
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$
declare m jsonb := public.dash_metrics(null, 30);
begin
  if (m->'sales'->>'orders')::int < 1 or (m->'ops'->'cancelled'->>'customer')::int < 1
     or jsonb_array_length(m->'heat_orders') < 1 or jsonb_array_length(m->'series') <> 30
     or jsonb_array_length(m->'no_results') < 1 or m->'funnel'->>'cart_adds' is null then
    raise exception 'TEST FAIL T132: %', m;
  end if;
  if (m->'customers'->>'new')::int > (m->'customers'->>'buyers')::int
     or (m->'customers'->>'repeat')::int > (m->'customers'->>'buyers')::int then
    raise exception 'TEST FAIL T132: customers %', m->'customers';
  end if;
  raise notice 'PASS T132 platform dashboard metrics';
end $$;
reset role;

-- T133: a pharmacy owner sees their own pharmacy only, without Dorva-wide lists
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare m jsonb := public.dash_metrics((select ph from t_a), 7);
begin
  if m->'top_pharmacies' <> '[]'::jsonb or m->'searches' <> '[]'::jsonb or m->'cities' <> '[]'::jsonb
     or jsonb_array_length(m->'series') <> 7 or (m->'inventory'->>'lines')::int < 1 then
    raise exception 'TEST FAIL T133: %', m;
  end if;
  begin perform public.dash_metrics(null, 7); raise exception 'TEST FAIL T133: platform';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T133 pharmacy dashboard is scoped to the pharmacy';
end $$;

-- T134: layouts are private to their owner
insert into public.dashboard_layouts (user_id, scope, widgets) values (auth.uid(), 'test', '[{"id":"kpi"}]');
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  if exists (select 1 from public.dashboard_layouts) then raise exception 'TEST FAIL T134: sees others'' layout'; end if;
  begin
    insert into public.dashboard_layouts (user_id, scope) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x');
    raise exception 'TEST FAIL T134: wrote for someone else';
  exception when insufficient_privilege or check_violation then null; end;
  raise notice 'PASS T134 dashboard layouts are private';
end $$;
reset role;
