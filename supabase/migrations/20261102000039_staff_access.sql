-- Staff, round 2:
--  * invite first, decide access later ("no access yet" template),
--  * tick permissions per person on top of a template (grants and removals),
--  * a staff profile / CV with photo, chosen by the person to show on the pharmacy page.

set search_path = public, extensions;

-- ---------------------------------------------------------------- templates
insert into public.roles (scope, code, name_fa, is_system)
select s, 'no_access', 'بدون دسترسی (در انتظار تعیین)', true from (values ('platform'), ('pharmacy')) v(s)
where not exists (select 1 from public.roles r where r.scope = v.s and r.pharmacy_id is null and r.code = 'no_access');

-- groups for the permission ticks (labels live in the app dictionary)
alter table public.permissions add column if not exists grp text;
update public.permissions set grp = case
  when code in ('pharmacy.update_profile', 'pharmacy.settings.manage', 'pharmacy.pages.manage', 'pharmacy.collections.manage') then 'shop'
  when code in ('inventory.read', 'inventory.manage') then 'inventory'
  when code in ('order.read', 'order.tech_approve', 'prescription.dispense', 'delivery.confirm') then 'orders'
  when code in ('staff.manage', 'platform.roles.manage') then 'staff'
  when code in ('pharmacy.finder.manage', 'finder.manage') then 'finder'
  when code in ('pharmacy.read_all', 'pharmacy.approve', 'inventory.read_all') then 'pharmacies'
  when code in ('catalog.publish', 'collections.manage') then 'catalog'
  when code in ('policy.manage', 'audit.read') then 'money'
  when code in ('settings.manage', 'theme.manage', 'pages.manage') then 'site'
  else 'other' end;

-- ---------------------------------------------------------------- per-person adjustments
create table if not exists public.membership_permissions (
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted         boolean not null,
  primary key (membership_id, permission_code)
);
alter table public.membership_permissions enable row level security;   -- through the functions below only

-- does this membership carry the permission (template, then the person's own ticks)?
create or replace function app.member_has(p_membership uuid, p_role uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select mp.granted from public.membership_permissions mp where mp.membership_id = p_membership and mp.permission_code = p_code),
    exists (select 1 from public.role_permissions rp where rp.role_id = p_role and rp.permission_code = p_code));
$$;

create or replace function app.member_perms(p_membership uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(c order by c), '{}') from (
    select rp.permission_code c from public.memberships m join public.role_permissions rp on rp.role_id = m.role_id
    where m.id = p_membership
      and not exists (select 1 from public.membership_permissions mp where mp.membership_id = m.id
                      and mp.permission_code = rp.permission_code and not mp.granted)
    union
    select mp.permission_code from public.membership_permissions mp where mp.membership_id = p_membership and mp.granted) x;
$$;

create or replace function app.has_platform_permission(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.pharmacy_id is null and m.status = 'active'
      and app.member_has(m.id, m.role_id, p_code));
$$;

create or replace function app.has_pharmacy_permission(p_pharmacy uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.pharmacy_id = p_pharmacy and m.status = 'active'
      and app.member_has(m.id, m.role_id, p_code));
$$;

create or replace function public.my_platform_permissions() returns text[]
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(array_agg(distinct c order by c), '{}')
  from public.memberships m cross join lateral unnest(app.member_perms(m.id)) c
  where m.user_id = auth.uid() and m.pharmacy_id is null and m.status = 'active';
$$;

-- what the signed-in user may do in one pharmacy (drives which panel links show)
create or replace function public.my_pharmacy_permissions(p_pharmacy uuid) returns text[]
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(array_agg(distinct c order by c), '{}')
  from public.memberships m cross join lateral unnest(app.member_perms(m.id)) c
  where m.user_id = auth.uid() and m.pharmacy_id = p_pharmacy and m.status = 'active';
$$;

create or replace function app.managers_left(p_pharmacy uuid, p_except uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(distinct m.user_id)::int from public.memberships m
  where m.status = 'active' and m.id <> coalesce(p_except, '00000000-0000-0000-0000-000000000000'::uuid)
    and m.pharmacy_id is not distinct from p_pharmacy
    and app.member_has(m.id, m.role_id, case when p_pharmacy is null then 'platform.roles.manage' else 'staff.manage' end);
$$;

-- may the caller give this permission? (holds it; Dorva's role managers may give any pharmacy permission)
create or replace function app.can_grant_perm(p_pharmacy uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.permissions p where p.code = p_code
                   and p.scope = case when p_pharmacy is null then 'platform' else 'pharmacy' end)
     and case when p_pharmacy is null then app.has_platform_permission(p_code)
              else app.has_platform_permission('platform.roles.manage') or app.has_pharmacy_permission(p_pharmacy, p_code) end;
$$;

-- ---------------------------------------------------------------- invite without a role
create or replace function public.staff_invite(p_pharmacy uuid, p_role uuid, p_email text, p_license text default null, p_note text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(trim(p_email)); v_role uuid := p_role;
begin
  if not app.can_manage_staff(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'email'; end if;
  if v_role is null then   -- access is decided after they join
    select id into v_role from public.roles where is_system and pharmacy_id is null and code = 'no_access'
      and scope = case when p_pharmacy is null then 'platform' else 'pharmacy' end;
  end if;
  if not app.can_grant_role(p_pharmacy, v_role) then return 'role'; end if;
  if app.role_needs_license(v_role) and coalesce(trim(p_license), '') = '' then return 'license'; end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where lower(u.email) = v_email and m.pharmacy_id is not distinct from p_pharmacy) then
    return 'member';
  end if;
  insert into public.staff_invites (pharmacy_id, role_id, email, license_no, note, invited_by)
  values (p_pharmacy, v_role, v_email, nullif(trim(p_license), ''), nullif(trim(p_note), ''), auth.uid())
  on conflict do nothing;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- set one person's access
-- template + exact list of permissions; 'ok' | 'role' | 'perm' | 'higher' | 'last_manager' | 'license'
create or replace function public.staff_set_access(p_membership uuid, p_role uuid, p_perms text[], p_license text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.memberships; v_role uuid; v_mgr text; v_want text[]; c text; v_lic text;
  v_dorva_mgr boolean := app.has_platform_permission('platform.roles.manage');
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found or not app.can_manage_staff(m.pharmacy_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_mgr := case when m.pharmacy_id is null then 'platform.roles.manage' else 'staff.manage' end;
  v_role := coalesce(p_role, m.role_id);
  if v_role <> m.role_id and not app.can_grant_role(m.pharmacy_id, v_role) then return 'role'; end if;
  v_want := coalesce((select array_agg(distinct x) from unnest(coalesce(p_perms, '{}')) x where x is not null), '{}');

  -- you may only change people who have nothing you lack, and only give what you have
  if not (m.pharmacy_id is not null and v_dorva_mgr) then
    foreach c in array app.member_perms(m.id) loop
      if not app.can_grant_perm(m.pharmacy_id, c) then return 'higher'; end if;
    end loop;
  end if;
  foreach c in array v_want loop
    if not app.can_grant_perm(m.pharmacy_id, c) then return 'perm'; end if;
  end loop;

  if m.status = 'active' and app.member_has(m.id, m.role_id, v_mgr) and not (v_mgr = any(v_want))
     and app.managers_left(m.pharmacy_id, m.id) = 0 then
    return 'last_manager';
  end if;
  v_lic := coalesce(nullif(trim(p_license), ''), m.license_no);
  if 'order.tech_approve' = any(v_want) and coalesce(v_lic, '') = '' then return 'license'; end if;

  update public.memberships set role_id = v_role, license_no = v_lic, updated_at = now() where id = m.id;
  delete from public.membership_permissions where membership_id = m.id;
  insert into public.membership_permissions (membership_id, permission_code, granted)
  select m.id, x, true from unnest(v_want) x
  where not exists (select 1 from public.role_permissions rp where rp.role_id = v_role and rp.permission_code = x)
  union all
  select m.id, rp.permission_code, false from public.role_permissions rp
  where rp.role_id = v_role and not (rp.permission_code = any(v_want));
  return 'ok';
end $$;

-- the permission list for the ticks
create or replace function public.permission_catalog(p_scope text, p_pharmacy uuid default null)
returns table (code text, grp text, description_fa text, can_grant boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.code, coalesce(p.grp, 'other'), p.description_fa,
         app.can_grant_perm(case when p_scope = 'platform' then null else p_pharmacy end, p.code)
  from public.permissions p
  where p.scope = p_scope and app.can_manage_staff(case when p_scope = 'platform' then null else p_pharmacy end)
  order by p.grp, p.code;
$$;

-- ---------------------------------------------------------------- staff profiles
create table if not exists public.staff_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  photo       text check (photo is null or photo ~ '^[0-9a-f-]{36}/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$'),
  phone       text check (phone is null or length(phone) <= 30),
  education   text check (education is null or length(education) <= 600),
  experience  text check (experience is null or length(experience) <= 1500),
  expertise   text[] not null default '{}'
              check (expertise <@ array['drug', 'supplement', 'cosmetic', 'food', 'equipment', 'herbal', 'consult']),
  council_no  text check (council_no is null or length(council_no) <= 30),
  bio         text check (bio is null or length(bio) <= 800),
  is_public   boolean not null default false,
  updated_at  timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;

create or replace function public.my_staff_profile() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('full_name', (select full_name from public.profiles where id = auth.uid()))
         || coalesce((select to_jsonb(s) - 'user_id' - 'updated_at' from public.staff_profiles s where s.user_id = auth.uid()), '{}'::jsonb);
$$;

-- 'ok' | 'photo' | 'value'
create or replace function public.staff_profile_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_photo text := nullif(p->>'photo', '');
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_photo is not null and split_part(v_photo, '/', 1) <> auth.uid()::text then return 'photo'; end if;
  begin
    insert into public.profiles (id, full_name) values (auth.uid(), nullif(left(trim(coalesce(p->>'full_name', '')), 80), ''))
    on conflict (id) do update set full_name = excluded.full_name;
    insert into public.staff_profiles (user_id, photo, phone, education, experience, expertise, council_no, bio, is_public, updated_at)
    values (auth.uid(), v_photo, nullif(trim(p->>'phone'), ''), nullif(trim(p->>'education'), ''), nullif(trim(p->>'experience'), ''),
            coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'expertise', '[]')) x), '{}'),
            nullif(trim(p->>'council_no'), ''), nullif(trim(p->>'bio'), ''), coalesce((p->>'is_public')::boolean, false), now())
    on conflict (user_id) do update set photo = excluded.photo, phone = excluded.phone, education = excluded.education,
      experience = excluded.experience, expertise = excluded.expertise, council_no = excluded.council_no, bio = excluded.bio,
      is_public = excluded.is_public, updated_at = now();
  exception when check_violation or invalid_text_representation then
    return 'value';
  end;
  return 'ok';
end $$;

-- staff list with effective permissions and the person's profile (for managers)
drop function if exists public.staff_list(uuid);
create or replace function public.staff_list(p_pharmacy uuid)
returns table (membership_id uuid, user_id uuid, email text, full_name text, role_id uuid, role_code text, role_name text,
               status text, license_no text, created_at timestamptz, is_me boolean, perms text[], custom boolean, profile jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.user_id, u.email::text, p.full_name, r.id, r.code, r.name_fa, m.status, m.license_no, m.created_at,
         m.user_id = auth.uid(), app.member_perms(m.id),
         exists (select 1 from public.membership_permissions mp where mp.membership_id = m.id),
         (select to_jsonb(s) - 'user_id' from public.staff_profiles s where s.user_id = m.user_id)
  from public.memberships m
  join public.roles r on r.id = m.role_id
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.pharmacy_id is not distinct from p_pharmacy and app.can_manage_staff(p_pharmacy)
  order by m.status, r.name_fa, u.email;
$$;

-- people a pharmacy shows on its page (they chose to be public)
create or replace function public.pharmacy_team_public(p_pharmacy uuid)
returns table (full_name text, role_name text, photo text, expertise text[], bio text, council_no text, education text)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p.full_name, ''), r.name_fa, s.photo, s.expertise, s.bio,
         case when app.member_has(m.id, m.role_id, 'order.tech_approve') then coalesce(s.council_no, m.license_no) end,
         s.education
  from public.memberships m
  join public.roles r on r.id = m.role_id
  join public.staff_profiles s on s.user_id = m.user_id and s.is_public
  left join public.profiles p on p.id = m.user_id
  join public.pharmacies ph on ph.id = m.pharmacy_id and ph.status = 'active'
  where m.pharmacy_id = p_pharmacy and m.status = 'active' and coalesce(p.full_name, '') <> ''
  order by app.member_has(m.id, m.role_id, 'staff.manage') desc, r.name_fa, p.full_name;
$$;

-- a person may upload their own photo into page-media/<their id>/
create or replace function app.page_media_folder_ok(p_folder text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_folder = 'home' then app.can_edit_page(null)
              when p_folder = 'theme' then app.has_platform_permission('theme.manage')
              when auth.uid() is not null and p_folder = auth.uid()::text then true
              when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then app.can_edit_page(p_folder::uuid) or app.can_edit_look(p_folder::uuid)
                     or app.has_pharmacy_permission(p_folder::uuid, 'pharmacy.update_profile')
                     or app.has_platform_permission('pharmacy.approve')
              else false end;
$$;

grant execute on function public.staff_set_access(uuid, uuid, text[], text) to authenticated;
grant execute on function public.permission_catalog(text, uuid) to authenticated;
grant execute on function public.my_staff_profile() to authenticated;
grant execute on function public.staff_profile_save(jsonb) to authenticated;
grant execute on function public.staff_list(uuid) to authenticated;
grant execute on function public.pharmacy_team_public(uuid) to anon, authenticated;
grant execute on function public.my_pharmacy_permissions(uuid) to authenticated;
