-- T225-T230: notifications reach the right people; in-app list; mobile; push subscription; Dorva admin
reset role;
do $$
declare pa uuid := (select id from public.pharmacies where slug = 'test-owner-a'); n int;
begin
  -- pharmacy event: owner A holds order.read through the owner role
  n := app.notify('ph.order_new', pa, null, '{"fa":"سفارش آزمایشی"}', '{}', '/fa/pharmacy/orders', 'test-1');
  if n < 1 then raise exception 'TEST FAIL T225 no pharmacy recipient'; end if;
  if app.notify('ph.order_new', pa, null, '{"fa":"تکراری"}', '{}', null, 'test-1') <> 0 then raise exception 'TEST FAIL T225 dedupe'; end if;
  if exists (select 1 from public.notifications where event = 'ph.order_new' and user_id = 'bbbbbbbb-0000-0000-0000-000000000002') then
    raise exception 'TEST FAIL T225 other pharmacy notified';
  end if;
  -- platform event reaches Dorva staff only
  n := app.notify('dv.price_request', null, null, '{"fa":"قیمت"}', '{}');
  if not exists (select 1 from public.notifications where event = 'dv.price_request' and user_id = 'cccccccc-0000-0000-0000-000000000003') then
    raise exception 'TEST FAIL T226 Dorva not notified';
  end if;
  if exists (select 1 from public.notifications where event = 'dv.price_request' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'TEST FAIL T226 pharmacy got a Dorva event';
  end if;
  -- customer SMS is queued by default, a pharmacy order alert is not
  n := app.notify('cu.order_shipped', null, 'bbbbbbbb-0000-0000-0000-000000000002', '{"fa":"ارسال شد"}', '{}', null, null, '09120000000');
  if (select sms_status from public.notifications where event = 'cu.order_shipped' order by id desc limit 1) <> 'queued' then raise exception 'TEST FAIL T227 sms'; end if;
  if (select sms_status from public.notifications where dedupe = 'test-1' limit 1) <> 'none' then raise exception 'TEST FAIL T227 no sms for order alert'; end if;
  -- an inactive event sends nothing; a broken call never raises
  update public.notify_events set active = false where code = 'ph.stock_low';
  if app.notify('ph.stock_low', pa, null, '{"fa":"x"}', '{}') <> 0 then raise exception 'TEST FAIL T227 inactive'; end if;
  update public.notify_events set active = true where code = 'ph.stock_low';
  if app.notify('nope', pa, null, '{}', '{}') <> 0 then raise exception 'TEST FAIL T227 unknown'; end if;
  raise notice 'PASS T225-T227 recipients by permission, dedupe, SMS per event';
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare r jsonb; n int;
begin
  r := public.my_notifications(0);
  if (r->>'unread')::int < 1 or (r->'items'->0->>'alarm')::boolean is not true then raise exception 'TEST FAIL T228 list %', r; end if;
  n := public.notifications_read(null);
  if n < 1 or (public.my_notifications(0)->>'unread')::int <> 0 then raise exception 'TEST FAIL T228 read % %', n, public.my_notifications(0)->>'unread'; end if;
  if public.set_my_mobile('۰۹۱۲ ۳۴۵ ۶۷۸۹') <> 'ok' or public.my_mobile() <> '09123456789' then raise exception 'TEST FAIL T229 mobile'; end if;
  if public.set_my_mobile('12345') <> 'format' then raise exception 'TEST FAIL T229 format'; end if;
  if public.push_subscribe('https://push.example/abc', repeat('B', 87), repeat('a', 22), 'test') <> 'ok' then raise exception 'TEST FAIL T229 push'; end if;
  begin perform public.notify_claim(10); raise exception 'TEST FAIL T230 claim open';
  exception when insufficient_privilege then null; end;
  begin perform public.notify_admin(); raise exception 'TEST FAIL T230 admin open';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T228-T229 in-app list, read, mobile, push subscription';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
-- the mobile is used for the next SMS, and the subscriber gets push queued
do $$
begin
  perform app.notify('ph.registration', (select id from public.pharmacies where slug = 'test-owner-a'), null, '{"fa":"نتیجه"}', '{}');
  if not exists (select 1 from public.notifications where event = 'ph.registration' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                 and phone = '09123456789' and push_status = 'queued' and sms_status = 'queued') then
    raise exception 'TEST FAIL T230 channels % % %', (select mobile from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), (select count(*) from public.push_subscriptions), (select jsonb_agg(jsonb_build_object('u',user_id,'ph',phone,'p',push_status,'s',sms_status)) from public.notifications where event = 'ph.registration');
  end if;
  raise notice 'PASS T230 phone and push queued for the officer alert';
end $$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
begin
  if public.notify_event_save('ph.order_new', true, false, true) <> 'ok' then raise exception 'TEST FAIL T230 save'; end if;
  if jsonb_array_length(public.notify_admin()->'events') < 20 then raise exception 'TEST FAIL T230 admin'; end if;
  if public.notify_test() <> 1 then raise exception 'TEST FAIL T230 test'; end if;
  raise notice 'PASS T230 Dorva edits events and sends a test';
end $$;
reset role;
update public.notify_events set sms = false, alarm = true where code = 'ph.order_new';
