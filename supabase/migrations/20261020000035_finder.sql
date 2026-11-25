-- Medicine finder (دارویابی): a Dorva-curated shortage list, pharmacies
-- declaring "I have it" (expires unless re-confirmed), an anonymous patient
-- search with call buttons, signed-in "they didn't have it" reports that
-- push unreliable pharmacies down, and statistics for Dorva and pharmacies.
-- No sale happens here: no prices, the patient calls and picks up in person.

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('finder.enabled', 'finder', 'boolean', null, null, null, null,
   '{"fa":"دارویابی فعال","en":"Medicine finder on","ar":"البحث عن الدواء مفعّل"}',
   '{"fa":"خاموش: صفحه دارویابی برای بیماران بسته می‌شود؛ پنل‌ها باز می‌مانند.","en":"Off: the patient page closes; panels stay open.","ar":"إيقاف: تُغلق صفحة المرضى وتبقى اللوحات."}', 700),
  ('finder.direct_suggestions', 'finder', 'boolean', null, null, null, null,
   '{"fa":"ورود مستقیم پیشنهاد داروخانه به لیست","en":"Pharmacy suggestions join the list directly","ar":"اقتراحات الصيدليات تدخل القائمة مباشرة"}',
   '{"fa":"خاموش (پیشنهادی): هر پیشنهاد تا تأیید مدیر دوروا وارد لیست کمبود نمی‌شود. بدون تأیید، داروخانه‌ها هر داروی موجودی را کمبود اعلام می‌کنند تا دیده شوند.","en":"Off (recommended): a suggestion joins only after Dorva approves it.","ar":"إيقاف (موصى به): لا يدخل الاقتراح قبل موافقة دوروا."}', 701),
  ('finder.stock_ttl_days', 'finder', 'number', null, 1, 30, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"مدت اعتبار اعلام موجودی","en":"How long an \"I have it\" lasts","ar":"مدة صلاحية إعلان التوفر"}',
   '{"fa":"بعد از این مدت اعلام «دارم» منقضی می‌شود مگر داروخانه دوباره تأیید کند.","en":"After this the declaration expires unless the pharmacy confirms again.","ar":"بعدها ينتهي الإعلان ما لم تؤكده الصيدلية مجدداً."}', 702),
  ('finder.other_cities', 'finder', 'boolean', null, null, null, null,
   '{"fa":"نمایش شهرهای دیگر وقتی در شهر بیمار نیست","en":"Show other cities when none in the patient''s city","ar":"عرض مدن أخرى عند عدم التوفر في مدينة المريض"}', null, 703),
  ('finder.max_results', 'finder', 'number', null, 3, 50, null,
   '{"fa":"حداکثر داروخانه در نتیجه","en":"Maximum pharmacies per result","ar":"أقصى عدد صيدليات في النتيجة"}', null, 704),
  ('finder.report_threshold', 'finder', 'number', null, 1, 50, '{"fa":"گزارش","en":"reports","ar":"بلاغ"}',
   '{"fa":"تعداد گزارش «نداشت» برای کاهش رتبه","en":"\"Didn''t have it\" reports that lower the rank","ar":"عدد بلاغات «لم يتوفر» لخفض الترتيب"}',
   '{"fa":"داروخانه‌ای که در بازه شمارش این تعداد گزارش (برای هر دارویی) بگیرد، در همه نتایج پایین‌تر از بقیه می‌آید.","en":"A pharmacy with this many reports in the window (any medicine) is listed below the others.","ar":"تُعرض الصيدلية التي تبلغ هذا العدد أسفل غيرها."}', 705),
  ('finder.report_window_days', 'finder', 'number', null, 1, 365, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"بازه زمانی شمارش گزارش‌ها","en":"Report counting window","ar":"فترة عد البلاغات"}', null, 706),
  ('finder.report_cooldown_hours', 'finder', 'number', null, 1, 720, '{"fa":"ساعت","en":"hours","ar":"ساعة"}',
   '{"fa":"فاصله مجاز بین دو گزارش یک نفر برای یک داروخانه و دارو","en":"Gap between two reports by one person for the same pharmacy and medicine","ar":"الفاصل بين بلاغين من الشخص نفسه"}', null, 707)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('finder.enabled', 'platform', 'true', 'دارویابی فعال'),
  ('finder.direct_suggestions', 'platform', 'false', 'ورود مستقیم پیشنهاد داروخانه به لیست'),
  ('finder.stock_ttl_days', 'platform', '3', 'مدت اعتبار اعلام موجودی'),
  ('finder.other_cities', 'platform', 'true', 'نمایش شهرهای دیگر'),
  ('finder.max_results', 'platform', '20', 'حداکثر داروخانه در نتیجه'),
  ('finder.report_threshold', 'platform', '3', 'تعداد گزارش برای کاهش رتبه'),
  ('finder.report_window_days', 'platform', '30', 'بازه شمارش گزارش‌ها'),
  ('finder.report_cooldown_hours', 'platform', '24', 'فاصله گزارش‌های یک نفر')
on conflict do nothing;

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, scope, description_fa) values
  ('finder.manage', 'platform', 'مدیریت لیست کمبود دارویابی و پیشنهادها'),
  ('pharmacy.finder.manage', 'pharmacy', 'اعلام موجودی و پیشنهاد در دارویابی')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'finder.manage' from public.roles r
where r.is_system and r.pharmacy_id is null and r.scope = 'platform' and r.code in ('super_admin', 'catalog_operator', 'content_moderator')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'pharmacy.finder.manage' from public.roles r
where r.is_system and r.pharmacy_id is null and r.scope = 'pharmacy' and r.code in ('owner', 'technical_officer', 'dispenser', 'inventory_clerk')
on conflict do nothing;

-- ---------------------------------------------------------------- tables
create table if not exists public.finder_drugs (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null unique references public.catalog_products(id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'off')),
  note        text check (note is null or length(note) <= 300),
  origin      text not null default 'admin' check (origin in ('admin', 'suggestion')),
  added_by    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.finder_suggestions (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.catalog_products(id) on delete cascade,
  pharmacy_id  uuid not null references public.pharmacies(id) on delete cascade,
  suggested_by uuid references auth.users(id),
  note         text check (note is null or length(note) <= 300),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note  text check (review_note is null or length(review_note) <= 300),
  reviewed_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create unique index if not exists finder_suggestions_open on public.finder_suggestions (product_id, pharmacy_id) where status = 'pending';

-- "I have it": a row = declared; fresh while confirmed_at is within the TTL
create table if not exists public.finder_stock (
  pharmacy_id   uuid not null references public.pharmacies(id) on delete cascade,
  drug_id       uuid not null references public.finder_drugs(id) on delete cascade,
  confirmed_at  timestamptz not null default now(),
  confirmed_by  uuid references auth.users(id),
  primary key (pharmacy_id, drug_id)
);

create table if not exists public.finder_reports (
  id           bigserial primary key,
  drug_id      uuid not null references public.finder_drugs(id) on delete cascade,
  pharmacy_id  uuid not null references public.pharmacies(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  note         text check (note is null or length(note) <= 300),
  created_at   timestamptz not null default now()
);
create index if not exists finder_reports_ph on public.finder_reports (pharmacy_id, created_at);

-- anonymous behaviour: searches, result views, call clicks
create table if not exists public.finder_events (
  id           bigserial primary key,
  kind         text not null check (kind in ('search', 'view', 'call')),
  drug_id      uuid references public.finder_drugs(id) on delete cascade,
  pharmacy_id  uuid references public.pharmacies(id) on delete cascade,
  query        text,
  results      int,
  city_id      int,
  created_at   timestamptz not null default now()
);
create index if not exists finder_events_kind_time on public.finder_events (kind, created_at);

-- everything goes through the functions below
alter table public.finder_drugs enable row level security;
alter table public.finder_suggestions enable row level security;
alter table public.finder_stock enable row level security;
alter table public.finder_reports enable row level security;
alter table public.finder_events enable row level security;

-- ---------------------------------------------------------------- helpers
create or replace function app.finder_fresh(p_confirmed timestamptz) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select p_confirmed > now() - make_interval(days => app.setting_num('finder.stock_ttl_days', 3)::int);
$$;

create or replace function app.finder_demoted(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*) from finder_reports r where r.pharmacy_id = p_pharmacy
            and r.created_at > now() - make_interval(days => app.setting_num('finder.report_window_days', 30)::int))
         >= app.setting_num('finder.report_threshold', 3);
$$;

create or replace function app.finder_can(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.pharmacy_access(p_pharmacy, 'pharmacy.finder.manage') or app.has_platform_permission('finder.manage');
$$;

-- ---------------------------------------------------------------- patient side (no sign-in)
-- shortage medicines matching a query (all when empty), with how many pharmacies have each now
create or replace function public.finder_search(p_query text default null, p_city int default null)
returns table (drug_id uuid, product_id uuid, name_fa text, name_en text, generic_name text, dispensing_class text,
               image_url text, in_city int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) q)
  select d.id, p.id, p.name_fa, p.name_en, p.generic_name, p.dispensing_class, p.image_url,
         (select count(*) from finder_stock s join pharmacies ph on ph.id = s.pharmacy_id
           where s.drug_id = d.id and ph.status = 'active' and app.finder_fresh(s.confirmed_at)
             and ph.city_id = p_city)::int,
         (select count(*) from finder_stock s join pharmacies ph on ph.id = s.pharmacy_id
           where s.drug_id = d.id and ph.status = 'active' and app.finder_fresh(s.confirmed_at))::int
  from finder_drugs d join catalog_products p on p.id = d.product_id cross join q
  where d.status = 'active' and app.setting_bool('finder.enabled', true)
    and (q.q is null or app.norm_text(p.name_fa) like '%' || q.q || '%'
         or app.norm_text(coalesce(p.name_en, '')) like '%' || q.q || '%'
         or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%')
  order by p.name_fa
  limit 60;
$$;

-- one listed medicine (for its page)
create or replace function public.finder_drug(p_drug uuid)
returns table (drug_id uuid, product_id uuid, name_fa text, name_en text, generic_name text, dispensing_class text, image_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, p.id, p.name_fa, p.name_en, p.generic_name, p.dispensing_class, p.image_url
  from finder_drugs d join catalog_products p on p.id = d.product_id
  where d.id = p_drug and d.status = 'active' and app.setting_bool('finder.enabled', true);
$$;

-- pharmacies that have one medicine now: the patient's city first; other cities only
-- when none there (setting). Nearest first; pharmacies past the report threshold last.
create or replace function public.finder_pharmacies(p_drug uuid, p_city int default null,
                                                   p_lat double precision default null, p_lng double precision default null)
returns table (pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, phone text, address text, city_id int,
               city_name text, in_city boolean, distance_km numeric, confirmed_at timestamptz, demoted boolean)
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_lat double precision := p_lat; v_lng double precision := p_lng;
  v_any_city boolean;
begin
  if not app.setting_bool('finder.enabled', true)
     or not exists (select 1 from finder_drugs where id = p_drug and status = 'active') then
    return;
  end if;
  if v_lat is null and p_city is not null then
    select c.lat, c.lng into v_lat, v_lng from cities c where c.id = p_city;
  end if;
  v_any_city := p_city is null or (
    app.setting_bool('finder.other_cities', true) and not exists (
      select 1 from finder_stock s join pharmacies ph on ph.id = s.pharmacy_id
      where s.drug_id = p_drug and ph.status = 'active' and ph.city_id = p_city and app.finder_fresh(s.confirmed_at)));
  return query
    select ph.id, ph.slug::text, ph.name_fa, ph.name_i18n, ph.phone, ph.address, ph.city_id, c.name_fa,
           ph.city_id is not distinct from p_city,
           case when v_lat is null then null
                else round((earth_distance(ll_to_earth(ph.lat, ph.lng), ll_to_earth(v_lat, v_lng)) / 1000)::numeric, 1) end,
           s.confirmed_at, app.finder_demoted(ph.id)
    from finder_stock s
    join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
    left join cities c on c.id = ph.city_id
    where s.drug_id = p_drug and app.finder_fresh(s.confirmed_at)
      and (v_any_city or ph.city_id = p_city)
    order by (ph.city_id is not distinct from p_city) desc, app.finder_demoted(ph.id),
             case when v_lat is null then 0 else earth_distance(ll_to_earth(ph.lat, ph.lng), ll_to_earth(v_lat, v_lng)) end,
             s.confirmed_at desc
    limit app.setting_num('finder.max_results', 20)::int;
end $$;

-- anonymous event log (search / view / call)
create or replace function public.finder_log(p_kind text, p_drug uuid default null, p_pharmacy uuid default null,
                                            p_query text default null, p_results int default null, p_city int default null)
returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into finder_events (kind, drug_id, pharmacy_id, query, results, city_id)
  select p_kind, p_drug, p_pharmacy, nullif(left(lower(trim(coalesce(p_query, ''))), 80), ''), p_results, p_city
  where p_kind in ('search', 'view', 'call')
    and (p_kind <> 'search' or coalesce(trim(p_query), '') <> '')
    and (p_drug is null or exists (select 1 from finder_drugs where id = p_drug))
    and (p_pharmacy is null or exists (select 1 from pharmacies where id = p_pharmacy))
    and (p_kind <> 'call' or (p_drug is not null and p_pharmacy is not null));
$$;

-- "they didn't have it": signed-in only, one per person/pharmacy/medicine per cooldown
-- 'ok' | 'login' | 'cooldown' | 'not_listed'
create or replace function public.finder_report(p_drug uuid, p_pharmacy uuid, p_note text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return 'login'; end if;
  if not exists (select 1 from finder_stock where drug_id = p_drug and pharmacy_id = p_pharmacy) then return 'not_listed'; end if;
  if exists (select 1 from finder_reports where user_id = auth.uid() and drug_id = p_drug and pharmacy_id = p_pharmacy
               and created_at > now() - make_interval(hours => app.setting_num('finder.report_cooldown_hours', 24)::int)) then
    return 'cooldown';
  end if;
  insert into finder_reports (drug_id, pharmacy_id, user_id, note)
  values (p_drug, p_pharmacy, auth.uid(), left(nullif(trim(coalesce(p_note, '')), ''), 300));
  return 'ok';
end $$;

-- ---------------------------------------------------------------- pharmacy side
-- every listed medicine with this pharmacy's declaration and its counts
create or replace function public.finder_pharmacy_list(p_pharmacy uuid)
returns table (drug_id uuid, product_id uuid, name_fa text, dispensing_class text, have boolean, fresh boolean,
               confirmed_at timestamptz, expires_at timestamptz, calls_30d int, reports_30d int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select d.id, p.id, p.name_fa, p.dispensing_class, s.pharmacy_id is not null,
           coalesce(app.finder_fresh(s.confirmed_at), false), s.confirmed_at,
           s.confirmed_at + make_interval(days => app.setting_num('finder.stock_ttl_days', 3)::int),
           (select count(*) from finder_events e where e.kind = 'call' and e.drug_id = d.id and e.pharmacy_id = p_pharmacy
              and e.created_at > now() - interval '30 days')::int,
           (select count(*) from finder_reports r where r.drug_id = d.id and r.pharmacy_id = p_pharmacy
              and r.created_at > now() - interval '30 days')::int
    from finder_drugs d join catalog_products p on p.id = d.product_id
    left join finder_stock s on s.drug_id = d.id and s.pharmacy_id = p_pharmacy
    where d.status = 'active'
    order by (s.pharmacy_id is not null) desc, p.name_fa;
end $$;

-- p_have true = declare / re-confirm now; false = withdraw
create or replace function public.finder_set_stock(p_pharmacy uuid, p_drug uuid, p_have boolean) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from finder_drugs where id = p_drug and status = 'active') then return 'not_listed'; end if;
  if p_have then
    insert into finder_stock (pharmacy_id, drug_id, confirmed_at, confirmed_by) values (p_pharmacy, p_drug, now(), auth.uid())
    on conflict (pharmacy_id, drug_id) do update set confirmed_at = now(), confirmed_by = auth.uid();
  else
    delete from finder_stock where pharmacy_id = p_pharmacy and drug_id = p_drug;
  end if;
  return 'ok';
end $$;

-- re-confirm every declaration at once (also the expired ones still on the list)
create or replace function public.finder_confirm_all(p_pharmacy uuid) returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  update finder_stock s set confirmed_at = now(), confirmed_by = auth.uid()
  where s.pharmacy_id = p_pharmacy and exists (select 1 from finder_drugs d where d.id = s.drug_id and d.status = 'active');
  get diagnostics n = row_count;
  return n;
end $$;

-- suggest a catalogue product for the list: 'pending' | 'added' | 'listed' | 'exists'
create or replace function public.finder_suggest(p_pharmacy uuid, p_product uuid, p_note text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from catalog_products where id = p_product and is_active) then return 'product'; end if;
  if exists (select 1 from finder_drugs where product_id = p_product and status = 'active') then return 'listed'; end if;
  if app.setting_bool('finder.direct_suggestions', false) then
    insert into finder_drugs (product_id, status, origin, added_by) values (p_product, 'active', 'suggestion', auth.uid())
    on conflict (product_id) do update set status = 'active';
    insert into finder_suggestions (product_id, pharmacy_id, suggested_by, note, status, reviewed_at)
    values (p_product, p_pharmacy, auth.uid(), left(nullif(trim(coalesce(p_note, '')), ''), 300), 'approved', now());
    return 'added';
  end if;
  if exists (select 1 from finder_suggestions where product_id = p_product and pharmacy_id = p_pharmacy and status = 'pending') then
    return 'exists';
  end if;
  insert into finder_suggestions (product_id, pharmacy_id, suggested_by, note)
  values (p_product, p_pharmacy, auth.uid(), left(nullif(trim(coalesce(p_note, '')), ''), 300));
  return 'pending';
end $$;

create or replace function public.finder_my_suggestions(p_pharmacy uuid)
returns table (id uuid, name_fa text, status text, review_note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select s.id, p.name_fa, s.status, s.review_note, s.created_at
    from finder_suggestions s join catalog_products p on p.id = s.product_id
    where s.pharmacy_id = p_pharmacy order by s.created_at desc limit 50;
end $$;

-- ---------------------------------------------------------------- Dorva side
create or replace function public.finder_admin_list()
returns table (drug_id uuid, product_id uuid, name_fa text, dispensing_class text, status text, origin text, note text,
               created_at timestamptz, pharmacies_now int, searches_30d int, calls_30d int, reports_30d int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('finder.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select d.id, p.id, p.name_fa, p.dispensing_class, d.status, d.origin, d.note, d.created_at,
           (select count(*) from finder_stock s join pharmacies ph on ph.id = s.pharmacy_id
             where s.drug_id = d.id and ph.status = 'active' and app.finder_fresh(s.confirmed_at))::int,
           (select count(*) from finder_events e where e.drug_id = d.id and e.kind = 'view' and e.created_at > now() - interval '30 days')::int,
           (select count(*) from finder_events e where e.drug_id = d.id and e.kind = 'call' and e.created_at > now() - interval '30 days')::int,
           (select count(*) from finder_reports r where r.drug_id = d.id and r.created_at > now() - interval '30 days')::int
    from finder_drugs d join catalog_products p on p.id = d.product_id
    order by (d.status = 'active') desc, p.name_fa;
end $$;

-- add | on | off for a catalogue product: 'ok' | 'product'
create or replace function public.finder_admin_set(p_product uuid, p_action text, p_note text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('finder.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from catalog_products where id = p_product) then return 'product'; end if;
  if p_action = 'add' or p_action = 'on' then
    insert into finder_drugs (product_id, status, note, added_by)
    values (p_product, 'active', left(nullif(trim(coalesce(p_note, '')), ''), 300), auth.uid())
    on conflict (product_id) do update set status = 'active', note = coalesce(excluded.note, finder_drugs.note);
  elsif p_action = 'off' then
    update finder_drugs set status = 'off' where product_id = p_product;
  else
    return 'action';
  end if;
  return 'ok';
end $$;

create or replace function public.finder_admin_suggestions()
returns table (id uuid, product_id uuid, name_fa text, dispensing_class text, pharmacy_name text, pharmacy_slug text,
               note text, created_at timestamptz, same_count int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('finder.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, p.id, p.name_fa, p.dispensing_class, ph.name_fa, ph.slug::text, s.note, s.created_at,
           (select count(*) from finder_suggestions x where x.product_id = s.product_id and x.status = 'pending')::int
    from finder_suggestions s join catalog_products p on p.id = s.product_id join pharmacies ph on ph.id = s.pharmacy_id
    where s.status = 'pending'
    order by s.created_at;
end $$;

-- approve adds the medicine (and closes every pending suggestion of it); reject needs no note
create or replace function public.finder_admin_decide(p_suggestion uuid, p_approve boolean, p_note text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare s finder_suggestions;
begin
  if not app.has_platform_permission('finder.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from finder_suggestions where id = p_suggestion and status = 'pending' for update;
  if not found then return 'missing'; end if;
  if p_approve then
    insert into finder_drugs (product_id, status, origin, added_by) values (s.product_id, 'active', 'suggestion', auth.uid())
    on conflict (product_id) do update set status = 'active';
    update finder_suggestions set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
                                  review_note = left(nullif(trim(coalesce(p_note, '')), ''), 300)
    where product_id = s.product_id and status = 'pending';
  else
    update finder_suggestions set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
                                  review_note = left(nullif(trim(coalesce(p_note, '')), ''), 300)
    where id = s.id;
  end if;
  return 'ok';
end $$;

-- statistics for the Dorva dashboard (p_pharmacy null) or one pharmacy
create or replace function public.finder_stats(p_pharmacy uuid default null, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_from timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 366));
begin
  if p_pharmacy is null then
    if not (app.has_platform_permission('finder.manage') or app.has_platform_permission('pharmacy.read_all')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  elsif not (app.pharmacy_access(p_pharmacy, 'order.read') or app.finder_can(p_pharmacy)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'searches', (select count(*) from finder_events where kind = 'search' and created_at >= v_from and p_pharmacy is null),
    'views', (select count(*) from finder_events where kind = 'view' and created_at >= v_from
                and (p_pharmacy is null or drug_id in (select drug_id from finder_stock where pharmacy_id = p_pharmacy))),
    'calls', (select count(*) from finder_events where kind = 'call' and created_at >= v_from
                and (p_pharmacy is null or pharmacy_id = p_pharmacy)),
    'reports', (select count(*) from finder_reports where created_at >= v_from and (p_pharmacy is null or pharmacy_id = p_pharmacy)),
    'listed', (select count(*) from finder_drugs where status = 'active'),
    'declared', (select count(*) from finder_stock s where app.finder_fresh(s.confirmed_at) and (p_pharmacy is null or s.pharmacy_id = p_pharmacy)),
    'pending_suggestions', case when p_pharmacy is null then (select count(*) from finder_suggestions where status = 'pending') end,
    'demoted', case when p_pharmacy is null then (select count(*) from pharmacies ph where app.finder_demoted(ph.id))
                    else (case when app.finder_demoted(p_pharmacy) then 1 else 0 end) end,
    'top_drugs', (select coalesce(jsonb_agg(x order by x.views desc), '[]'::jsonb) from (
        select p.name_fa name, count(*) filter (where e.kind = 'view')::int views, count(*) filter (where e.kind = 'call')::int calls
        from finder_events e join finder_drugs d on d.id = e.drug_id join catalog_products p on p.id = d.product_id
        where e.created_at >= v_from and e.kind in ('view', 'call') and (p_pharmacy is null or e.pharmacy_id = p_pharmacy or e.kind = 'view')
        group by p.name_fa order by 2 desc limit 10) x),
    'unmet', case when p_pharmacy is null then (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select query q, count(*)::int n from finder_events where kind = 'search' and created_at >= v_from and coalesce(results, 0) = 0
        group by query order by 2 desc limit 10) x) else '[]'::jsonb end,
    'by_pharmacy', case when p_pharmacy is null then (select coalesce(jsonb_agg(x order by x.calls desc), '[]'::jsonb) from (
        select ph.name_fa name,
               (select count(*) from finder_events e where e.kind = 'call' and e.pharmacy_id = ph.id and e.created_at >= v_from)::int calls,
               (select count(*) from finder_reports r where r.pharmacy_id = ph.id and r.created_at >= v_from)::int reports,
               app.finder_demoted(ph.id) demoted
        from pharmacies ph
        where exists (select 1 from finder_events e where e.kind = 'call' and e.pharmacy_id = ph.id and e.created_at >= v_from)
           or exists (select 1 from finder_reports r where r.pharmacy_id = ph.id and r.created_at >= v_from)
        order by 2 desc limit 15) x) else '[]'::jsonb end);
end $$;

grant execute on function public.finder_search(text, int) to anon, authenticated;
grant execute on function public.finder_drug(uuid) to anon, authenticated;
grant execute on function public.finder_pharmacies(uuid, int, double precision, double precision) to anon, authenticated;
grant execute on function public.finder_log(text, uuid, uuid, text, int, int) to anon, authenticated;
grant execute on function public.finder_report(uuid, uuid, text) to authenticated;
grant execute on function public.finder_pharmacy_list(uuid) to authenticated;
grant execute on function public.finder_set_stock(uuid, uuid, boolean) to authenticated;
grant execute on function public.finder_confirm_all(uuid) to authenticated;
grant execute on function public.finder_suggest(uuid, uuid, text) to authenticated;
grant execute on function public.finder_my_suggestions(uuid) to authenticated;
grant execute on function public.finder_admin_list() to authenticated;
grant execute on function public.finder_admin_set(uuid, text, text) to authenticated;
grant execute on function public.finder_admin_suggestions() to authenticated;
grant execute on function public.finder_admin_decide(uuid, boolean, text) to authenticated;
grant execute on function public.finder_stats(uuid, int) to authenticated;

-- the patient page lives at /<locale>/finder: no pharmacy may take that address
create or replace function app.pharmacy_slug_guard() returns trigger
language plpgsql as $$
begin
  if new.slug::text in ('holding', 'holdings', 'product', 'products', 'orders', 'staff', 'shipping', 'complements',
                        'signin-link', 'finder', 'darooyabi') then
    raise exception 'slug % is reserved', new.slug using errcode = '23514';
  end if;
  return new;
end $$;
