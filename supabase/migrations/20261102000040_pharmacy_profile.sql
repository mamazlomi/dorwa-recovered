-- Full pharmacy profile: founder, kinds (24-hour, oncology, MS …), insurers and
-- kinds as lists Dorva edits in settings, opening hours, several technical
-- officers with shifts, photos and council numbers, and an "about" text.

set search_path = public, extensions;

-- ---------------------------------------------------------------- lists Dorva manages
alter table public.insurers add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.insurers add column if not exists sort int not null default 100;
alter table public.insurers add column if not exists active boolean not null default true;

create table if not exists public.pharmacy_kinds (
  code       text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name_fa    text not null check (length(trim(name_fa)) between 2 and 60),
  name_i18n  jsonb not null default '{}'::jsonb,
  sort       int not null default 100,
  active     boolean not null default true
);
alter table public.pharmacy_kinds enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'pharmacy_kinds' and policyname = 'read') then
    create policy read on public.pharmacy_kinds for select using (true);
  end if;
end $$;
grant select on public.pharmacy_kinds to anon, authenticated;

insert into public.pharmacy_kinds (code, name_fa, name_i18n, sort) values
  ('round_clock', 'شبانه‌روزی', '{"en":"24-hour","ar":"على مدار الساعة"}', 10),
  ('oncology', 'داروهای سرطانی (تخصصی)', '{"en":"Oncology medicines","ar":"أدوية السرطان"}', 20),
  ('ms', 'داروهای ام‌اس', '{"en":"MS medicines","ar":"أدوية التصلب المتعدد"}', 30),
  ('special', 'داروهای خاص و تک‌نسخه‌ای', '{"en":"Special & single-prescription medicines","ar":"الأدوية الخاصة"}', 40),
  ('hospital', 'بیمارستانی', '{"en":"Hospital pharmacy","ar":"صيدلية مستشفى"}', 50),
  ('herbal', 'گیاهی و طب سنتی', '{"en":"Herbal","ar":"أعشاب"}', 60),
  ('cosmetic', 'آرایشی و بهداشتی تخصصی', '{"en":"Cosmetics specialist","ar":"مستحضرات التجميل"}', 70),
  ('veterinary', 'دامپزشکی', '{"en":"Veterinary","ar":"بيطري"}', 80),
  ('compounding', 'ساخت دارو (ترکیبی)', '{"en":"Compounding","ar":"تركيب الأدوية"}', 90)
on conflict (code) do nothing;

update public.insurers set name_i18n = case code
  when 'tamin' then '{"en":"Social Security","ar":"الضمان الاجتماعي"}'::jsonb
  when 'salamat' then '{"en":"Iran Health Insurance","ar":"تأمين سلامت"}'::jsonb
  when 'armed' then '{"en":"Armed Forces","ar":"القوات المسلحة"}'::jsonb
  when 'imam_khomeini' then '{"en":"Relief Committee","ar":"لجنة الإمداد"}'::jsonb
  when 'supplementary' then '{"en":"Supplementary insurance","ar":"تأمين تكميلي"}'::jsonb
  else name_i18n end
where name_i18n = '{}'::jsonb;

-- 'ok' | 'code' | 'name' | 'used'
create or replace function public.ref_list_save(p_kind text, p_code text, p_name_fa text, p_i18n jsonb default '{}',
                                               p_sort int default 100, p_active boolean default true) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_code, '') !~ '^[a-z0-9_]{2,40}$' then return 'code'; end if;
  if length(trim(coalesce(p_name_fa, ''))) not between 2 and 60 then return 'name'; end if;
  if p_kind = 'insurer' then
    insert into insurers (code, name_fa, name_i18n, sort, active) values (p_code, trim(p_name_fa), coalesce(p_i18n, '{}'), p_sort, p_active)
    on conflict (code) do update set name_fa = excluded.name_fa, name_i18n = excluded.name_i18n, sort = excluded.sort, active = excluded.active;
  elsif p_kind = 'kind' then
    insert into pharmacy_kinds (code, name_fa, name_i18n, sort, active) values (p_code, trim(p_name_fa), coalesce(p_i18n, '{}'), p_sort, p_active)
    on conflict (code) do update set name_fa = excluded.name_fa, name_i18n = excluded.name_i18n, sort = excluded.sort, active = excluded.active;
  else
    return 'code';
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- pharmacy fields
alter table public.pharmacies add column if not exists founder_name text check (founder_name is null or length(founder_name) <= 80);
alter table public.pharmacies add column if not exists kind_codes text[] not null default '{}';
alter table public.pharmacies add column if not exists about_i18n jsonb not null default '{}'::jsonb;
alter table public.pharmacies add column if not exists services text[] not null default '{}';

create table if not exists public.pharmacy_officers (
  id           uuid primary key default gen_random_uuid(),
  pharmacy_id  uuid not null references public.pharmacies(id) on delete cascade,
  full_name    text not null check (length(trim(full_name)) between 2 and 80),
  council_no   text check (council_no is null or length(council_no) <= 30),
  photo        text check (photo is null or photo ~ '^[0-9a-f-]{36}/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$'),
  bio          text check (bio is null or length(bio) <= 600),
  shifts       jsonb not null default '[]'::jsonb check (jsonb_typeof(shifts) = 'array'),
  sort         int not null default 0
);
create index if not exists pharmacy_officers_ph on public.pharmacy_officers (pharmacy_id, sort);
alter table public.pharmacy_officers enable row level security;

-- hours / shifts: [{"days":[0..6], "from":"08:00", "to":"22:00"}]  (0 = Saturday)
create or replace function app.shifts_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 14 and not exists (
    select 1 from jsonb_array_elements(p) s
    where jsonb_typeof(s) <> 'object'
       or jsonb_typeof(s->'days') <> 'array'
       or exists (select 1 from jsonb_array_elements(s->'days') d where jsonb_typeof(d) <> 'number' or d::text::int not between 0 and 6)
       or coalesce(s->>'from', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(s->>'to', '') !~ '^([01][0-9]|2[0-4]):[0-5][0-9]$');
$$;

create or replace function app.can_edit_profile(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_pharmacy_permission(p_pharmacy, 'pharmacy.update_profile')
      or app.has_platform_permission('pharmacy.approve')
      or (app.has_platform_permission('pharmacy.read_all')
          and exists (select 1 from public.pharmacies where id = p_pharmacy and is_virtual));
$$;

-- everything the profile editor needs
create or replace function public.pharmacy_profile_get(p_pharmacy uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.pharmacies;
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.pharmacies where id = p_pharmacy;
  return jsonb_build_object(
    'id', r.id, 'slug', r.slug, 'name_fa', r.name_fa, 'name_i18n', r.name_i18n, 'phone', r.phone, 'address', r.address,
    'lat', r.lat, 'lng', r.lng, 'city_id', r.city_id, 'founder_name', r.founder_name, 'about_fa', r.about_fa,
    'about_i18n', r.about_i18n, 'hours', coalesce(r.opening_hours, '{}'), 'kind_codes', to_jsonb(r.kind_codes),
    'services', to_jsonb(r.services),
    'insurers', coalesce((select jsonb_agg(insurer_code) from pharmacy_insurers where pharmacy_id = r.id), '[]'),
    'officers', coalesce((select jsonb_agg(to_jsonb(o) - 'pharmacy_id' order by o.sort) from pharmacy_officers o where o.pharmacy_id = r.id), '[]'));
end $$;

-- 'ok' | 'location' | 'hours' | 'officer' | 'value'
create or replace function public.pharmacy_profile_save(p_pharmacy uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; v_hours jsonb := coalesce(p->'hours', '{}'); n int := 0; v_img text := '^' || p_pharmacy::text || '/';
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p->>'lat', '') !~ '^[0-9.]+$' or coalesce(p->>'lng', '') !~ '^[0-9.]+$'
     or (p->>'lat')::double precision not between 24 and 40.5 or (p->>'lng')::double precision not between 44 and 63.5 then
    return 'location';
  end if;
  if jsonb_typeof(v_hours) <> 'object' or not app.shifts_ok(coalesce(v_hours->'shifts', '[]')) then return 'hours'; end if;
  for o in select * from jsonb_array_elements(coalesce(p->'officers', '[]')) loop
    if length(trim(coalesce(o->>'full_name', ''))) < 2 or not app.shifts_ok(coalesce(o->'shifts', '[]'))
       or (coalesce(o->>'photo', '') <> '' and o->>'photo' !~ v_img) then
      return 'officer';
    end if;
  end loop;
  begin
    update public.pharmacies set
      phone = nullif(trim(p->>'phone'), ''), address = nullif(trim(p->>'address'), ''),
      lat = (p->>'lat')::double precision, lng = (p->>'lng')::double precision,
      founder_name = nullif(trim(p->>'founder_name'), ''),
      about_fa = nullif(left(trim(coalesce(p->>'about_fa', '')), 3000), ''),
      about_i18n = coalesce(p->'about_i18n', '{}'),
      opening_hours = jsonb_build_object('always', coalesce((v_hours->>'always')::boolean, false), 'shifts', coalesce(v_hours->'shifts', '[]'),
                                         'note', left(coalesce(v_hours->>'note', ''), 120)),
      kind_codes = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'kind_codes', '[]')) x
                             where x in (select code from pharmacy_kinds where active)), '{}'),
      services = coalesce((select array_agg(left(x, 60)) from jsonb_array_elements_text(coalesce(p->'services', '[]')) x
                           where length(trim(x)) > 0), '{}'),
      technical_officer_name = coalesce((select o2->>'full_name' from jsonb_array_elements(coalesce(p->'officers', '[]')) o2 limit 1), technical_officer_name),
      technical_officer_license = coalesce((select nullif(o2->>'council_no', '') from jsonb_array_elements(coalesce(p->'officers', '[]')) o2 limit 1), technical_officer_license),
      updated_at = now()
    where id = p_pharmacy;
    delete from public.pharmacy_insurers where pharmacy_id = p_pharmacy;
    insert into public.pharmacy_insurers (pharmacy_id, insurer_code)
    select p_pharmacy, x from jsonb_array_elements_text(coalesce(p->'insurers', '[]')) x
    where x in (select code from insurers) on conflict do nothing;
    delete from public.pharmacy_officers where pharmacy_id = p_pharmacy;
    for o in select * from jsonb_array_elements(coalesce(p->'officers', '[]')) loop
      n := n + 1;
      insert into public.pharmacy_officers (pharmacy_id, full_name, council_no, photo, bio, shifts, sort)
      values (p_pharmacy, trim(o->>'full_name'), nullif(trim(o->>'council_no'), ''), nullif(o->>'photo', ''),
              nullif(trim(o->>'bio'), ''), coalesce(o->'shifts', '[]'), n);
    end loop;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return 'value';
  end;
  return 'ok';
end $$;

-- the public "about" tab
create or replace function public.pharmacy_about_public(p_pharmacy uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'founder_name', r.founder_name, 'about_fa', r.about_fa, 'about_i18n', r.about_i18n, 'hours', coalesce(r.opening_hours, '{}'),
    'phone', r.phone, 'address', r.address, 'lat', r.lat, 'lng', r.lng, 'services', to_jsonb(r.services),
    'kinds', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name_fa', k.name_fa, 'name_i18n', k.name_i18n) order by k.sort)
                       from pharmacy_kinds k where k.code = any(r.kind_codes) and k.active), '[]'),
    'officers', coalesce((select jsonb_agg(jsonb_build_object('full_name', o.full_name, 'council_no', o.council_no, 'photo', o.photo,
                                                                'bio', o.bio, 'shifts', o.shifts) order by o.sort)
                          from pharmacy_officers o where o.pharmacy_id = r.id), '[]'))
  from public.pharmacies r where r.id = p_pharmacy and (r.status = 'active' or app.can_edit_profile(r.id));
$$;

grant execute on function public.ref_list_save(text, text, text, jsonb, int, boolean) to authenticated;
grant execute on function public.pharmacy_profile_get(uuid) to authenticated;
grant execute on function public.pharmacy_profile_save(uuid, jsonb) to authenticated;
grant execute on function public.pharmacy_about_public(uuid) to anon, authenticated;
