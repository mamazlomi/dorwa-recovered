-- Staff management (Dorva and pharmacies) and holdings.
--
-- Staff
--   * Roles are Dorva templates only (pharmacies pick, they do not invent).
--     Dorva edits the templates; the owner / super-admin templates keep their
--     staff-management permission so nobody can lock everyone out.
--   * People join by e-mail invitation and must accept it themselves.
--   * Nobody grants a role with a permission they do not hold (no escalation).
--   * The last manager of a pharmacy (or of Dorva) cannot be removed, demoted
--     or disabled.
--   * A role that approves medicines (order.tech_approve) needs a licence no.
--   * Memberships change only through these functions; direct writes from the
--     app are refused.
--
-- Holdings
--   * Anyone signed in may create a holding; it asks to link a pharmacy and
--     the pharmacy's manager approves (and may cut it at any time).
--   * A holding sees aggregate figures, stock and prices, and orders without
--     any customer data. It never manages the pharmacy.

set search_path = public, extensions;

-- ---------------------------------------------------------------- guards
-- (not security definer: current_user must stay the caller's role)
create or replace function app.roles_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and coalesce(new.pharmacy_id, old.pharmacy_id) is not null then
    raise exception 'pharmacies use Dorva role templates' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'roles_guard_trg') then
    create trigger roles_guard_trg before insert or update or delete on public.roles
      for each row execute function app.roles_guard();
  end if;
end $$;

-- the managers' templates keep their staff permission
create or replace function app.role_permissions_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare r public.roles;
begin
  select * into r from public.roles where id = coalesce(old.role_id, new.role_id);
  if tg_op in ('DELETE', 'UPDATE') and r.is_system
     and ((r.code = 'owner' and old.permission_code = 'staff.manage')
       or (r.code = 'super_admin' and old.permission_code = 'platform.roles.manage')) then
    raise exception 'this permission cannot be removed from %', r.code using errcode = '42501';
  end if;
  if current_user in ('authenticated', 'anon') and r.pharmacy_id is not null then
    raise exception 'pharmacies use Dorva role templates' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'role_permissions_guard_trg') then
    create trigger role_permissions_guard_trg before insert or update or delete on public.role_permissions
      for each row execute function app.role_permissions_guard();
  end if;
end $$;

alter table public.memberships add column if not exists license_no text;
alter table public.memberships add column if not exists invited_by uuid;
alter table public.memberships add column if not exists updated_at timestamptz not null default now();

create or replace function app.memberships_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'use the staff functions' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'memberships_guard_trg') then
    create trigger memberships_guard_trg before insert or update or delete on public.memberships
      for each row execute function app.memberships_guard();
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function app.can_manage_staff(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_pharmacy is null then app.has_platform_permission('platform.roles.manage')
              else app.has_pharmacy_permission(p_pharmacy, 'staff.manage')
                   or app.has_platform_permission('platform.roles.manage') end;
$$;

-- the caller holds every permission of the role (Dorva's role managers may grant any pharmacy role)
create or replace function app.can_grant_role(p_pharmacy uuid, p_role uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.roles r where r.id = p_role and r.is_system and r.pharmacy_id is null
                   and r.scope = case when p_pharmacy is null then 'platform' else 'pharmacy' end)
     and (case when p_pharmacy is not null and app.has_platform_permission('platform.roles.manage') then true
               else not exists (
                 select 1 from public.role_permissions rp where rp.role_id = p_role
                   and not case when p_pharmacy is null then app.has_platform_permission(rp.permission_code)
                                else app.has_pharmacy_permission(p_pharmacy, rp.permission_code) end) end);
$$;

create or replace function app.role_needs_license(p_role uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.role_permissions where role_id = p_role and permission_code = 'order.tech_approve');
$$;

-- active managers left for a pharmacy (or Dorva) if one membership changed
create or replace function app.managers_left(p_pharmacy uuid, p_except uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(distinct m.user_id)::int from public.memberships m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.status = 'active' and m.id <> coalesce(p_except, '00000000-0000-0000-0000-000000000000'::uuid)
    and m.pharmacy_id is not distinct from p_pharmacy
    and rp.permission_code = case when p_pharmacy is null then 'platform.roles.manage' else 'staff.manage' end;
$$;

create or replace function app.my_email() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(email) from auth.users where id = auth.uid();
$$;

-- ---------------------------------------------------------------- invites
create table if not exists public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  pharmacy_id uuid references public.pharmacies(id) on delete cascade,   -- null = Dorva staff
  role_id     uuid not null references public.roles(id) on delete cascade,
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  license_no  text,
  note        text,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_by  uuid,
  decided_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  decided_at  timestamptz
);
create unique index if not exists staff_invites_pending on public.staff_invites
  (coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email), role_id) where status = 'pending';
alter table public.staff_invites enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'staff_invites' and policyname = 'read') then
    create policy read on public.staff_invites for select to authenticated
      using (app.can_manage_staff(pharmacy_id) or lower(email) = app.my_email());
  end if;
end $$;
grant select on public.staff_invites to authenticated;

create or replace function public.staff_invite(p_pharmacy uuid, p_role uuid, p_email text, p_license text default null, p_note text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text := lower(trim(p_email));
begin
  if not app.can_manage_staff(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'email'; end if;
  if not app.can_grant_role(p_pharmacy, p_role) then return 'role'; end if;
  if app.role_needs_license(p_role) and coalesce(trim(p_license), '') = '' then return 'license'; end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
             where lower(u.email) = v_email and m.role_id = p_role and m.pharmacy_id is not distinct from p_pharmacy) then
    return 'member';
  end if;
  insert into public.staff_invites (pharmacy_id, role_id, email, license_no, note, invited_by)
  values (p_pharmacy, p_role, v_email, nullif(trim(p_license), ''), nullif(trim(p_note), ''), auth.uid())
  on conflict do nothing;
  return 'ok';
end $$;

create or replace function public.staff_invite_revoke(p_invite uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.staff_invites;
begin
  select * into i from public.staff_invites where id = p_invite;
  if not found or not app.can_manage_staff(i.pharmacy_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.staff_invites set status = 'revoked', decided_by = auth.uid(), decided_at = now()
  where id = p_invite and status = 'pending';
end $$;

-- invites waiting for the signed-in user
create or replace function public.my_staff_invites()
returns table (id uuid, pharmacy_id uuid, pharmacy_name text, pharmacy_i18n jsonb, role_name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.id, i.pharmacy_id, ph.name_fa, ph.name_i18n, r.name_fa, i.created_at
  from public.staff_invites i
  join public.roles r on r.id = i.role_id
  left join public.pharmacies ph on ph.id = i.pharmacy_id
  where i.status = 'pending' and i.expires_at > now() and lower(i.email) = app.my_email()
  order by i.created_at desc;
$$;

create or replace function public.staff_invite_answer(p_invite uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.staff_invites;
begin
  select * into i from public.staff_invites where id = p_invite for update;
  if not found or lower(i.email) <> app.my_email() then raise exception 'forbidden' using errcode = '42501'; end if;
  if i.status <> 'pending' then return i.status; end if;
  if i.expires_at <= now() then return 'expired'; end if;
  update public.staff_invites set status = case when p_accept then 'accepted' else 'declined' end,
    decided_by = auth.uid(), decided_at = now() where id = p_invite;
  if p_accept then
    insert into public.memberships (user_id, pharmacy_id, role_id, license_no, invited_by)
    values (auth.uid(), i.pharmacy_id, i.role_id, i.license_no, i.invited_by)
    on conflict do nothing;
  end if;
  return case when p_accept then 'accepted' else 'declined' end;
end $$;

-- ---------------------------------------------------------------- members
create or replace function public.staff_list(p_pharmacy uuid)
returns table (membership_id uuid, user_id uuid, email text, full_name text, role_id uuid, role_code text, role_name text,
               status text, license_no text, created_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.user_id, u.email::text, p.full_name, r.id, r.code, r.name_fa, m.status, m.license_no, m.created_at,
         m.user_id = auth.uid()
  from public.memberships m
  join public.roles r on r.id = m.role_id
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.pharmacy_id is not distinct from p_pharmacy and app.can_manage_staff(p_pharmacy)
  order by m.status, r.name_fa, u.email;
$$;

-- change role, disable/enable or remove one membership
create or replace function public.staff_update(p_membership uuid, p_action text, p_role uuid default null, p_license text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.memberships; v_manager boolean;
begin
  select * into m from public.memberships where id = p_membership for update;
  if not found or not app.can_manage_staff(m.pharmacy_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  -- you may only touch people whose current role you could grant yourself
  if not app.can_grant_role(m.pharmacy_id, m.role_id) then return 'role'; end if;
  v_manager := exists (select 1 from public.role_permissions rp where rp.role_id = m.role_id
                       and rp.permission_code = case when m.pharmacy_id is null then 'platform.roles.manage' else 'staff.manage' end);

  if p_action in ('remove', 'disable') or (p_action = 'role' and p_role is distinct from m.role_id) then
    if v_manager and m.status = 'active' and app.managers_left(m.pharmacy_id, m.id) = 0
       and not (p_action = 'role' and exists (select 1 from public.role_permissions rp where rp.role_id = p_role
               and rp.permission_code = case when m.pharmacy_id is null then 'platform.roles.manage' else 'staff.manage' end)) then
      return 'last_manager';
    end if;
  end if;

  if p_action = 'remove' then
    delete from public.memberships where id = m.id;
  elsif p_action = 'disable' then
    update public.memberships set status = 'disabled', updated_at = now() where id = m.id;
  elsif p_action = 'enable' then
    update public.memberships set status = 'active', updated_at = now() where id = m.id;
  elsif p_action = 'role' then
    if not app.can_grant_role(m.pharmacy_id, p_role) then return 'role'; end if;
    if app.role_needs_license(p_role) and coalesce(trim(coalesce(p_license, m.license_no)), '') = '' then return 'license'; end if;
    if exists (select 1 from public.memberships x where x.user_id = m.user_id and x.role_id = p_role
               and x.pharmacy_id is not distinct from m.pharmacy_id and x.id <> m.id) then return 'member'; end if;
    update public.memberships set role_id = p_role, license_no = coalesce(nullif(trim(p_license), ''), license_no),
      updated_at = now() where id = m.id;
  else
    return 'action';
  end if;
  return 'ok';
end $$;

-- role templates with their permissions (for the role pickers and the admin editor)
create or replace function public.role_templates(p_scope text, p_pharmacy uuid default null)
returns table (id uuid, code text, name_fa text, permissions text[], needs_license boolean, can_grant boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.code, r.name_fa,
         coalesce(array_agg(rp.permission_code order by rp.permission_code) filter (where rp.permission_code is not null), '{}'),
         bool_or(rp.permission_code = 'order.tech_approve') is true,
         app.can_grant_role(case when p_scope = 'platform' then null else p_pharmacy end, r.id)
  from public.roles r left join public.role_permissions rp on rp.role_id = r.id
  where r.scope = p_scope and r.is_system and r.pharmacy_id is null
  group by r.id, r.code, r.name_fa
  order by r.name_fa;
$$;

grant execute on function public.staff_invite(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.staff_invite_revoke(uuid) to authenticated;
grant execute on function public.my_staff_invites() to authenticated;
grant execute on function public.staff_invite_answer(uuid, boolean) to authenticated;
grant execute on function public.staff_list(uuid) to authenticated;
grant execute on function public.staff_update(uuid, text, uuid, text) to authenticated;
grant execute on function public.role_templates(text, uuid) to authenticated;

-- ---------------------------------------------------------------- holdings
create table if not exists public.holdings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 80),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_by  uuid not null,
  created_at  timestamptz not null default now()
);
create table if not exists public.holding_members (
  holding_id  uuid not null references public.holdings(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'admin' check (role in ('admin', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (holding_id, user_id)
);
create table if not exists public.holding_links (
  id           uuid primary key default gen_random_uuid(),
  holding_id   uuid not null references public.holdings(id) on delete cascade,
  pharmacy_id  uuid not null references public.pharmacies(id) on delete cascade,
  status       text not null default 'requested' check (status in ('requested', 'active', 'rejected', 'revoked')),
  message      text,
  requested_by uuid,
  decided_by   uuid,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
-- one active (or pending) link per pharmacy and holding; a pharmacy belongs to one holding at a time
create unique index if not exists holding_links_open on public.holding_links (holding_id, pharmacy_id) where status in ('requested', 'active');
create unique index if not exists holding_links_one_active on public.holding_links (pharmacy_id) where status = 'active';
alter table public.holdings enable row level security;
alter table public.holding_members enable row level security;
alter table public.holding_links enable row level security;

create or replace function app.holding_member(p_holding uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.holding_members hm join public.holdings h on h.id = hm.holding_id
                 where hm.holding_id = p_holding and hm.user_id = auth.uid() and h.status = 'active');
$$;
create or replace function app.holding_admin(p_holding uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.holding_members hm join public.holdings h on h.id = hm.holding_id
                 where hm.holding_id = p_holding and hm.user_id = auth.uid() and hm.role = 'admin' and h.status = 'active');
$$;
create or replace function app.holding_sees(p_holding uuid, p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.holding_member(p_holding)
     and exists (select 1 from public.holding_links l where l.holding_id = p_holding and l.pharmacy_id = p_pharmacy and l.status = 'active');
$$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'holdings' and policyname = 'read') then
    create policy read on public.holdings for select to authenticated
      using (app.holding_member(id) or app.has_platform_permission('pharmacy.read_all')
             or exists (select 1 from public.holding_links l where l.holding_id = holdings.id and app.can_manage_staff(l.pharmacy_id)));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'holding_members' and policyname = 'read') then
    create policy read on public.holding_members for select to authenticated
      using (user_id = auth.uid() or app.holding_admin(holding_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'holding_links' and policyname = 'read') then
    create policy read on public.holding_links for select to authenticated
      using (app.holding_member(holding_id) or app.can_manage_staff(pharmacy_id) or app.has_platform_permission('pharmacy.read_all'));
  end if;
end $$;
grant select on public.holdings, public.holding_members, public.holding_links to authenticated;

insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('holding.max_per_user', 'holding', 'number', null, 0, 20, null,
   '{"fa":"حداکثر هلدینگ برای هر کاربر","en":"Holdings per user, maximum","ar":"أقصى عدد للشركات القابضة لكل مستخدم"}',
   '{"fa":"صفر = ساخت هلدینگ بسته است.","en":"0 = creating holdings is closed.","ar":"0 = إنشاء الشركات القابضة مغلق."}', 950)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('holding.max_per_user', 'platform', '3', 'حداکثر هلدینگ برای هر کاربر')
on conflict do nothing;

create or replace function public.holding_create(p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'login required' using errcode = '42501'; end if;
  if (select count(*) from public.holdings where created_by = auth.uid()) >= app.setting_num('holding.max_per_user', 3) then
    raise exception 'holding limit' using errcode = 'P0001';
  end if;
  insert into public.holdings (name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into public.holding_members (holding_id, user_id, role) values (v_id, auth.uid(), 'admin');
  return v_id;
end $$;

-- the holding asks to link a pharmacy (by its page address)
create or replace function public.holding_request(p_holding uuid, p_slug text, p_message text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ph uuid;
begin
  if not app.holding_admin(p_holding) then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ph from public.pharmacies where slug = lower(trim(p_slug)) and status = 'active';
  if v_ph is null then return 'not_found'; end if;
  if exists (select 1 from public.holding_links where pharmacy_id = v_ph and holding_id = p_holding and status in ('requested', 'active')) then
    return 'exists';
  end if;
  if exists (select 1 from public.holding_links where pharmacy_id = v_ph and status = 'active') then return 'taken'; end if;
  insert into public.holding_links (holding_id, pharmacy_id, message, requested_by)
  values (p_holding, v_ph, nullif(trim(p_message), ''), auth.uid());
  return 'ok';
end $$;

-- the pharmacy manager approves, rejects or cuts a link; the holding may withdraw its own
create or replace function public.holding_link_decide(p_link uuid, p_action text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.holding_links;
begin
  select * into l from public.holding_links where id = p_link for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action in ('approve', 'reject') then
    if not app.can_manage_staff(l.pharmacy_id) then raise exception 'forbidden' using errcode = '42501'; end if;
    if l.status <> 'requested' then return l.status; end if;
    if p_action = 'approve' and exists (select 1 from public.holding_links where pharmacy_id = l.pharmacy_id and status = 'active') then
      return 'taken';
    end if;
    update public.holding_links set status = case when p_action = 'approve' then 'active' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now() where id = p_link;
  elsif p_action = 'revoke' then
    if not (app.can_manage_staff(l.pharmacy_id) or app.holding_admin(l.holding_id)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    update public.holding_links set status = 'revoked', decided_by = auth.uid(), decided_at = now()
    where id = p_link and status in ('requested', 'active');
  else
    return 'action';
  end if;
  return 'ok';
end $$;

-- links waiting for a pharmacy's decision (and active ones), for its staff page
create or replace function public.pharmacy_holding_links(p_pharmacy uuid)
returns table (id uuid, holding_name text, status text, message text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, h.name, l.status, l.message, l.created_at
  from public.holding_links l join public.holdings h on h.id = l.holding_id
  where l.pharmacy_id = p_pharmacy and l.status in ('requested', 'active') and app.can_manage_staff(p_pharmacy)
  order by l.status, l.created_at desc;
$$;

-- aggregate figures per linked pharmacy for a period
create or replace function public.holding_stats(p_holding uuid, p_days int default 30)
returns table (pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, orders int, delivered int, cancelled int,
               items_total numeric, shipping_total numeric, dorva_amount numeric, pharmacy_amount numeric,
               tech_reviewed int, tech_rejected int, stock_lines int, out_of_stock int)
language sql stable security definer set search_path = public, pg_temp as $$
  with ph as (
    select p.* from public.holding_links l join public.pharmacies p on p.id = l.pharmacy_id
    where l.holding_id = p_holding and l.status = 'active' and app.holding_member(p_holding)
  ),
  parts as (
    select op.* from public.order_parts op join public.orders o on o.id = op.order_id
    where op.pharmacy_id in (select id from ph) and op.status <> 'awaiting_payment'
      and o.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 366))
  )
  select ph.id, ph.slug::text, ph.name_fa, ph.name_i18n,
         (select count(*) from parts x where x.pharmacy_id = ph.id)::int,
         (select count(*) from parts x where x.pharmacy_id = ph.id and x.status = 'delivered')::int,
         (select count(*) from parts x where x.pharmacy_id = ph.id and x.status = 'cancelled')::int,
         coalesce((select sum(i.line_total) from public.order_items i join parts x on x.id = i.part_id
                   where x.pharmacy_id = ph.id and i.tech_status <> 'rejected'), 0),
         coalesce((select sum(x.shipping_fee) from parts x where x.pharmacy_id = ph.id and x.status <> 'cancelled'), 0),
         coalesce((select sum(s.dorva_amount) from public.settlements s join parts x on x.id = s.part_id where x.pharmacy_id = ph.id), 0),
         coalesce((select sum(s.pharmacy_amount) from public.settlements s join parts x on x.id = s.part_id where x.pharmacy_id = ph.id), 0),
         (select count(*) from public.order_items i join parts x on x.id = i.part_id
           where x.pharmacy_id = ph.id and i.tech_status in ('approved', 'rejected'))::int,
         (select count(*) from public.order_items i join parts x on x.id = i.part_id
           where x.pharmacy_id = ph.id and i.tech_status = 'rejected')::int,
         (select count(*) from public.stock_items s where s.pharmacy_id = ph.id)::int,
         (select count(*) from public.stock_items s where s.pharmacy_id = ph.id and s.quantity = 0)::int
  from ph order by ph.name_fa;
$$;

-- stock and prices of one linked pharmacy (read only)
create or replace function public.holding_stock(p_holding uuid, p_pharmacy uuid)
returns table (product_id uuid, name_fa text, dispensing_class text, quantity int, list_price numeric,
               discount_pct numeric, final_price numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.name_fa, p.dispensing_class, s.quantity, coalesce(s.price, l.base_price),
         s.discount_pct, o.final_price
  from public.stock_items s
  join public.catalog_products p on p.id = s.product_id
  left join public.product_listings l on l.product_id = s.product_id
  left join app.offers o on o.pharmacy_id = s.pharmacy_id and o.product_id = s.product_id
  where s.pharmacy_id = p_pharmacy and app.holding_sees(p_holding, p_pharmacy)
  order by p.name_fa
  limit 2000;
$$;

-- orders of one linked pharmacy, without anything about the customer
create or replace function public.holding_orders(p_holding uuid, p_pharmacy uuid, p_limit int default 100)
returns table (order_no text, created_at timestamptz, status text, kind text, subtotal numeric, shipping_fee numeric,
               items jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.order_no, o.created_at, op.status, op.kind, op.subtotal, op.shipping_fee,
         coalesce((select jsonb_agg(jsonb_build_object('name', i.name_fa, 'qty', i.qty, 'line_total', i.line_total,
                                                        'tech_status', i.tech_status) order by i.name_fa)
                   from public.order_items i where i.part_id = op.id), '[]'::jsonb)
  from public.order_parts op join public.orders o on o.id = op.order_id
  where op.pharmacy_id = p_pharmacy and op.status <> 'awaiting_payment' and app.holding_sees(p_holding, p_pharmacy)
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

grant execute on function public.holding_create(text) to authenticated;
grant execute on function public.holding_request(uuid, text, text) to authenticated;
grant execute on function public.holding_link_decide(uuid, text) to authenticated;
grant execute on function public.pharmacy_holding_links(uuid) to authenticated;
grant execute on function public.holding_stats(uuid, int) to authenticated;
grant execute on function public.holding_stock(uuid, uuid) to authenticated;
grant execute on function public.holding_orders(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------- reserved page addresses
-- newer app routes that a pharmacy slug must not shadow
create or replace function app.pharmacy_slug_guard() returns trigger
language plpgsql as $$
begin
  if new.slug::text in ('holding', 'holdings', 'product', 'products', 'orders', 'staff', 'shipping', 'complements', 'signin-link') then
    raise exception 'slug % is reserved', new.slug using errcode = '23514';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pharmacy_slug_guard_trg') then
    create trigger pharmacy_slug_guard_trg before insert or update of slug on public.pharmacies
      for each row execute function app.pharmacy_slug_guard();
  end if;
end $$;
