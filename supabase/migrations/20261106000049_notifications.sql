-- Notifications: one system for everyone (customers, pharmacy staff, Dorva staff).
--  * Channels: in-app (popup + alarm sound on the page; always), app/browser push
--    (always, for whoever enabled it on their device), SMS (per event, Dorva decides).
--  * Recipients come from permissions: an order alert reaches only the pharmacy
--    staff whose access includes orders; a price request only Dorva staff with
--    price policy access, and so on. The person who caused the event is skipped.
--  * Delivery of push and SMS is done by the Supabase Edge Function notify-dispatch
--    (called right away through pg_net and every minute by pg_cron as a retry).
--  * Notifications never break the action that caused them (errors are swallowed).

set search_path = public, extensions;

-- ---------------------------------------------------------------- catalogue of events
create table if not exists public.notify_events (
  code        text primary key check (code ~ '^[a-z_.]{3,60}$'),
  audience    text not null check (audience in ('pharmacy', 'platform', 'customer')),
  permission  text,
  label       jsonb not null,
  sms         boolean not null default false,
  alarm       boolean not null default false,   -- repeating alarm until acknowledged (else one chime)
  active      boolean not null default true,
  sort        int not null default 100
);
alter table public.notify_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notify_events' and policyname = 'read') then
    create policy read on public.notify_events for select using (true);
  end if;
end $$;
grant select on public.notify_events to anon, authenticated;

insert into public.notify_events (code, audience, permission, label, sms, alarm, sort) values
  ('ph.order_new', 'pharmacy', 'order.read', '{"fa":"سفارش جدید برای داروخانه","en":"New order for the pharmacy","ar":"طلب جديد للصيدلية"}', false, true, 10),
  ('ph.order_tech', 'pharmacy', 'order.tech_approve', '{"fa":"سفارش منتظر تأیید فنی (مهلت‌دار)","en":"Order awaiting technical approval (timed)","ar":"طلب بانتظار الموافقة الفنية"}', true, true, 20),
  ('ph.order_cancelled', 'pharmacy', 'order.read', '{"fa":"لغو سفارش","en":"Order cancelled","ar":"إلغاء الطلب"}', false, false, 30),
  ('ph.registration', 'pharmacy', 'pharmacy.update_profile', '{"fa":"نتیجه بررسی ثبت‌نام داروخانه","en":"Pharmacy registration result","ar":"نتيجة تسجيل الصيدلية"}', true, false, 40),
  ('ph.content_review', 'pharmacy', 'pharmacy.update_profile', '{"fa":"نتیجه بررسی محتوا (پروفایل، چیدمان، ظاهر، مجموعه)","en":"Content review result","ar":"نتيجة مراجعة المحتوى"}', false, false, 50),
  ('ph.price_review', 'pharmacy', 'inventory.manage', '{"fa":"نتیجه درخواست تغییر قیمت","en":"Price request result","ar":"نتيجة طلب تغيير السعر"}', false, false, 60),
  ('ph.stock_low', 'pharmacy', 'inventory.manage', '{"fa":"موجودی کم","en":"Low stock","ar":"مخزون منخفض"}', false, false, 70),
  ('ph.stock_expiring', 'pharmacy', 'inventory.manage', '{"fa":"تاریخ مصرف نزدیک","en":"Expiry date approaching","ar":"اقتراب انتهاء الصلاحية"}', false, false, 80),
  ('ph.finder_demand', 'pharmacy', 'pharmacy.finder.manage', '{"fa":"تقاضای داروی کمیاب در منطقه","en":"Demand for a scarce medicine nearby","ar":"طلب على دواء نادر"}', false, false, 90),
  ('dv.pharmacy_signup', 'platform', 'pharmacy.approve', '{"fa":"ثبت‌نام یا ارسال دوباره داروخانه","en":"Pharmacy sign-up or resubmission","ar":"تسجيل صيدلية"}', false, true, 110),
  ('dv.profile_change', 'platform', 'pharmacy.approve', '{"fa":"تغییر پروفایل داروخانه منتظر تأیید","en":"Pharmacy profile change awaiting approval","ar":"تغيير ملف بانتظار الموافقة"}', false, false, 120),
  ('dv.officer_change', 'platform', 'pharmacy.approve', '{"fa":"پرونده مسئول فنی منتظر تأیید","en":"Officer profile awaiting approval","ar":"ملف صيدلي بانتظار الموافقة"}', false, false, 130),
  ('dv.page_review', 'platform', 'pages.manage', '{"fa":"چیدمان صفحه داروخانه منتظر تأیید","en":"Pharmacy page awaiting approval","ar":"صفحة بانتظار الموافقة"}', false, false, 140),
  ('dv.look_review', 'platform', 'theme.manage', '{"fa":"ظاهر داروخانه منتظر تأیید","en":"Pharmacy look awaiting approval","ar":"مظهر بانتظار الموافقة"}', false, false, 150),
  ('dv.collection_review', 'platform', 'collections.manage', '{"fa":"مجموعه داروخانه منتظر تأیید","en":"Pharmacy collection awaiting approval","ar":"مجموعة بانتظار الموافقة"}', false, false, 160),
  ('dv.price_request', 'platform', 'policy.manage', '{"fa":"درخواست تغییر قیمت داروخانه","en":"Pharmacy price request","ar":"طلب تغيير سعر"}', false, false, 170),
  ('dv.code_suggest', 'platform', 'catalog.publish', '{"fa":"بارکد پیشنهادی داروخانه","en":"Barcode suggested by a pharmacy","ar":"باركود مقترح"}', false, false, 180),
  ('cu.order_paid', 'customer', null, '{"fa":"ثبت و پرداخت سفارش (مشتری)","en":"Order placed and paid (customer)","ar":"تم تسجيل الطلب"}', true, false, 210),
  ('cu.order_shipped', 'customer', null, '{"fa":"ارسال سفارش (مشتری)","en":"Order shipped (customer)","ar":"تم شحن الطلب"}', true, false, 220),
  ('cu.order_delivered', 'customer', null, '{"fa":"تحویل سفارش (مشتری)","en":"Order delivered (customer)","ar":"تم تسليم الطلب"}', false, false, 230),
  ('cu.order_cancelled', 'customer', null, '{"fa":"لغو بخشی از سفارش (مشتری)","en":"Part of the order cancelled (customer)","ar":"إلغاء جزء من الطلب"}', true, false, 240),
  ('cu.officer_invite', 'customer', null, '{"fa":"دعوت به عنوان مسئول فنی","en":"Invitation as technical officer","ar":"دعوة كصيدلي مسؤول"}', false, false, 250),
  ('cu.officer_review', 'customer', null, '{"fa":"نتیجه بررسی پرونده مسئول فنی","en":"Officer profile review result","ar":"نتيجة مراجعة الملف"}', false, false, 260)
on conflict (code) do nothing;

-- ---------------------------------------------------------------- storage
create table if not exists public.notifications (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  event       text not null references public.notify_events(code) on update cascade,
  pharmacy_id uuid references public.pharmacies(id) on delete cascade,
  title       jsonb not null,
  body        jsonb not null default '{}'::jsonb,
  link        text,
  phone       text,
  dedupe      text,
  alarm       boolean not null default false,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  push_status text not null default 'none' check (push_status in ('none', 'queued', 'sent', 'failed')),
  sms_status  text not null default 'none' check (sms_status in ('none', 'queued', 'sent', 'failed', 'no_phone', 'no_provider')),
  tries       int not null default 0
);
create index if not exists notifications_user on public.notifications (user_id, id desc);
create index if not exists notifications_queue on public.notifications (id) where push_status = 'queued' or sms_status = 'queued';
create unique index if not exists notifications_dedupe on public.notifications (user_id, dedupe) where dedupe is not null;
alter table public.notifications enable row level security;

create table if not exists public.push_subscriptions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 800),
  p256dh     text not null check (length(p256dh) between 60 and 120),
  auth       text not null check (length(auth) between 16 and 40),
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- VAPID keys, created by the dispatcher on first run (never readable by users)
create table if not exists public.notify_keys (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_jwk jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.notify_keys enable row level security;

-- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('notify.sms_enabled', 'notify', 'boolean', null, null, null, null,
   '{"fa":"ارسال پیامک","en":"Send SMS","ar":"إرسال الرسائل النصية"}',
   '{"fa":"کلید اصلی پیامک. خاموش = هیچ پیامکی نمی‌رود (اعلان درون سایت و روی گوشی همیشه هست). کلید سرویس پیامک در Supabase › Edge Functions › Secrets با نام SMS_API_KEY گذاشته می‌شود.","en":"Master SMS switch. In-app and push notifications are always on.","ar":"المفتاح الرئيسي للرسائل."}', 900),
  ('notify.sms_provider', 'notify', 'enum',
   '[{"value":"kavenegar","label":{"fa":"کاوه‌نگار","en":"Kavenegar","ar":"Kavenegar"}},{"value":"none","label":{"fa":"هیچ","en":"None","ar":"لا شيء"}}]'::jsonb,
   null, null, null, '{"fa":"سرویس پیامک","en":"SMS provider","ar":"مزود الرسائل"}', null, 901),
  ('notify.sms_sender', 'notify', 'text', null, null, null, null,
   '{"fa":"شماره خط ارسال پیامک","en":"SMS sender line","ar":"رقم المرسل"}', '{"fa":"مثلاً 2000660110 (از پنل سرویس پیامک).","en":"From the SMS panel.","ar":"من لوحة الرسائل."}', 902),
  ('notify.low_stock', 'notify', 'number', null, 0, 1000, '{"fa":"عدد","en":"units","ar":"وحدة"}',
   '{"fa":"آستانه هشدار موجودی کم","en":"Low-stock alert threshold","ar":"حد تنبيه المخزون"}', '{"fa":"وقتی موجودی کالایی به این عدد یا کمتر برسد. صفر = خاموش.","en":"0 = off.","ar":"0 = إيقاف."}', 903),
  ('notify.expiry_days', 'notify', 'number', null, 0, 365, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"هشدار تاریخ مصرف (روز قبل)","en":"Expiry alert (days before)","ar":"تنبيه الصلاحية (أيام)"}', '{"fa":"هر صبح بچ‌هایی که تا این تعداد روز منقضی می‌شوند اعلام می‌شوند. صفر = خاموش.","en":"0 = off.","ar":"0 = إيقاف."}', 904),
  ('notify.dispatch_url', 'notify', 'text', null, null, null, null,
   '{"fa":"نشانی ارسال‌کننده اعلان‌ها (فنی)","en":"Dispatcher URL (technical)","ar":"عنوان المرسل"}', '{"fa":"تغییر ندهید مگر به درخواست فنی.","en":"Do not change.","ar":"لا تغيّر."}', 999)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('notify.sms_enabled', 'platform', 'true', 'ارسال پیامک'),
  ('notify.sms_provider', 'platform', '"kavenegar"', 'سرویس پیامک'),
  ('notify.sms_sender', 'platform', '""', 'شماره خط'),
  ('notify.low_stock', 'platform', '3', 'آستانه موجودی کم'),
  ('notify.expiry_days', 'platform', '60', 'هشدار تاریخ مصرف'),
  ('notify.dispatch_url', 'platform', '"https://qcxbatdnajftmnmxnwjv.supabase.co/functions/v1/notify-dispatch"', 'ارسال‌کننده')
on conflict do nothing;

-- ---------------------------------------------------------------- the one entry point
create or replace function app.notify_kick() returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  perform net.http_post(url := app.setting('notify.dispatch_url') #>> '{}', body := '{}'::jsonb,
                        headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 5000);
exception when others then null;
end $$;

-- p_user: for customer events; p_pharmacy: for pharmacy events. Returns how many people were notified.
create or replace function app.notify(p_event text, p_pharmacy uuid, p_user uuid, p_title jsonb, p_body jsonb,
                                      p_link text default null, p_dedupe text default null, p_phone text default null,
                                      p_permission text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare e notify_events; n int := 0; v_sms boolean;
begin
  select * into e from notify_events where code = p_event;
  if not found or not e.active then return 0; end if;
  v_sms := e.sms and app.setting_bool('notify.sms_enabled', true);
  with who as (
    select distinct m.user_id from memberships m
     where e.audience = 'pharmacy' and m.pharmacy_id = p_pharmacy and m.status = 'active'
       and app.member_has(m.id, m.role_id, coalesce(p_permission, e.permission))
    union
    select distinct m.user_id from memberships m
     where e.audience = 'platform' and m.pharmacy_id is null and m.status = 'active'
       and app.member_has(m.id, m.role_id, coalesce(p_permission, e.permission))
    union
    select p_user where e.audience = 'customer' and p_user is not null
  ), ins as (
    insert into notifications (user_id, event, pharmacy_id, title, body, link, phone, dedupe, alarm, push_status, sms_status)
    select w.user_id, e.code, p_pharmacy, p_title, coalesce(p_body, '{}'), p_link,
           coalesce((select pr.mobile from profiles pr where pr.id = w.user_id), p_phone),
           p_dedupe, e.alarm,
           case when exists (select 1 from push_subscriptions s where s.user_id = w.user_id) then 'queued' else 'none' end,
           case when v_sms then 'queued' else 'none' end
    from who w
    where w.user_id is not null and (e.audience = 'customer' or w.user_id is distinct from auth.uid())
    on conflict (user_id, dedupe) where dedupe is not null do nothing
    returning 1
  )
  select count(*) into n from ins;
  if n > 0 then perform app.notify_kick(); end if;
  return n;
exception when others then
  raise warning 'notify % failed: %', p_event, sqlerrm;
  return 0;
end $$;

-- ---------------------------------------------------------------- events from the business tables
create or replace function app.ntf_order_parts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o orders; v_no text; v_ph text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into o from orders where id = new.order_id;
  v_no := coalesce(o.order_no, ''); v_ph := (select name_fa from pharmacies where id = new.pharmacy_id);
  if new.status in ('preparing', 'pending_tech') and old.status = 'awaiting_payment' then
    perform app.notify('ph.order_new', new.pharmacy_id, null,
      jsonb_build_object('fa', 'سفارش جدید ' || v_no, 'en', 'New order ' || v_no),
      jsonb_build_object('fa', 'یک سفارش تازه برای داروخانه ثبت شد.', 'en', 'A new order was placed for the pharmacy.'),
      '/fa/pharmacy/orders?ph=' || new.pharmacy_id, 'part-new-' || new.id);
  end if;
  if new.status = 'pending_tech' and old.status <> 'pending_tech' then
    perform app.notify('ph.order_tech', new.pharmacy_id, null,
      jsonb_build_object('fa', 'تأیید فنی لازم است: ' || v_no, 'en', 'Technical approval needed: ' || v_no),
      jsonb_build_object('fa', 'سفارش منتظر تأیید مسئول فنی است و مهلت دارد.', 'en', 'An order awaits the technical officer and has a deadline.'),
      '/fa/pharmacy/orders?ph=' || new.pharmacy_id, 'part-tech-' || new.id);
  end if;
  if new.status = 'shipped' then
    perform app.notify('cu.order_shipped', null, o.user_id,
      jsonb_build_object('fa', 'سفارش ' || v_no || ' ارسال شد', 'en', 'Order ' || v_no || ' shipped'),
      jsonb_build_object('fa', 'دوروا: سفارش ' || v_no || ' از داروخانه ' || coalesce(v_ph, '') || ' ارسال شد.', 'en', 'Dorva: order ' || v_no || ' is on its way.'),
      '/fa/account/orders/' || o.id, 'part-ship-' || new.id, o.address->>'phone');
  elsif new.status = 'delivered' then
    perform app.notify('cu.order_delivered', null, o.user_id,
      jsonb_build_object('fa', 'سفارش ' || v_no || ' تحویل شد', 'en', 'Order ' || v_no || ' delivered'),
      jsonb_build_object('fa', 'دوروا: سفارش ' || v_no || ' تحویل شد. سپاس از خرید شما.', 'en', 'Dorva: order ' || v_no || ' was delivered.'),
      '/fa/account/orders/' || o.id, 'part-done-' || new.id, o.address->>'phone');
  elsif new.status = 'cancelled' and old.status <> 'awaiting_payment' then
    perform app.notify('cu.order_cancelled', null, o.user_id,
      jsonb_build_object('fa', 'بخشی از سفارش ' || v_no || ' لغو شد', 'en', 'Part of order ' || v_no || ' cancelled'),
      jsonb_build_object('fa', 'دوروا: بخشی از سفارش ' || v_no || ' لغو شد و مبلغ آن بازگردانده می‌شود.', 'en', 'Dorva: part of order ' || v_no || ' was cancelled and will be refunded.'),
      '/fa/account/orders/' || o.id, 'part-cancel-c-' || new.id, o.address->>'phone');
    perform app.notify('ph.order_cancelled', new.pharmacy_id, null,
      jsonb_build_object('fa', 'سفارش ' || v_no || ' لغو شد', 'en', 'Order ' || v_no || ' cancelled'),
      jsonb_build_object('fa', 'دلیل: ' || coalesce(new.cancel_reason, '—'), 'en', 'Reason: ' || coalesce(new.cancel_reason, '—')),
      '/fa/pharmacy/orders?ph=' || new.pharmacy_id, 'part-cancel-p-' || new.id);
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_order_parts after update of status on public.order_parts for each row execute function app.ntf_order_parts();

create or replace function app.ntf_orders() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'paid' and old.status = 'awaiting_payment' then
    perform app.notify('cu.order_paid', null, new.user_id,
      jsonb_build_object('fa', 'سفارش ' || new.order_no || ' ثبت شد', 'en', 'Order ' || new.order_no || ' placed'),
      jsonb_build_object('fa', 'دوروا: سفارش ' || new.order_no || ' به مبلغ ' || to_char(new.grand_total / 10, 'FM999,999,999,999') || ' تومان ثبت و پرداخت شد.',
                         'en', 'Dorva: order ' || new.order_no || ' was placed and paid.'),
      '/fa/account/orders/' || new.id, 'order-paid-' || new.id, new.address->>'phone');
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_orders after update of status on public.orders for each row execute function app.ntf_orders();

-- registration decisions and resubmissions (pharmacy_reviews is the log)
create or replace function app.ntf_reviews() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := (select name_fa from pharmacies where id = new.pharmacy_id);
begin
  if new.action in ('approved', 'rejected') then
    perform app.notify('ph.registration', new.pharmacy_id, null,
      jsonb_build_object('fa', case when new.action = 'approved' then 'داروخانه شما تأیید و فعال شد' else 'ثبت‌نام داروخانه رد شد' end,
                         'en', case when new.action = 'approved' then 'Your pharmacy was approved' else 'Pharmacy registration rejected' end),
      jsonb_build_object('fa', 'دوروا: ' || coalesce(v_name, '') || case when new.note is not null then ' — ' || new.note else '' end,
                         'en', coalesce(new.note, '')),
      '/fa/pharmacy/dashboard?ph=' || new.pharmacy_id, 'review-' || new.id);
  elsif new.action = 'resubmitted' then
    perform app.notify('dv.pharmacy_signup', null, null,
      jsonb_build_object('fa', 'ارسال دوباره: ' || coalesce(v_name, ''), 'en', 'Resubmitted: ' || coalesce(v_name, '')),
      jsonb_build_object('fa', coalesce(new.note, ''), 'en', coalesce(new.note, '')), '/fa/admin/pharmacies', 'review-' || new.id);
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_reviews after insert on public.pharmacy_reviews for each row execute function app.ntf_reviews();

create or replace function app.ntf_pharmacy_signup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' and not new.is_virtual then
    perform app.notify('dv.pharmacy_signup', null, null,
      jsonb_build_object('fa', 'ثبت‌نام داروخانه جدید: ' || new.name_fa, 'en', 'New pharmacy sign-up: ' || new.name_fa),
      jsonb_build_object('fa', 'در صف تأیید است.', 'en', 'Waiting for approval.'), '/fa/admin/pharmacies', 'signup-' || new.id);
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_pharmacy_signup after insert on public.pharmacies for each row execute function app.ntf_pharmacy_signup();

-- moderated content: Dorva hears about a submission, the pharmacy about the decision
create or replace function app.ntf_content() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ph uuid; v_kind text; v_label text; v_perm text; v_name text; v_note text; v_status text; v_old text;
begin
  if tg_table_name = 'pharmacy_profile_changes' then
    v_ph := new.pharmacy_id; v_kind := 'dv.profile_change'; v_label := 'پروفایل'; v_perm := 'pharmacy.update_profile';
    v_status := new.status; v_old := case when tg_op = 'UPDATE' then old.status end; v_note := new.note;
  elsif tg_table_name = 'page_layouts' then
    if new.pharmacy_id is null then return new; end if;
    v_ph := new.pharmacy_id; v_kind := 'dv.page_review'; v_label := 'چیدمان صفحه'; v_perm := 'pharmacy.pages.manage';
    v_status := new.status; v_old := case when tg_op = 'UPDATE' then old.status end; v_note := new.review_note;
  elsif tg_table_name = 'pharmacy_looks' then
    v_ph := new.pharmacy_id; v_kind := 'dv.look_review'; v_label := 'ظاهر'; v_perm := 'pharmacy.pages.manage';
    v_status := new.status; v_old := case when tg_op = 'UPDATE' then old.status end; v_note := new.review_note;
  elsif tg_table_name = 'collections' then
    if new.pharmacy_id is null then return new; end if;
    v_ph := new.pharmacy_id; v_kind := 'dv.collection_review'; v_label := 'مجموعه «' || coalesce(new.title->>'fa', new.slug) || '»'; v_perm := 'pharmacy.collections.manage';
    v_status := new.status; v_old := case when tg_op = 'UPDATE' then old.status end; v_note := new.review_note;
  else
    return new;
  end if;
  if v_status is not distinct from v_old then return new; end if;
  v_name := (select name_fa from pharmacies where id = v_ph);
  if v_status = 'pending' then
    perform app.notify(v_kind, null, null,
      jsonb_build_object('fa', v_label || ' منتظر تأیید: ' || coalesce(v_name, ''), 'en', 'Awaiting approval: ' || coalesce(v_name, '')),
      jsonb_build_object('fa', 'در کارتابل تأیید دوروا.', 'en', 'In the Dorva approval inbox.'), '/fa/admin/inbox', null);
  elsif v_old = 'pending' and v_status in ('published', 'rejected') then
    perform app.notify('ph.content_review', v_ph, null,
      jsonb_build_object('fa', v_label || case when v_status = 'rejected' then ' رد شد' else ' تأیید و منتشر شد' end,
                         'en', case when v_status = 'rejected' then 'Rejected' else 'Approved and published' end),
      jsonb_build_object('fa', coalesce(v_note, ''), 'en', coalesce(v_note, '')), '/fa/pharmacy/dashboard?ph=' || v_ph, null, null, v_perm);
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;

-- a profile change that is approved is deleted: tell the pharmacy then
create or replace function app.ntf_profile_done() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'pending' and auth.uid() is not null and app.has_platform_permission('pharmacy.approve') then
    perform app.notify('ph.content_review', old.pharmacy_id, null,
      '{"fa":"تغییرات پروفایل تأیید و منتشر شد","en":"Profile changes approved and published"}'::jsonb, '{}'::jsonb,
      '/fa/pharmacy/profile?ph=' || old.pharmacy_id, null, null, 'pharmacy.update_profile');
  end if;
  return old;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return old;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pharmacy_profile_changes', 'page_layouts', 'pharmacy_looks', 'collections'] loop
    execute format('create or replace trigger ntf_content after insert or update on public.%I for each row execute function app.ntf_content()', t);
  end loop;
end $$;
create or replace trigger ntf_profile_done after delete on public.pharmacy_profile_changes for each row execute function app.ntf_profile_done();

create or replace function app.ntf_officer_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'pending' and auth.uid() is not null and auth.uid() <> old.user_id then
      perform app.notify('cu.officer_review', null, old.user_id, '{"fa":"پرونده حرفه‌ای شما تأیید و منتشر شد","en":"Your professional profile was approved"}'::jsonb,
        '{}'::jsonb, '/fa/account/pharmacist', null);
    end if;
    return old;
  end if;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending' or old.submitted_at <> new.submitted_at) then
    perform app.notify('dv.officer_change', null, null,
      jsonb_build_object('fa', 'پرونده مسئول فنی منتظر تأیید: ' || coalesce(new.payload->>'full_name', ''), 'en', 'Officer profile awaiting approval'),
      '{"fa":"در کارتابل تأیید دوروا.","en":"In the approval inbox."}'::jsonb, '/fa/admin/inbox#officers', null);
  elsif new.status = 'rejected' and tg_op = 'UPDATE' and old.status = 'pending' then
    perform app.notify('cu.officer_review', null, new.user_id, '{"fa":"پرونده حرفه‌ای شما رد شد","en":"Your professional profile was rejected"}'::jsonb,
      jsonb_build_object('fa', coalesce(new.note, ''), 'en', coalesce(new.note, '')), '/fa/account/pharmacist', null);
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create or replace trigger ntf_officer_changes after insert or update or delete on public.officer_changes for each row execute function app.ntf_officer_changes();

create or replace function app.ntf_officer_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if new.invite_email is null or new.user_id is not null
     or (tg_op = 'UPDATE' and new.invite_email is not distinct from old.invite_email) then
    return new;
  end if;
  select id into v_user from auth.users where lower(email) = lower(new.invite_email) limit 1;
  if v_user is not null then
    perform app.notify('cu.officer_invite', null, v_user,
      jsonb_build_object('fa', 'دعوت به عنوان مسئول فنی «' || coalesce((select name_fa from pharmacies where id = new.pharmacy_id), '') || '»', 'en', 'Invitation as technical officer'),
      '{"fa":"در «حساب من» بپذیرید.","en":"Accept it under My account."}'::jsonb, '/fa/account', 'officer-invite-' || new.id || '-' || new.invite_email);
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_officer_invite after insert or update of invite_email on public.pharmacy_officers for each row execute function app.ntf_officer_invite();

-- stock: price requests (to Dorva / back to the pharmacy) and low stock
create or replace function app.ntf_stock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text; v_low int := app.setting_num('notify.low_stock', 3)::int;
begin
  v_name := (select name_fa from catalog_products where id = new.product_id);
  if new.price_requested is not null and (old.price_requested is distinct from new.price_requested) then
    perform app.notify('dv.price_request', null, null,
      jsonb_build_object('fa', 'درخواست قیمت: ' || coalesce(v_name, ''), 'en', 'Price request: ' || coalesce(v_name, '')),
      jsonb_build_object('fa', coalesce((select name_fa from pharmacies where id = new.pharmacy_id), ''), 'en', ''), '/fa/admin/prices', null);
  elsif new.price_requested is null and old.price_requested is not null then
    perform app.notify('ph.price_review', new.pharmacy_id, null,
      jsonb_build_object('fa', case when new.price_review_note is null then 'قیمت تأیید شد: ' else 'قیمت رد شد: ' end || coalesce(v_name, ''),
                         'en', 'Price request decided: ' || coalesce(v_name, '')),
      jsonb_build_object('fa', coalesce(new.price_review_note, ''), 'en', coalesce(new.price_review_note, '')), '/fa/pharmacy/dashboard?ph=' || new.pharmacy_id, null);
  end if;
  if v_low > 0 and new.quantity <= v_low and old.quantity > v_low then
    perform app.notify('ph.stock_low', new.pharmacy_id, null,
      jsonb_build_object('fa', 'موجودی کم: ' || coalesce(v_name, ''), 'en', 'Low stock: ' || coalesce(v_name, '')),
      jsonb_build_object('fa', 'موجودی: ' || new.quantity, 'en', 'Stock: ' || new.quantity), '/fa/pharmacy/dashboard?ph=' || new.pharmacy_id,
      'low-' || new.id || '-' || to_char(now(), 'YYYYMMDD'));
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_stock after update of price_requested, quantity on public.stock_items for each row execute function app.ntf_stock();

create or replace function app.ntf_codes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'pending' then
    perform app.notify('dv.code_suggest', null, null, '{"fa":"بارکد پیشنهادی تازه","en":"New suggested barcode"}'::jsonb,
      jsonb_build_object('fa', coalesce((select name_fa from catalog_products where id = new.product_id), '') || ' — ' || new.code, 'en', new.code),
      '/fa/admin/codes', 'code-day-' || to_char(now(), 'YYYYMMDD'));
  end if;
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_codes after insert on public.product_codes for each row execute function app.ntf_codes();

create or replace function app.ntf_finder() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.notify('ph.finder_demand', new.pharmacy_id, null,
    jsonb_build_object('fa', 'تقاضای داروی کمیاب: ' || coalesce((select p.name_fa from finder_drugs d join catalog_products p on p.id = d.product_id where d.id = new.drug_id), ''), 'en', 'Demand for a scarce medicine'),
    '{"fa":"اگر دارید، در دارویاب موجودی را اعلام کنید.","en":"If you have it, report it in the finder."}'::jsonb,
    '/fa/pharmacy/finder?ph=' || new.pharmacy_id, 'finder-' || new.id || '-' || to_char(new.created_at, 'YYYYMMDD'));
  return new;
exception when others then
  raise warning 'notification trigger % failed: %', tg_name, sqlerrm;
  return new;
end $$;
create or replace trigger ntf_finder after insert on public.finder_alerts for each row execute function app.ntf_finder();

-- every morning: batches that expire soon (once per batch)
create or replace function public.notify_expiry_tick() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; v_days int := app.setting_num('notify.expiry_days', 60)::int;
begin
  if v_days <= 0 then return 0; end if;
  for r in
    select s.pharmacy_id, count(*) c, min(b.expiry_date) first_day
    from stock_batches b join stock_items s on s.id = b.stock_item_id
    where b.quantity > 0 and b.expiry_date between current_date and current_date + v_days
    group by s.pharmacy_id
  loop
    n := n + app.notify('ph.stock_expiring', r.pharmacy_id, null,
      jsonb_build_object('fa', r.c || ' بچ تا ' || v_days || ' روز دیگر منقضی می‌شود', 'en', r.c || ' batches expire within ' || v_days || ' days'),
      jsonb_build_object('fa', 'نزدیک‌ترین: ' || r.first_day, 'en', 'Earliest: ' || r.first_day),
      '/fa/pharmacy/dashboard?ph=' || r.pharmacy_id, 'expiry-' || r.pharmacy_id || '-' || to_char(now(), 'IYYY-IW'));
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- what users call
create or replace function public.my_notifications(p_after bigint default 0, p_limit int default 30) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'unread', (select count(*) from notifications where user_id = auth.uid() and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'event', n.event, 'title', n.title, 'body', n.body, 'link', n.link,
               'alarm', n.alarm, 'at', n.created_at, 'read', n.read_at is not null) order by n.id desc)
      from (select * from notifications where user_id = auth.uid() and id > coalesce(p_after, 0) order by id desc limit least(greatest(p_limit, 1), 100)) n), '[]'));
$$;

create or replace function public.notifications_read(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  return 'ok';
exception when check_violation then return 'value';
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return 'ok';
end $$;

create or replace function public.notify_public_key() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select public_key from notify_keys where id = 1;
$$;

-- the mobile number used for SMS: '' clears it; 'ok' | 'format' | 'taken'
create or replace function public.set_my_mobile(p_mobile text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := translate(coalesce(p_mobile, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩ -', '01234567890123456789');
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  if v ~ '^\+98' then v := '0' || substr(v, 4); elsif v ~ '^98' and length(v) = 12 then v := '0' || substr(v, 3); end if;
  if v <> '' and v !~ '^09[0-9]{9}$' then return 'format'; end if;
  insert into profiles (id, mobile) values (auth.uid(), nullif(v, ''))
  on conflict (id) do update set mobile = excluded.mobile;
  return 'ok';
exception when unique_violation then return 'taken';
end $$;

create or replace function public.my_mobile() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select mobile from profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------- Dorva: settings, log, test
create or replace function public.notify_admin() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'events', (select jsonb_agg(to_jsonb(e) order by e.sort) from notify_events e),
    'stats', jsonb_build_object(
      'subscriptions', (select count(*) from push_subscriptions),
      'users_with_mobile', (select count(*) from profiles where mobile is not null),
      'last_day', (select count(*) from notifications where created_at > now() - interval '1 day'),
      'sms_sent', (select count(*) from notifications where sms_status = 'sent' and created_at > now() - interval '7 days'),
      'sms_failed', (select count(*) from notifications where sms_status in ('failed', 'no_phone', 'no_provider') and created_at > now() - interval '7 days'),
      'push_sent', (select count(*) from notifications where push_status = 'sent' and created_at > now() - interval '7 days'),
      'queued', (select count(*) from notifications where push_status = 'queued' or sms_status = 'queued'),
      'keys', exists (select 1 from notify_keys)),
    'log', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'event', n.event, 'title', n.title->>'fa', 'at', n.created_at,
               'push', n.push_status, 'sms', n.sms_status, 'read', n.read_at is not null)) from (
      select * from notifications order by id desc limit 60) n), '[]'));
end $$;

create or replace function public.notify_event_save(p_code text, p_sms boolean, p_alarm boolean, p_active boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update notify_events set sms = coalesce(p_sms, sms), alarm = coalesce(p_alarm, alarm), active = coalesce(p_active, active) where code = p_code;
  return case when found then 'ok' else 'missing' end;
end $$;

-- sends a test notification (all channels) to the caller
create or replace function public.notify_test() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into notifications (user_id, event, title, body, link, phone, alarm, push_status, sms_status)
  values (auth.uid(), 'dv.pharmacy_signup', '{"fa":"اعلان آزمایشی دوروا","en":"Dorva test notification"}',
          '{"fa":"اگر این را می‌بینید و صدای هشدار را شنیدید، اعلان‌ها کار می‌کنند.","en":"If you can see and hear this, notifications work."}',
          '/fa/admin/notifications', (select mobile from profiles where id = auth.uid()), true,
          case when exists (select 1 from push_subscriptions where user_id = auth.uid()) then 'queued' else 'none' end,
          case when app.setting_bool('notify.sms_enabled', true) then 'queued' else 'none' end);
  get diagnostics n = row_count;
  perform app.notify_kick();
  return n;
end $$;

-- ---------------------------------------------------------------- the dispatcher's side (service role only)
create or replace function app.is_service() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select 'service_role' in (
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', ''),
    coalesce(current_setting('request.jwt.claim.role', true), ''),
    coalesce(current_setting('role', true), ''));
$$;
-- claims a batch of queued deliveries so two dispatcher runs never send twice
create or replace function public.notify_claim(p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  with c as (
    select id from notifications where (push_status = 'queued' or sms_status = 'queued') and tries < 5
     order by id limit least(greatest(p_limit, 1), 300) for update skip locked
  ), u as (
    update notifications n set tries = n.tries + 1 from c where n.id = c.id
    returning n.id, n.user_id, n.title, n.body, n.link, n.phone, n.alarm, n.push_status, n.sms_status
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'link', u.link, 'phone', u.phone, 'alarm', u.alarm,
           'push', u.push_status = 'queued', 'sms', u.sms_status = 'queued',
           'subs', case when u.push_status = 'queued' then (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]')
                                                            from push_subscriptions s where s.user_id = u.user_id) else '[]' end)), '[]')
    into v from u;
  return jsonb_build_object('items', v,
    'sms', jsonb_build_object('enabled', app.setting_bool('notify.sms_enabled', true), 'provider', app.setting('notify.sms_provider') #>> '{}',
                              'sender', app.setting('notify.sms_sender') #>> '{}'));
end $$;

create or replace function public.notify_result(p_id bigint, p_push text, p_sms text, p_gone text[] default '{}') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  update notifications set push_status = coalesce(p_push, push_status), sms_status = coalesce(p_sms, sms_status) where id = p_id;
  if cardinality(p_gone) > 0 then delete from push_subscriptions where endpoint = any(p_gone); end if;
end $$;

grant execute on function public.my_notifications(bigint, int) to authenticated;
grant execute on function public.notifications_read(bigint[]) to authenticated;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.notify_public_key() to anon, authenticated;
grant execute on function public.set_my_mobile(text) to authenticated;
grant execute on function public.my_mobile() to authenticated;
grant execute on function public.notify_admin() to authenticated;
grant execute on function public.notify_event_save(text, boolean, boolean, boolean) to authenticated;
grant execute on function public.notify_test() to authenticated;

-- ---------------------------------------------------------------- schedules (skipped where not available)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'dorva-notify-retry') then
      perform cron.schedule('dorva-notify-retry', '* * * * *',
        $c$select app.notify_kick() where exists (select 1 from public.notifications where (push_status = 'queued' or sms_status = 'queued') and tries < 5)$c$);
    end if;
    if not exists (select 1 from cron.job where jobname = 'dorva-notify-expiry') then
      perform cron.schedule('dorva-notify-expiry', '30 4 * * *', 'select public.notify_expiry_tick()');
    end if;
  end if;
end $$;
