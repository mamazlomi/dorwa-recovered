-- Round 6: Dorva supervises, it does not edit.
--  * Dorva staff no longer open or change a pharmacy's page, look, collections or
--    profile. The only exception is a virtual (test) pharmacy that Dorva runs.
--  * Per content type, Dorva sets a policy: free / approval / locked
--    (profile, technical officer, page layout, look, collections). Default: approval.
--    Until Dorva approves, the published version stays on the site.
--  * Technical officers get their own account (invited by e-mail) and edit their
--    professional profile themselves; owners can still edit it. Both go to review.
--  * approval_inbox(): what is waiting for Dorva, per queue, for the reminder badge.

set search_path = public, extensions;

-- ---------------------------------------------------------------- policy settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort)
select k, 'moderation', 'enum',
  '[{"value":"approval","label":{"fa":"نیاز به تأیید دوروا","en":"Needs Dorva approval","ar":"يحتاج موافقة دوروا"}},
    {"value":"free","label":{"fa":"آزاد (بدون تأیید)","en":"Free (no review)","ar":"حر (دون مراجعة)"}},
    {"value":"locked","label":{"fa":"قفل (داروخانه نمی‌تواند تغییر دهد)","en":"Locked (pharmacies cannot change it)","ar":"مقفل (لا يمكن للصيدلية التغيير)"}}]'::jsonb,
  null, null, null, l::jsonb, h::jsonb, s
from (values
  ('moderation.profile', '{"fa":"پروفایل داروخانه (متن معرفی، تماس، ساعات، خدمات، عکس‌ها)","en":"Pharmacy profile (about, contact, hours, services, photos)","ar":"ملف الصيدلية"}',
   '{"fa":"تا تأیید، نسخه قبلی روی سایت می‌ماند. داروخانه‌ای که هنوز تأیید نشده آزادانه پروفایل را پر می‌کند و همه آن هنگام تأیید ثبت‌نام بررسی می‌شود.","en":"The previous version stays live until approved. Pharmacies not yet approved fill their profile freely; it is reviewed with the registration.","ar":"تبقى النسخة السابقة حتى الموافقة."}', 700),
  ('moderation.officer', '{"fa":"پرونده مسئول فنی (ویرایش توسط خود مسئول فنی)","en":"Technical officer profile (edited by the officer)","ar":"ملف الصيدلي المسؤول"}',
   '{"fa":"نام، عکس، معرفی و پرونده حرفه‌ای که خود داروساز با حساب خودش ویرایش می‌کند.","en":"Name, photo, bio and professional profile edited by the pharmacist.","ar":"الاسم والصورة والتعريف."}', 701),
  ('moderation.page', '{"fa":"چیدمان صفحه داروخانه","en":"Pharmacy page layout","ar":"تخطيط صفحة الصيدلية"}', null, 702),
  ('moderation.look', '{"fa":"ظاهر داروخانه (رنگ، لوگو، کاور)","en":"Pharmacy look (colour, logo, cover)","ar":"مظهر الصيدلية"}', null, 703),
  ('moderation.collection', '{"fa":"مجموعه‌های داروخانه (عنوان و توضیح)","en":"Pharmacy collections (title and description)","ar":"مجموعات الصيدلية"}',
   '{"fa":"انتشار اول و تغییر عنوان/توضیح بررسی می‌شود؛ مجموعه تا تأیید دیده نمی‌شود. تغییر قواعد کالاها آزاد است.","en":"First publication and title/description changes are reviewed; hidden until approved. Product rules change freely.","ar":"تُراجع أول نشر وتغيير العنوان."}', 704)
) v(k, l, h, s)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
  ('moderation.profile', 'platform', '"approval"', 'سیاست پروفایل داروخانه'),
  ('moderation.officer', 'platform', '"approval"', 'سیاست پرونده مسئول فنی'),
  ('moderation.page', 'platform',
   case when coalesce((select value #>> '{}' from settings where key = 'pages.pharmacy_approval' and scope = 'platform'), 'true') = 'false'
        then '"free"'::jsonb else '"approval"'::jsonb end, 'سیاست چیدمان صفحه داروخانه'),
  ('moderation.look', 'platform',
   case when coalesce((select value #>> '{}' from settings where key = 'theme.pharmacy_approval' and scope = 'platform'), 'true') = 'false'
        then '"free"'::jsonb else '"approval"'::jsonb end, 'سیاست ظاهر داروخانه'),
  ('moderation.collection', 'platform', '"approval"', 'سیاست مجموعه‌های داروخانه')
on conflict do nothing;

create or replace function app.mod_mode(p_kind text) returns text
language sql stable set search_path = public, pg_temp as $$
  select coalesce(nullif(app.setting('moderation.' || p_kind) #>> '{}', ''), 'approval');
$$;

-- Dorva runs its own virtual (test) pharmacies; there its staff act as the pharmacy
create or replace function app.is_dorva_operator(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_pharmacy is not null and app.has_platform_permission('pharmacy.read_all')
     and exists (select 1 from public.pharmacies where id = p_pharmacy and is_virtual);
$$;

-- ---------------------------------------------------------------- who may edit (no Dorva override)
create or replace function app.can_edit_page(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_pharmacy is null then app.has_platform_permission('pages.manage')
    else app.is_dorva_operator(p_pharmacy)
      or (app.setting_bool('pages.pharmacy_enabled', true) and app.has_pharmacy_permission(p_pharmacy, 'pharmacy.pages.manage'))
  end;
$$;

create or replace function app.can_edit_look(p_ph uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_dorva_operator(p_ph)
      or (app.setting_bool('theme.pharmacy_enabled', true) and app.has_pharmacy_permission(p_ph, 'pharmacy.pages.manage'));
$$;

create or replace function app.can_manage_collection(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_pharmacy is null then app.has_platform_permission('collections.manage')
    else app.is_dorva_operator(p_pharmacy) or app.has_pharmacy_permission(p_pharmacy, 'pharmacy.collections.manage') end;
$$;

create or replace function app.can_edit_profile(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_pharmacy_permission(p_pharmacy, 'pharmacy.update_profile') or app.is_dorva_operator(p_pharmacy);
$$;

-- does a change by the current user to this pharmacy's content need review?
-- 'direct' | 'review' | 'locked'
create or replace function app.mod_route(p_pharmacy uuid, p_kind text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_pharmacy is null or app.is_dorva_operator(p_pharmacy) then 'direct'
    when app.mod_mode(p_kind) = 'locked' then 'locked'
    when app.mod_mode(p_kind) = 'free' then 'direct'
    else 'review' end;
$$;

-- ---------------------------------------------------------------- page layout
create or replace function public.page_editor(p_pharmacy uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r page_layouts; v_edit boolean := app.can_edit_page(p_pharmacy);
begin
  -- Dorva reviewers may read a pharmacy's draft to preview it, never save it
  if not v_edit and not (p_pharmacy is not null and app.has_platform_permission('pages.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from page_layouts where pharmacy_id is not distinct from p_pharmacy;
  return jsonb_build_object(
    'draft', coalesce(r.draft, '[]'::jsonb), 'published', r.published, 'status', coalesce(r.status, 'draft'),
    'review_note', r.review_note, 'updated_at', r.updated_at, 'published_at', r.published_at,
    'can_edit', v_edit, 'mode', case when p_pharmacy is null then 'direct' else app.mod_route(p_pharmacy, 'page') end,
    'needs_approval', p_pharmacy is not null and app.mod_route(p_pharmacy, 'page') = 'review',
    'allowed', case when p_pharmacy is null or app.is_dorva_operator(p_pharmacy)
                 then '["banner","features","categories","products","tabs","text"]'::jsonb
                 else (select coalesce(jsonb_agg(t), '[]'::jsonb) from unnest(array['banner', 'features', 'categories', 'products', 'tabs', 'text']) t
                       where app.setting_bool('pages.ph_' || t, true)) end,
    'max_blocks', app.setting_num('pages.max_blocks', 15), 'max_slides', app.setting_num('pages.max_slides', 5));
end $$;

create or replace function public.page_save(p_pharmacy uuid, p_blocks jsonb) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if not app.can_edit_page(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if app.mod_route(p_pharmacy, 'page') = 'locked' then return 'locked'; end if;
  v := app.page_validate(p_pharmacy, p_blocks);
  if v <> 'ok' then return v; end if;
  insert into page_layouts (pharmacy_id, draft, status, updated_by, updated_at)
  values (p_pharmacy, p_blocks, 'draft', auth.uid(), now())
  on conflict ((coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  do update set draft = excluded.draft, updated_by = excluded.updated_by, updated_at = now(),
                status = case when page_layouts.status in ('pending', 'rejected') then 'draft'
                              when page_layouts.status = 'published' and page_layouts.published = excluded.draft then 'published'
                              else 'draft' end;
  return 'ok';
end $$;

create or replace function public.page_publish(p_pharmacy uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r page_layouts; v text; v_route text := app.mod_route(p_pharmacy, 'page');
begin
  if not app.can_edit_page(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_route = 'locked' then return 'locked'; end if;
  select * into r from page_layouts where pharmacy_id is not distinct from p_pharmacy for update;
  if not found then return 'block'; end if;
  v := app.page_validate(p_pharmacy, r.draft);
  if v <> 'ok' then return v; end if;
  if v_route = 'review' then
    update page_layouts set status = 'pending', submitted_at = now(), review_note = null where id = r.id;
    return 'pending';
  end if;
  update page_layouts set published = draft, status = 'published', published_at = now(), review_note = null,
                          reviewed_by = auth.uid() where id = r.id;
  return 'published';
end $$;

-- ---------------------------------------------------------------- look
create or replace function public.pharmacy_look_editor(p_pharmacy uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r pharmacy_looks; v_edit boolean := app.can_edit_look(p_pharmacy);
begin
  if not v_edit and not app.has_platform_permission('theme.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from pharmacy_looks where pharmacy_id = p_pharmacy;
  return jsonb_build_object('draft', coalesce(r.draft, '{}'::jsonb), 'published', r.published, 'status', coalesce(r.status, 'draft'),
    'review_note', r.review_note, 'can_edit', v_edit, 'mode', app.mod_route(p_pharmacy, 'look'),
    'needs_approval', app.mod_route(p_pharmacy, 'look') = 'review');
end $$;

create or replace function public.pharmacy_look_save(p_pharmacy uuid, p_draft jsonb, p_submit boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare chk text; v_route text := app.mod_route(p_pharmacy, 'look');
begin
  if not app.can_edit_look(p_pharmacy) then return 'forbidden'; end if;
  if v_route = 'locked' then return 'locked'; end if;
  chk := app.pharmacy_look_ok(p_pharmacy, coalesce(p_draft, '{}'::jsonb));
  if chk <> 'ok' then return chk; end if;
  insert into pharmacy_looks (pharmacy_id, draft, status, updated_by, updated_at)
  values (p_pharmacy, p_draft, 'draft', auth.uid(), now())
  on conflict (pharmacy_id) do update set draft = excluded.draft, updated_by = excluded.updated_by, updated_at = now(),
    status = case when pharmacy_looks.status = 'pending' then 'draft' else pharmacy_looks.status end;
  if not p_submit then return 'ok'; end if;
  if v_route = 'direct' then
    update pharmacy_looks set published = draft, status = 'published', published_at = now(), review_note = null where pharmacy_id = p_pharmacy;
    return 'published';
  end if;
  update pharmacy_looks set status = 'pending', submitted_at = now() where pharmacy_id = p_pharmacy;
  return 'pending';
end $$;

-- ---------------------------------------------------------------- collections
alter table public.collections drop constraint if exists collections_status_check;
alter table public.collections add constraint collections_status_check
  check (status in ('draft', 'published', 'archived', 'pending', 'rejected'));
alter table public.collections add column if not exists review_note text check (review_note is null or length(review_note) <= 500);
alter table public.collections add column if not exists submitted_at timestamptz;

-- a pharmacy's own staff: first publication and changed title/description wait for review
create or replace function app.collection_moderate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_route text; v_text_changed boolean;
begin
  if new.pharmacy_id is null or auth.uid() is null
     or not app.has_pharmacy_permission(new.pharmacy_id, 'pharmacy.collections.manage') then
    return new;
  end if;
  v_route := app.mod_route(new.pharmacy_id, 'collection');
  if v_route = 'direct' then return new; end if;
  if v_route = 'locked' then
    if tg_op = 'UPDATE' and new.status = 'archived' and (to_jsonb(new) - 'status' - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'status' - 'updated_at' - 'updated_by') then
      return new;
    end if;
    raise exception 'collections are locked by Dorva' using errcode = '42501';
  end if;
  v_text_changed := tg_op = 'INSERT' or (new.title, new.description, new.slug) is distinct from (old.title, old.description, old.slug);
  if new.status in ('published', 'pending') and (tg_op = 'INSERT' or old.status not in ('published') or v_text_changed) then
    if tg_op = 'UPDATE' and old.status = 'pending' and not v_text_changed and new.status = 'pending' then return new; end if;
    new.status := 'pending';
    new.submitted_at := now();
    new.review_note := null;
  end if;
  return new;
end $$;
drop trigger if exists collections_moderate on public.collections;
create trigger collections_moderate before insert or update on public.collections
  for each row execute function app.collection_moderate();

create or replace function public.collection_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('collections.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'description', c.description,
           'pharmacy', jsonb_build_object('id', p.id, 'slug', p.slug, 'name_fa', p.name_fa), 'submitted_at', c.submitted_at,
           'rules', jsonb_array_length(c.rules), 'include', cardinality(c.include_ids)) order by c.submitted_at)
    from collections c join pharmacies p on p.id = c.pharmacy_id where c.status = 'pending'), '[]');
end $$;

create or replace function public.collection_review(p_id uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if not app.has_platform_permission('collections.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not p_approve and length(coalesce(v_note, '')) < 5 then return 'note'; end if;
  update collections set status = case when p_approve then 'published' else 'rejected' end, review_note = v_note, updated_at = now()
   where id = p_id and status = 'pending' and pharmacy_id is not null;
  return case when found then 'ok' else 'not_pending' end;
end $$;

-- ---------------------------------------------------------------- officers: accounts
alter table public.pharmacy_officers add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.pharmacy_officers add column if not exists invite_email text
  check (invite_email is null or invite_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
create index if not exists pharmacy_officers_user on public.pharmacy_officers (user_id) where user_id is not null;

-- a file path an officer row may point to: the pharmacy's folder, the linked person's own
-- folder, or the value already stored (approved earlier)
create or replace function app.officer_file_ok(p_pharmacy uuid, p_officer uuid, p_path text, p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_path, '') = ''
      or (p_kind = 'photo' and p_path ~ ('^' || p_pharmacy::text || '/'))
      or (p_kind = 'resume' and p_path ~ ('^' || p_pharmacy::text || '/resume-'))
      or exists (select 1 from pharmacy_officers o where o.id = p_officer
                 and ((p_kind = 'photo' and o.photo = p_path) or (p_kind = 'resume' and o.resume = p_path)
                      or (p_kind = 'photo' and o.user_id is not null and p_path ~ ('^' || o.user_id::text || '/'))));
$$;

-- ---------------------------------------------------------------- profile: apply / snapshot / review
create table if not exists public.pharmacy_profile_changes (
  pharmacy_id  uuid primary key references public.pharmacies(id) on delete cascade,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'rejected')),
  note         text check (note is null or length(note) <= 1000),
  submitted_by uuid default auth.uid(),
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz
);
alter table public.pharmacy_profile_changes enable row level security;
revoke all on public.pharmacy_profile_changes from anon, authenticated;

create or replace function app.profile_snapshot(p_pharmacy uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id, 'slug', r.slug, 'name_fa', r.name_fa, 'name_i18n', r.name_i18n, 'phone', r.phone, 'address', r.address,
    'lat', r.lat, 'lng', r.lng, 'city_id', r.city_id, 'founder_name', r.founder_name, 'about_fa', r.about_fa,
    'about_i18n', r.about_i18n, 'hours', coalesce(r.opening_hours, '{}'), 'kind_codes', to_jsonb(r.kind_codes),
    'services', to_jsonb(r.services), 'service_codes', to_jsonb(r.service_codes),
    'insurers', coalesce((select jsonb_agg(insurer_code order by insurer_code) from pharmacy_insurers where pharmacy_id = r.id), '[]'),
    'officers', coalesce((select jsonb_agg(to_jsonb(o) - 'pharmacy_id' - 'updated_at' order by o.sort)
                          from pharmacy_officers o where o.pharmacy_id = r.id), '[]'))
  from public.pharmacies r where r.id = p_pharmacy;
$$;

-- writes a profile payload; no permission check (callers check)
-- 'ok' | 'location' | 'hours' | 'officer' | 'value'
create or replace function app.profile_apply(p_pharmacy uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; v_hours jsonb := coalesce(p->'hours', '{}'); n int := 0;
  v_oid uuid; v_keep uuid[] := '{}';
begin
  if coalesce(p->>'lat', '') !~ '^[0-9.]+$' or coalesce(p->>'lng', '') !~ '^[0-9.]+$'
     or (p->>'lat')::double precision not between 24 and 40.5 or (p->>'lng')::double precision not between 44 and 63.5 then
    return 'location';
  end if;
  if jsonb_typeof(v_hours) <> 'object' or not app.shifts_ok(coalesce(v_hours->'shifts', '[]')) then return 'hours'; end if;
  for o in select * from jsonb_array_elements(coalesce(p->'officers', '[]')) loop
    v_oid := case when coalesce(o->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (o->>'id')::uuid end;
    if length(trim(coalesce(o->>'full_name', ''))) < 2 or not app.shifts_ok(coalesce(o->'shifts', '[]'))
       or not app.officer_file_ok(p_pharmacy, v_oid, o->>'photo', 'photo')
       or not app.officer_file_ok(p_pharmacy, v_oid, o->>'resume', 'resume')
       or (o ? 'profile' and jsonb_typeof(o->'profile') not in ('object', 'null'))
       or (coalesce(o->>'invite_email', '') <> '' and o->>'invite_email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
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
      service_codes = coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p->'service_codes', '[]')) x
                                where x in (select code from pharmacy_service_options where active)), '{}'),
      services = coalesce((select array_agg(left(x, 60)) from (select x from jsonb_array_elements_text(coalesce(p->'services', '[]')) x
                           where length(trim(x)) > 0 limit 20) s), '{}'),
      technical_officer_name = coalesce((select o2->>'full_name' from jsonb_array_elements(coalesce(p->'officers', '[]')) o2 limit 1), technical_officer_name),
      technical_officer_license = coalesce((select nullif(o2->>'council_no', '') from jsonb_array_elements(coalesce(p->'officers', '[]')) o2 limit 1), technical_officer_license),
      updated_at = now()
    where id = p_pharmacy;
    delete from public.pharmacy_insurers where pharmacy_id = p_pharmacy;
    insert into public.pharmacy_insurers (pharmacy_id, insurer_code)
    select p_pharmacy, x from jsonb_array_elements_text(coalesce(p->'insurers', '[]')) x
    where x in (select code from insurers) on conflict do nothing;
    for o in select * from jsonb_array_elements(coalesce(p->'officers', '[]')) loop
      n := n + 1;
      v_oid := case when coalesce(o->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (o->>'id')::uuid end;
      if v_oid is not null and exists (select 1 from public.pharmacy_officers where id = v_oid and pharmacy_id <> p_pharmacy) then
        v_oid := null;
      end if;
      insert into public.pharmacy_officers (id, pharmacy_id, full_name, council_no, photo, bio, shifts, sort, profile, resume, invite_email, updated_at)
      values (coalesce(v_oid, gen_random_uuid()), p_pharmacy, trim(o->>'full_name'), nullif(trim(o->>'council_no'), ''), nullif(o->>'photo', ''),
              nullif(trim(o->>'bio'), ''), coalesce(o->'shifts', '[]'), n,
              case when jsonb_typeof(o->'profile') = 'object' then o->'profile' else '{}'::jsonb end,
              nullif(o->>'resume', ''), nullif(lower(trim(coalesce(o->>'invite_email', ''))), ''), now())
      on conflict (id) do update set full_name = excluded.full_name, council_no = excluded.council_no, photo = excluded.photo,
        bio = excluded.bio, shifts = excluded.shifts, sort = excluded.sort, profile = excluded.profile, resume = excluded.resume,
        -- a changed or cleared e-mail unlinks the account
        user_id = case when excluded.invite_email is not distinct from pharmacy_officers.invite_email then pharmacy_officers.user_id end,
        invite_email = excluded.invite_email, updated_at = now()
      returning id into v_oid;
      v_keep := v_keep || v_oid;
    end loop;
    delete from public.pharmacy_officers where pharmacy_id = p_pharmacy and not (id = any(v_keep));
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range or string_data_right_truncation then
    return 'value';
  end;
  return 'ok';
end $$;

-- the editor sees its pending draft (if any) and why a draft was rejected
create or replace function public.pharmacy_profile_get(p_pharmacy uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c pharmacy_profile_changes;
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from pharmacy_profile_changes where pharmacy_id = p_pharmacy;
  return app.profile_snapshot(p_pharmacy) || jsonb_build_object(
    'mode', app.mod_route(p_pharmacy, 'profile'),
    'change', case when c.pharmacy_id is null then null else jsonb_build_object(
      'payload', c.payload, 'status', c.status, 'note', c.note, 'submitted_at', c.submitted_at) end);
end $$;

-- 'ok' (live) | 'pending' (waiting for Dorva) | 'locked' | a validation code
create or replace function public.pharmacy_profile_save(p_pharmacy uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text; v_route text;
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_route := app.mod_route(p_pharmacy, 'profile');
  -- before the pharmacy is approved, its profile is reviewed together with the registration
  if v_route = 'review' and (select status from pharmacies where id = p_pharmacy) <> 'active' then v_route := 'direct'; end if;
  if v_route = 'locked' then return 'locked'; end if;
  if v_route = 'direct' then
    v := app.profile_apply(p_pharmacy, p);
    if v = 'ok' then delete from pharmacy_profile_changes where pharmacy_id = p_pharmacy; end if;
    return v;
  end if;
  -- dry run: validate everything, then undo
  begin
    v := app.profile_apply(p_pharmacy, p);
    raise exception 'dorva_dry_run';
  exception when raise_exception then
    if sqlerrm <> 'dorva_dry_run' then raise; end if;
  end;
  if v <> 'ok' then return v; end if;
  insert into pharmacy_profile_changes (pharmacy_id, payload, status, note, submitted_by, submitted_at, reviewed_by, reviewed_at)
  values (p_pharmacy, p, 'pending', null, auth.uid(), now(), null, null)
  on conflict (pharmacy_id) do update set payload = excluded.payload, status = 'pending', note = null,
    submitted_by = excluded.submitted_by, submitted_at = now(), reviewed_by = null, reviewed_at = null;
  return 'pending';
end $$;

create or replace function public.profile_change_cancel(p_pharmacy uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from pharmacy_profile_changes where pharmacy_id = p_pharmacy;
  return 'ok';
end $$;

create or replace function public.profile_change_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('pharmacy.approve') then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('pharmacy', jsonb_build_object('id', p.id, 'slug', p.slug, 'name_fa', p.name_fa),
           'submitted_at', c.submitted_at, 'payload', c.payload, 'live', app.profile_snapshot(p.id)) order by c.submitted_at)
    from pharmacy_profile_changes c join pharmacies p on p.id = c.pharmacy_id where c.status = 'pending'), '[]');
end $$;

create or replace function public.profile_change_review(p_pharmacy uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c pharmacy_profile_changes; v text; v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if not app.has_platform_permission('pharmacy.approve') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from pharmacy_profile_changes where pharmacy_id = p_pharmacy and status = 'pending' for update;
  if not found then return 'not_pending'; end if;
  if not p_approve then
    if length(coalesce(v_note, '')) < 5 then return 'note'; end if;
    update pharmacy_profile_changes set status = 'rejected', note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
     where pharmacy_id = p_pharmacy;
    return 'ok';
  end if;
  v := app.profile_apply(p_pharmacy, c.payload);
  if v <> 'ok' then return v; end if;
  delete from pharmacy_profile_changes where pharmacy_id = p_pharmacy;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- officer self-service
create table if not exists public.officer_changes (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'rejected')),
  note         text check (note is null or length(note) <= 1000),
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid,
  reviewed_at  timestamptz
);
alter table public.officer_changes enable row level security;
revoke all on public.officer_changes from anon, authenticated;

create or replace function public.my_officer_invites() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'full_name', o.full_name, 'pharmacy', p.name_fa, 'pharmacy_i18n', p.name_i18n)), '[]')
  from pharmacy_officers o join pharmacies p on p.id = o.pharmacy_id
  where o.user_id is null and o.invite_email is not null and lower(o.invite_email) = app.my_email();
$$;

create or replace function public.officer_invite_answer(p_officer uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  update pharmacy_officers
     set user_id = case when p_accept then auth.uid() end,
         invite_email = case when p_accept then invite_email end
   where id = p_officer and user_id is null and lower(coalesce(invite_email, '')) = app.my_email();
  return case when found then 'ok' else 'missing' end;
end $$;

-- the signed-in pharmacist's own profile (from their first linked officer row) and pending change
create or replace function public.my_officer_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not exists (select 1 from pharmacy_officers where user_id = auth.uid()) then null else jsonb_build_object(
    'officer', (select to_jsonb(o) - 'pharmacy_id' - 'updated_at' - 'shifts' - 'invite_email' - 'sort'
                from pharmacy_officers o where o.user_id = auth.uid() order by o.updated_at desc limit 1),
    'pharmacies', (select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name_fa', p.name_fa, 'name_i18n', p.name_i18n, 'status', p.status))
                   from pharmacy_officers o join pharmacies p on p.id = o.pharmacy_id where o.user_id = auth.uid()),
    'mode', app.mod_mode('officer'),
    'change', (select jsonb_build_object('payload', c.payload, 'status', c.status, 'note', c.note, 'submitted_at', c.submitted_at)
               from officer_changes c where c.user_id = auth.uid())) end;
$$;

create or replace function app.officer_apply(p_user uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update pharmacy_officers set
    full_name = trim(p->>'full_name'), council_no = nullif(trim(coalesce(p->>'council_no', '')), ''),
    photo = nullif(p->>'photo', ''), bio = nullif(trim(coalesce(p->>'bio', '')), ''),
    profile = case when jsonb_typeof(p->'profile') = 'object' then p->'profile' else profile end,
    resume = nullif(p->>'resume', ''), updated_at = now()
  where user_id = p_user;
  return 'ok';
exception when check_violation or string_data_right_truncation then
  return 'value';
end $$;

-- 'ok' | 'pending' | 'locked' | 'none' | 'value' | 'file'
create or replace function public.officer_self_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text; v_mode text := app.mod_mode('officer');
begin
  if not exists (select 1 from pharmacy_officers where user_id = auth.uid()) then return 'none'; end if;
  if length(trim(coalesce(p->>'full_name', ''))) < 2 then return 'value'; end if;
  -- files: the person's own photo folder or a linked pharmacy's folder, or unchanged
  if coalesce(p->>'photo', '') <> '' and p->>'photo' !~ ('^' || auth.uid()::text || '/')
     and not exists (select 1 from pharmacy_officers o where o.user_id = auth.uid()
                     and (o.photo = p->>'photo' or p->>'photo' ~ ('^' || o.pharmacy_id::text || '/'))) then
    return 'file';
  end if;
  if coalesce(p->>'resume', '') <> ''
     and not exists (select 1 from pharmacy_officers o where o.user_id = auth.uid()
                     and (o.resume = p->>'resume' or p->>'resume' ~ ('^' || o.pharmacy_id::text || '/resume-[a-z0-9]{8,40}\.(pdf|docx)$'))) then
    return 'file';
  end if;
  if v_mode = 'locked' then return 'locked'; end if;
  begin
    v := app.officer_apply(auth.uid(), p);
    if v_mode <> 'free' then raise exception 'dorva_dry_run'; end if;
  exception when raise_exception then
    if sqlerrm <> 'dorva_dry_run' then raise; end if;
  end;
  if v <> 'ok' or v_mode = 'free' then
    if v = 'ok' then delete from officer_changes where user_id = auth.uid(); end if;
    return v;
  end if;
  insert into officer_changes (user_id, payload, status, note, submitted_at, reviewed_by, reviewed_at)
  values (auth.uid(), p, 'pending', null, now(), null, null)
  on conflict (user_id) do update set payload = excluded.payload, status = 'pending', note = null, submitted_at = now(),
    reviewed_by = null, reviewed_at = null;
  return 'pending';
end $$;

create or replace function public.officer_change_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('pharmacy.approve') then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'submitted_at', c.submitted_at, 'payload', c.payload,
           'live', (select to_jsonb(o) - 'pharmacy_id' - 'updated_at' from pharmacy_officers o where o.user_id = c.user_id order by o.updated_at desc limit 1),
           'pharmacies', (select jsonb_agg(p.name_fa) from pharmacy_officers o join pharmacies p on p.id = o.pharmacy_id where o.user_id = c.user_id))
         order by c.submitted_at)
    from officer_changes c where c.status = 'pending'), '[]');
end $$;

create or replace function public.officer_change_review(p_user uuid, p_approve boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c officer_changes; v text; v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if not app.has_platform_permission('pharmacy.approve') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from officer_changes where user_id = p_user and status = 'pending' for update;
  if not found then return 'not_pending'; end if;
  if not p_approve then
    if length(coalesce(v_note, '')) < 5 then return 'note'; end if;
    update officer_changes set status = 'rejected', note = v_note, reviewed_by = auth.uid(), reviewed_at = now() where user_id = p_user;
    return 'ok';
  end if;
  v := app.officer_apply(p_user, c.payload);
  if v <> 'ok' then return v; end if;
  delete from officer_changes where user_id = p_user;
  return 'ok';
end $$;

-- resumes: a linked pharmacist may also upload into a linked pharmacy's folder
create or replace function app.officer_doc_ok(p_folder text, p_read boolean default false) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(p_folder, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else app.can_edit_profile(p_folder::uuid)
      or exists (select 1 from pharmacy_officers o where o.user_id = auth.uid() and o.pharmacy_id = p_folder::uuid)
      or (p_read and app.has_platform_permission('pharmacy.read_all')) end;
$$;

-- one row per person in the bank (a pharmacist in two pharmacies appears once)
create or replace function public.pharmacist_bank(p_q text default null, p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not app.has_platform_permission('pharmacy.read_all') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(distinct coalesce(user_id::text, id::text)) from pharmacy_officers),
    'consented', (select count(distinct coalesce(user_id::text, id::text)) from pharmacy_officers where coalesce((profile->>'consent')::boolean, false)),
    'rows', coalesce((select jsonb_agg(x order by x->>'full_name') from (
      select distinct on (coalesce(o.user_id::text, o.id::text))
             jsonb_build_object('id', o.id, 'full_name', o.full_name, 'council_no', o.council_no, 'resume', o.resume,
               'profile', o.profile - 'resume_text', 'has_resume_text', length(coalesce(o.profile->>'resume_text', '')) > 0,
               'has_account', o.user_id is not null,
               'pharmacy', jsonb_build_object('id', ph.id, 'slug', ph.slug, 'name_fa', ph.name_fa, 'status', ph.status),
               'city', c.name_fa, 'updated_at', o.updated_at) x
      from pharmacy_officers o
      join pharmacies ph on ph.id = o.pharmacy_id
      left join cities c on c.id = ph.city_id
      where (p_all or coalesce((o.profile->>'consent')::boolean, false))
        and (v_q is null or o.full_name ilike '%' || v_q || '%' or coalesce(o.council_no, '') ilike '%' || v_q || '%'
             or o.profile::text ilike '%' || v_q || '%' or ph.name_fa ilike '%' || v_q || '%' or coalesce(c.name_fa, '') ilike '%' || v_q || '%')
      order by coalesce(o.user_id::text, o.id::text), o.updated_at desc
      limit 500) t), '[]'));
end $$;

-- ---------------------------------------------------------------- the reminder: what waits for Dorva
create or replace function public.approval_inbox() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb := '{}'::jsonb;
begin
  if app.has_platform_permission('pharmacy.approve') then
    r := r || jsonb_build_object(
      'pharmacies', (select count(*) from pharmacies where status = 'pending'),
      'profiles', (select count(*) from pharmacy_profile_changes where status = 'pending'),
      'officers', (select count(*) from officer_changes where status = 'pending'));
  end if;
  if app.has_platform_permission('pages.manage') then
    r := r || jsonb_build_object('pages', (select count(*) from page_layouts where pharmacy_id is not null and status = 'pending'));
  end if;
  if app.has_platform_permission('theme.manage') then
    r := r || jsonb_build_object('looks', (select count(*) from pharmacy_looks where status = 'pending'));
  end if;
  if app.has_platform_permission('collections.manage') then
    r := r || jsonb_build_object('collections', (select count(*) from collections where pharmacy_id is not null and status = 'pending'));
  end if;
  if app.has_platform_permission('policy.manage') then
    r := r || jsonb_build_object('prices', (select count(*) from stock_items where price_requested is not null));
  end if;
  if app.has_platform_permission('catalog.publish') then
    r := r || jsonb_build_object('codes', (select count(*) from product_codes where status = 'pending'));
  end if;
  return r;
end $$;

revoke execute on function public.collection_queue() from anon, public;
revoke execute on function public.collection_review(uuid, boolean, text) from anon, public;
revoke execute on function public.profile_change_cancel(uuid) from anon, public;
revoke execute on function public.profile_change_queue() from anon, public;
revoke execute on function public.profile_change_review(uuid, boolean, text) from anon, public;
revoke execute on function public.my_officer_invites() from anon, public;
revoke execute on function public.officer_invite_answer(uuid, boolean) from anon, public;
revoke execute on function public.my_officer_profile() from anon, public;
revoke execute on function public.officer_self_save(jsonb) from anon, public;
revoke execute on function public.officer_change_queue() from anon, public;
revoke execute on function public.officer_change_review(uuid, boolean, text) from anon, public;
revoke execute on function public.approval_inbox() from anon, public;
grant execute on function public.collection_queue() to authenticated;
grant execute on function public.collection_review(uuid, boolean, text) to authenticated;
grant execute on function public.profile_change_cancel(uuid) to authenticated;
grant execute on function public.profile_change_queue() to authenticated;
grant execute on function public.profile_change_review(uuid, boolean, text) to authenticated;
grant execute on function public.my_officer_invites() to authenticated;
grant execute on function public.officer_invite_answer(uuid, boolean) to authenticated;
grant execute on function public.my_officer_profile() to authenticated;
grant execute on function public.officer_self_save(jsonb) to authenticated;
grant execute on function public.officer_change_queue() to authenticated;
grant execute on function public.officer_change_review(uuid, boolean, text) to authenticated;
grant execute on function public.approval_inbox() to authenticated;
grant execute on function public.pharmacy_profile_get(uuid) to authenticated;
grant execute on function public.pharmacy_profile_save(uuid, jsonb) to authenticated;
grant execute on function public.page_editor(uuid) to authenticated;
grant execute on function public.page_save(uuid, jsonb) to authenticated;
grant execute on function public.page_publish(uuid) to authenticated;
grant execute on function public.pharmacy_look_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.pharmacist_bank(text, boolean) to authenticated;
