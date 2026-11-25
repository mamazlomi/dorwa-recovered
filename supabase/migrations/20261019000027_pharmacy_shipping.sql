-- Two-layer shipping: Dorva decides whether pharmacies may run their own
-- delivery (globally, with a per-pharmacy exception); a permitted pharmacy sets
-- its own fees, reach and cut-off within bounds Dorva sets. One setting
-- (shipping.provider_mode = dorva) centralises everything again; pharmacy
-- values are kept, only ignored, so the switch is reversible.
--
-- Fairness: pharmacy fees never influence which pharmacy gets a cart; the
-- allocation engine looks at stock and distance only. A pharmacy's reach
-- (radius) does limit which carts it can be offered.
--
-- Every order part records who delivers (shipping_provider) at order time, so
-- later changes never touch earlier orders or their settlement.

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('shipping.provider_mode', 'shipping', 'enum',
   '[{"value":"dorva","label":{"fa":"ارسال با دوروا (متمرکز)","en":"Dorva delivers (central)","ar":"دوروا توصل (مركزي)"}},
     {"value":"pharmacy_allowed","label":{"fa":"داروخانه‌ها اجازه ارسال دارند","en":"Pharmacies may deliver","ar":"يُسمح للصيدليات بالتوصيل"}}]',
   null, null, null,
   '{"fa":"چه کسی ارسال درون‌شهری را انجام می‌دهد","en":"Who handles local delivery","ar":"من يتولى التوصيل المحلي"}',
   '{"fa":"«ارسال با دوروا» همه داروخانه‌ها را به تنظیمات دوروا برمی‌گرداند؛ تنظیمات داروخانه‌ها پاک نمی‌شود و با برگرداندن این گزینه دوباره فعال می‌شود.","en":"\"Dorva delivers\" puts every pharmacy back on Dorva''s rates; pharmacy values are kept and return when switched back.","ar":"«دوروا توصل» يعيد كل الصيدليات إلى إعدادات دوروا؛ تبقى قيم الصيدليات وتعود عند الرجوع."}', 500),
  ('shipping.pharmacy_default_allowed', 'shipping', 'boolean', null, null, null, null,
   '{"fa":"اجازه پیش‌فرض ارسال برای همه داروخانه‌ها","en":"Pharmacies allowed by default","ar":"السماح الافتراضي لكل الصيدليات"}',
   '{"fa":"برای هر داروخانه می‌توانید در «ارسال داروخانه‌ها» استثنا بگذارید.","en":"Set per-pharmacy exceptions under \"Pharmacy delivery\".","ar":"يمكن وضع استثناء لكل صيدلية في «توصيل الصيدليات»."}', 501),
  ('shipping.ph_base_fee_max_rial', 'shipping', 'number', null, 0, 100000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"سقف هزینه پایه داروخانه","en":"Pharmacy base fee, maximum","ar":"الحد الأقصى للرسوم الأساسية للصيدلية"}', null, 502),
  ('shipping.ph_per_km_max_rial', 'shipping', 'number', null, 0, 10000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"سقف هزینه هر کیلومتر داروخانه","en":"Pharmacy fee per km, maximum","ar":"الحد الأقصى للرسوم لكل كم"}', null, 503),
  ('shipping.ph_radius_max_km', 'shipping', 'number', null, 0.5, 100, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"سقف شعاع ارسال داروخانه","en":"Pharmacy delivery radius, maximum","ar":"الحد الأقصى لنطاق توصيل الصيدلية"}',
   '{"fa":"شعاع داروخانه از «حداکثر شعاع تخصیص» هم بیشتر نمی‌شود.","en":"Never beyond the allocation maximum radius either.","ar":"لا يتجاوز أيضاً أقصى نطاق للتخصيص."}', 504),
  ('shipping.ph_free_over_min_rial', 'shipping', 'number', null, 0, 10000000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"کف مبلغ ارسال رایگان داروخانه","en":"Pharmacy free-delivery threshold, minimum","ar":"الحد الأدنى لعتبة التوصيل المجاني"}',
   '{"fa":"داروخانه نمی‌تواند ارسال رایگان را برای سفارش کوچک‌تر از این مبلغ بگذارد (جلوگیری از رقابت ناسالم). صفر = بدون محدودیت.","en":"A pharmacy cannot offer free delivery below this amount. 0 = no limit.","ar":"لا يمكن للصيدلية تقديم توصيل مجاني لطلب أقل من هذا المبلغ. 0 = بلا حد."}', 505)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
  ('shipping.provider_mode',           'platform', '"dorva"',  'چه کسی ارسال درون‌شهری را انجام می‌دهد'),
  ('shipping.pharmacy_default_allowed','platform', 'true',     'اجازه پیش‌فرض ارسال برای همه داروخانه‌ها'),
  ('shipping.ph_base_fee_max_rial',    'platform', '1000000',  'سقف هزینه پایه داروخانه'),
  ('shipping.ph_per_km_max_rial',      'platform', '150000',   'سقف هزینه هر کیلومتر داروخانه'),
  ('shipping.ph_radius_max_km',        'platform', '15',       'سقف شعاع ارسال داروخانه'),
  ('shipping.ph_free_over_min_rial',   'platform', '0',        'کف مبلغ ارسال رایگان داروخانه')
on conflict do nothing;

-- ---------------------------------------------------------------- pharmacy-scope guard
-- Pharmacies could write any key at pharmacy scope; only keys marked editable
-- are allowed from now on (platform admins may still set any).
alter table public.setting_definitions add column if not exists pharmacy_editable boolean not null default false;
update public.setting_definitions set pharmacy_editable = true where key = 'tech_approval.window_min';

create or replace function app.settings_scope_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.scope = 'pharmacy' and auth.uid() is not null
     and not app.has_platform_permission('settings.manage')
     and not exists (select 1 from public.setting_definitions d where d.key = new.key and d.pharmacy_editable) then
    raise exception 'setting % cannot be changed by a pharmacy', new.key using errcode = '42501';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'settings_scope_guard_trg') then
    create trigger settings_scope_guard_trg before insert or update on public.settings
      for each row execute function app.settings_scope_guard();
  end if;
end $$;

-- ---------------------------------------------------------------- pharmacy values
create table if not exists public.pharmacy_shipping (
  pharmacy_id        uuid primary key references public.pharmacies(id) on delete cascade,
  admin_allowed      boolean,              -- null = follow shipping.pharmacy_default_allowed
  own_courier        boolean not null default false,
  base_fee_rial      numeric check (base_fee_rial >= 0),
  per_km_rial        numeric check (per_km_rial >= 0),
  free_over_rial     numeric not null default 0 check (free_over_rial >= 0),
  radius_km          numeric check (radius_km > 0),
  same_day_km        numeric check (same_day_km > 0),
  cutoff_hour        int check (cutoff_hour between 0 and 24),
  intercity_accept   boolean not null default true,
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
alter table public.pharmacy_shipping enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'pharmacy_shipping' and policyname = 'read') then
    create policy read on public.pharmacy_shipping for select
      using (app.pharmacy_access(pharmacy_id, 'pharmacy.settings.manage')
             or app.pharmacy_access(pharmacy_id, 'order.read')
             or app.has_platform_permission('pharmacy.read_all'));
  end if;
end $$;
grant select on public.pharmacy_shipping to authenticated;

-- may this pharmacy deliver itself right now?
create or replace function app.ph_ship_allowed(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.setting('shipping.provider_mode') #>> '{}', 'dorva') = 'pharmacy_allowed'
     and coalesce((select s.admin_allowed from public.pharmacy_shipping s where s.pharmacy_id = p_pharmacy),
                  app.setting_bool('shipping.pharmacy_default_allowed', true));
$$;
create or replace function app.ph_ship_active(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.ph_ship_allowed(p_pharmacy)
     and coalesce((select s.own_courier from public.pharmacy_shipping s where s.pharmacy_id = p_pharmacy), false);
$$;

-- reach of a pharmacy for local carts (km)
create or replace function app.ph_reach_km(p_pharmacy uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.ph_ship_active(p_pharmacy) then
           least(coalesce((select s.radius_km from public.pharmacy_shipping s where s.pharmacy_id = p_pharmacy),
                          app.setting_num('allocation.max_radius_km', 10)),
                 app.setting_num('shipping.ph_radius_max_km', 15),
                 app.setting_num('allocation.max_radius_km', 10))
         else app.setting_num('allocation.max_radius_km', 10) end;
$$;

-- who delivers this part
create or replace function app.ph_ship_provider(p_pharmacy uuid, p_kind text) returns text
language sql stable as $$
  select case when p_kind = 'local' and app.ph_ship_active(p_pharmacy) then 'pharmacy' else 'dorva' end;
$$;

-- fee with the pharmacy's own rates when it delivers (clamped to today's bounds)
create or replace function app.shipping_fee_ph(p_pharmacy uuid, p_kind text, p_km numeric, p_subtotal numeric) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.pharmacy_shipping; v_free numeric;
begin
  if p_kind <> 'local' or not app.ph_ship_active(p_pharmacy) then
    return app.shipping_fee(p_kind, p_km, p_subtotal);
  end if;
  select * into s from public.pharmacy_shipping where pharmacy_id = p_pharmacy;
  v_free := coalesce(s.free_over_rial, 0);
  if v_free > 0 and v_free < app.setting_num('shipping.ph_free_over_min_rial', 0) then
    v_free := app.setting_num('shipping.ph_free_over_min_rial', 0);
  end if;
  if v_free > 0 and p_subtotal >= v_free then return 0; end if;
  return round(least(coalesce(s.base_fee_rial, app.setting_num('shipping.local_base_fee_rial', 300000)),
                     app.setting_num('shipping.ph_base_fee_max_rial', 1000000))
             + least(coalesce(s.per_km_rial, app.setting_num('shipping.local_per_km_rial', 50000)),
                     app.setting_num('shipping.ph_per_km_max_rial', 150000)) * coalesce(p_km, 0), -4);
end $$;

-- delivery estimate with the pharmacy's own cut-off and same-day distance
create or replace function app.local_eta_ph(p_pharmacy uuid, p_km numeric) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select case when app.ph_ship_active(p_pharmacy) then ps.same_day_km end km,
           case when app.ph_ship_active(p_pharmacy) then ps.cutoff_hour end hr
    from (select 1) one left join public.pharmacy_shipping ps on ps.pharmacy_id = p_pharmacy
  )
  select case
    when p_km is not null and p_km <= coalesce(s.km, app.setting_num('delivery.same_day_max_km', 8))
         and extract(hour from now() at time zone 'Asia/Tehran') < coalesce(s.hr, app.setting_num('delivery.same_day_cutoff_hour', 17))
      then 'today' else 'tomorrow' end
  from s;
$$;

-- does the pharmacy take intercity orders?
create or replace function app.ph_intercity_ok(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.intercity_accept from public.pharmacy_shipping s where s.pharmacy_id = p_pharmacy), true);
$$;

-- ---------------------------------------------------------------- RPCs
-- the pharmacy saves its delivery settings (bounds are enforced, not clipped)
create or replace function public.pharmacy_shipping_save(
  p_pharmacy uuid, p_own_courier boolean, p_base_fee numeric, p_per_km numeric, p_free_over numeric,
  p_radius numeric, p_same_day_km numeric, p_cutoff int, p_intercity boolean)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.pharmacy_access(p_pharmacy, 'pharmacy.settings.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_base_fee is not null and (p_base_fee < 0 or p_base_fee > app.setting_num('shipping.ph_base_fee_max_rial', 1000000)) then return 'base_fee'; end if;
  if p_per_km is not null and (p_per_km < 0 or p_per_km > app.setting_num('shipping.ph_per_km_max_rial', 150000)) then return 'per_km'; end if;
  if coalesce(p_free_over, 0) < 0 or (coalesce(p_free_over, 0) > 0
     and p_free_over < app.setting_num('shipping.ph_free_over_min_rial', 0)) then return 'free_over'; end if;
  if p_radius is not null and (p_radius <= 0 or p_radius > least(app.setting_num('shipping.ph_radius_max_km', 15),
                                                               app.setting_num('allocation.max_radius_km', 10))) then return 'radius'; end if;
  if p_same_day_km is not null and p_same_day_km <= 0 then return 'same_day_km'; end if;
  if p_cutoff is not null and (p_cutoff < 0 or p_cutoff > 24) then return 'cutoff'; end if;

  insert into public.pharmacy_shipping (pharmacy_id, own_courier, base_fee_rial, per_km_rial, free_over_rial, radius_km,
                                        same_day_km, cutoff_hour, intercity_accept, updated_by, updated_at)
  values (p_pharmacy, coalesce(p_own_courier, false), p_base_fee, p_per_km, coalesce(p_free_over, 0), p_radius,
          p_same_day_km, p_cutoff, coalesce(p_intercity, true), auth.uid(), now())
  on conflict (pharmacy_id) do update set
    own_courier = excluded.own_courier, base_fee_rial = excluded.base_fee_rial, per_km_rial = excluded.per_km_rial,
    free_over_rial = excluded.free_over_rial, radius_km = excluded.radius_km, same_day_km = excluded.same_day_km,
    cutoff_hour = excluded.cutoff_hour, intercity_accept = excluded.intercity_accept,
    updated_by = excluded.updated_by, updated_at = now();
  return 'ok';
end $$;
grant execute on function public.pharmacy_shipping_save(uuid, boolean, numeric, numeric, numeric, numeric, numeric, int, boolean) to authenticated;

-- Dorva sets a per-pharmacy exception (null = follow the default)
create or replace function public.admin_pharmacy_shipping_allow(p_pharmacy uuid, p_allowed boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.pharmacy_shipping (pharmacy_id, admin_allowed, updated_by)
  values (p_pharmacy, p_allowed, auth.uid())
  on conflict (pharmacy_id) do update set admin_allowed = excluded.admin_allowed, updated_by = excluded.updated_by, updated_at = now();
end $$;
grant execute on function public.admin_pharmacy_shipping_allow(uuid, boolean) to authenticated;

-- status of one pharmacy (for its panel and the admin list)
create or replace function public.pharmacy_shipping_status(p_pharmacy uuid)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.pharmacy_access(p_pharmacy, 'pharmacy.settings.manage') or app.has_platform_permission('pharmacy.read_all')
    then jsonb_build_object(
      'mode', coalesce(app.setting('shipping.provider_mode') #>> '{}', 'dorva'),
      'allowed', app.ph_ship_allowed(p_pharmacy),
      'active', app.ph_ship_active(p_pharmacy),
      'reach_km', app.ph_reach_km(p_pharmacy),
      'bounds', jsonb_build_object(
        'base_fee_max', app.setting_num('shipping.ph_base_fee_max_rial', 1000000),
        'per_km_max', app.setting_num('shipping.ph_per_km_max_rial', 150000),
        'radius_max', least(app.setting_num('shipping.ph_radius_max_km', 15), app.setting_num('allocation.max_radius_km', 10)),
        'free_over_min', app.setting_num('shipping.ph_free_over_min_rial', 0)),
      'dorva', jsonb_build_object(
        'base_fee', app.setting_num('shipping.local_base_fee_rial', 300000),
        'per_km', app.setting_num('shipping.local_per_km_rial', 50000),
        'free_over', app.setting_num('shipping.local_free_over_rial', 0),
        'same_day_km', app.setting_num('delivery.same_day_max_km', 8),
        'cutoff', app.setting_num('delivery.same_day_cutoff_hour', 17)))
  end;
$$;
grant execute on function public.pharmacy_shipping_status(uuid) to authenticated;

-- ---------------------------------------------------------------- order snapshot
alter table public.order_parts add column if not exists shipping_provider text not null default 'dorva'
  check (shipping_provider in ('dorva', 'pharmacy'));
alter table public.settlements add column if not exists logistics_payee text not null default 'dorva'
  check (logistics_payee in ('dorva', 'pharmacy'));
