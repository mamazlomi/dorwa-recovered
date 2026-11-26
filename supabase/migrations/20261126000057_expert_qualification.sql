-- 057: who may review (qualification), and how a reviewer is monitored, warned, paused or removed.
--  * being a member / pharmacy staff / customer does NOT make anyone a reviewer: Dorva staff grant it (with a written basis)
--  * a verified pharmacist (active pharmacy technical officer with a licence) is qualified once and stays qualified
--  * every change is logged; the reviewer sees the status and the feedback, never the staff-only note
--  * late claims and wrong reviews are strikes; too many in the window pauses the reviewer automatically (all numbers in Settings)

alter table public.consult_experts
  add column if not exists basis text not null default 'granted' check (basis in ('granted','pharmacist_verified')),
  add column if not exists qualification_note text check (qualification_note is null or length(qualification_note) <= 600),
  add column if not exists status_reason text check (status_reason is null or length(status_reason) <= 600),
  add column if not exists status_changed_at timestamptz,
  add column if not exists paused_until timestamptz;
alter table public.consult_experts drop constraint if exists consult_experts_status_check;
alter table public.consult_experts add constraint consult_experts_status_check
  check (status in ('pending','approved','suspended','paused','removed'));

-- ---------------------------------------------------------------- is this person a verified pharmacist?
create or replace function app.is_verified_pharmacist(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    join public.pharmacies ph on ph.id = m.pharmacy_id and ph.status = 'active'
    where m.user_id = p_user and m.status = 'active'
      and coalesce(trim(m.license_no), '') <> ''
      and app.member_has(m.id, m.role_id, 'order.tech_approve'));
$$;

-- active = approved, or a pause that has run out
create or replace function app.is_consult_expert() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.consult_experts
                 where user_id = auth.uid()
                   and (status = 'approved' or (status = 'paused' and paused_until is not null and paused_until <= now())));
$$;

-- ---------------------------------------------------------------- event log (feedback lives here)
create table if not exists public.reviewer_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('applied','approved','rejected','suspended','paused','reinstated','removed','warning','late','wrong','unclear','good')),
  source        text check (source in ('forum','answer')),
  source_id     uuid,
  note          text check (note is null or length(note) <= 800),       -- the reviewer sees this
  internal_note text check (internal_note is null or length(internal_note) <= 800),  -- staff only
  by_user       uuid references auth.users(id) on delete set null,
  auto          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists reviewer_events_user_idx on public.reviewer_events (user_id, created_at desc);
create unique index if not exists reviewer_events_audit_once on public.reviewer_events (source, source_id)
  where kind in ('good','wrong','unclear') and source_id is not null;
alter table public.reviewer_events enable row level security;
revoke all on public.reviewer_events from anon, authenticated;

-- ---------------------------------------------------------------- guard: status moves only through the functions below
create or replace function app.guard_consult_expert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_int boolean := coalesce(current_setting('app.reviewer_internal', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_int then
      new.reviewed_by := null; new.reviewed_at := null; new.status_reason := null; new.paused_until := null;
      new.qualification_note := null; new.status_changed_at := now();
      if new.specialty = 'pharmacist' and app.setting_bool('reviewer.auto_pharmacist', true)
         and app.is_verified_pharmacist(new.user_id) then
        new.status := 'approved'; new.basis := 'pharmacist_verified';
      else
        new.status := 'pending'; new.basis := 'granted';
      end if;
    end if;
    return new;
  end if;
  if not v_int then
    if new.status is distinct from old.status or new.basis is distinct from old.basis
       or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at
       or new.status_reason is distinct from old.status_reason or new.paused_until is distinct from old.paused_until
       or new.status_changed_at is distinct from old.status_changed_at
       or new.qualification_note is distinct from old.qualification_note or new.user_id is distinct from old.user_id then
      raise exception 'status changes go through reviewer_set_status()' using errcode = '42501';
    end if;
    if (new.specialty is distinct from old.specialty or new.license_no is distinct from old.license_no)
       and old.status <> 'pending' and not app.can_manage_consult() then
      raise exception 'specialty and licence are changed by Dorva staff' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function app.log_event(p_user uuid, p_kind text, p_source text, p_source_id uuid,
                                         p_note text, p_internal text, p_auto boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.reviewer_events (user_id, kind, source, source_id, note, internal_note, by_user, auto)
  values (p_user, p_kind, p_source, p_source_id, nullif(trim(p_note), ''), nullif(trim(p_internal), ''), auth.uid(), p_auto);
end $$;

-- strikes since the later of: the window start, the last status change
create or replace function app.strikes(p_user uuid, p_kind text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.reviewer_events ev
  where ev.user_id = p_user and ev.kind = p_kind
    and ev.created_at > greatest(
      now() - make_interval(days => greatest(app.setting_num('reviewer.window_days', 30)::int, 1)),
      coalesce((select e.status_changed_at from public.consult_experts e where e.user_id = p_user), '-infinity'));
$$;

-- internal status change (flag lets the guard through; claims are dropped when someone stops being active)
create or replace function app.expert_move(p_user uuid, p_status text, p_reason text, p_until timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.reviewer_internal', 'on', true);
  update public.consult_experts set status = p_status, status_reason = nullif(trim(p_reason), ''), paused_until = p_until,
         status_changed_at = now(), reviewed_by = coalesce(auth.uid(), reviewed_by), reviewed_at = now()
   where user_id = p_user;
  perform set_config('app.reviewer_internal', 'off', true);
  if p_status <> 'approved' then
    perform set_config('app.forum_internal', '1', true);
    update public.forum_posts set claimed_by = null, claimed_at = null, claimed_until = null where claimed_by = p_user;
    perform set_config('app.forum_internal', '0', true);
  end if;
end $$;

-- automatic pause when strikes pass the limits
create or replace function app.reviewer_enforce(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_late int := app.strikes(p_user, 'late'); v_wrong int := app.strikes(p_user, 'wrong');
  v_ll int := app.setting_num('reviewer.late_limit', 3)::int; v_wl int := app.setting_num('reviewer.wrong_limit', 2)::int;
  v_days int := app.setting_num('reviewer.pause_days', 7)::int; v_why text;
begin
  if not app.setting_bool('reviewer.auto_enforce', true) then return; end if;
  if not exists (select 1 from public.consult_experts where user_id = p_user and status = 'approved') then return; end if;
  if v_ll > 0 and v_late >= v_ll then v_why := 'تاخیر مکرر در بررسی (' || v_late || ' مورد)';
  elsif v_wl > 0 and v_wrong >= v_wl then v_why := 'بازبینی نادرست مکرر (' || v_wrong || ' مورد)'; end if;
  if v_why is null then return; end if;
  if v_days > 0 then
    perform app.expert_move(p_user, 'paused', v_why, now() + make_interval(days => v_days));
    perform app.log_event(p_user, 'paused', null, null, v_why || ' — توقف خودکار ' || v_days || ' روزه', null, true);
  else
    perform app.expert_move(p_user, 'suspended', v_why, null);
    perform app.log_event(p_user, 'suspended', null, null, v_why || ' — تا بررسی دوروا متوقف شد', null, true);
  end if;
end $$;

-- drop expired claims (a late strike each) and bring finished pauses back
create or replace function app.reviewer_sweep() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id, claimed_by from public.forum_posts
           where claimed_by is not null and claimed_until < now() and review_state = 'pending' for update skip locked loop
    perform set_config('app.forum_internal', '1', true);
    update public.forum_posts set claimed_by = null, claimed_at = null, claimed_until = null where id = r.id;
    perform set_config('app.forum_internal', '0', true);
    if exists (select 1 from public.consult_experts where user_id = r.claimed_by and status = 'approved') then
      perform app.log_event(r.claimed_by, 'late', 'forum', r.id, 'مهلت بررسی تمام شد و نتیجه‌ای ثبت نشد.', null, true);
      perform app.reviewer_enforce(r.claimed_by);
    end if;
  end loop;
  for r in select user_id from public.consult_experts where status = 'paused' and paused_until is not null and paused_until <= now() loop
    perform app.expert_move(r.user_id, 'approved', null, null);
    perform app.log_event(r.user_id, 'reinstated', null, null, 'دوره‌ی توقف تمام شد و دسترسی شما برگشت.', null, true);
  end loop;
end $$;

-- ---------------------------------------------------------------- staff: one door for every status change
-- p_action: approve | reject | suspend | pause | reinstate | remove | warn
-- returns 'ok' | 'state' | 'reason' | 'basis'
create or replace function public.reviewer_set_status(p_user uuid, p_action text, p_reason text default null,
                                                      p_days int default 0, p_internal text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.consult_experts; v_why text := nullif(trim(coalesce(p_reason, '')), ''); v_pharm boolean;
begin
  if not app.can_manage_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into e from public.consult_experts where user_id = p_user for update;
  if not found then return 'state'; end if;
  if p_action in ('suspend','pause','remove','reject','warn') and coalesce(length(v_why), 0) < 5 then return 'reason'; end if;

  if p_action = 'approve' then
    if e.status not in ('pending','suspended','removed') then return 'state'; end if;
    v_pharm := e.specialty = 'pharmacist' and app.is_verified_pharmacist(p_user);
    if not v_pharm and coalesce(length(v_why), 0) < 5 then return 'basis'; end if;
    perform set_config('app.reviewer_internal', 'on', true);
    update public.consult_experts set basis = case when v_pharm then 'pharmacist_verified' else 'granted' end,
           qualification_note = case when v_pharm then coalesce(v_why, 'داروساز تاییدشده‌ی دوروا') else v_why end
     where user_id = p_user;
    perform set_config('app.reviewer_internal', 'off', true);
    perform app.expert_move(p_user, 'approved', null, null);
    perform app.log_event(p_user, 'approved', null, null, 'صلاحیت شما به‌عنوان متخصص تایید شد.', coalesce(v_why, 'داروساز تاییدشده'), false);
  elsif p_action = 'reject' then
    if e.status <> 'pending' then return 'state'; end if;
    perform app.expert_move(p_user, 'removed', v_why, null);
    perform app.log_event(p_user, 'rejected', null, null, v_why, p_internal, false);
  elsif p_action = 'suspend' then
    if e.status not in ('approved','paused') then return 'state'; end if;
    perform app.expert_move(p_user, 'suspended', v_why, null);
    perform app.log_event(p_user, 'suspended', null, null, v_why, p_internal, false);
  elsif p_action = 'pause' then
    if e.status <> 'approved' or coalesce(p_days, 0) < 1 then return 'state'; end if;
    perform app.expert_move(p_user, 'paused', v_why, now() + make_interval(days => least(p_days, 365)));
    perform app.log_event(p_user, 'paused', null, null, v_why || ' — ' || least(p_days, 365) || ' روز', p_internal, false);
  elsif p_action = 'reinstate' then
    if e.status not in ('suspended','paused') then return 'state'; end if;
    perform app.expert_move(p_user, 'approved', null, null);
    perform app.log_event(p_user, 'reinstated', null, null, coalesce(v_why, 'دسترسی شما برگردانده شد.'), p_internal, false);
  elsif p_action = 'remove' then
    if e.status in ('removed') then return 'state'; end if;
    perform app.expert_move(p_user, 'removed', v_why, null);
    perform app.log_event(p_user, 'removed', null, null, v_why, p_internal, false);
  elsif p_action = 'warn' then
    perform app.log_event(p_user, 'warning', null, null, v_why, p_internal, false);
  else
    return 'state';
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- staff: audit a finished review or answer
-- p_verdict: good | wrong | unclear ; 'wrong' reopens the post, voids the unpaid credit and counts a strike
-- returns 'ok' | 'dup' | 'missing' | 'note'
create or replace function public.reviewer_audit(p_source text, p_id uuid, p_verdict text, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not app.can_manage_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_verdict not in ('good','wrong','unclear') or p_source not in ('forum','answer') then return 'missing'; end if;
  if p_verdict <> 'good' and coalesce(length(v_note), 0) < 5 then return 'note'; end if;
  if exists (select 1 from public.reviewer_events where source = p_source and source_id = p_id and kind in ('good','wrong','unclear')) then return 'dup'; end if;
  if p_source = 'forum' then select reviewed_by into v_user from public.forum_posts where id = p_id;
  else select author_id into v_user from public.consult_answers where id = p_id; end if;
  if v_user is null then return 'missing'; end if;
  if exists (select 1 from public.reviewer_events where source = p_source and source_id = p_id and kind in ('good','wrong','unclear')) then return 'dup'; end if;
  perform app.log_event(v_user, p_verdict, p_source, p_id, v_note, null, false);
  if p_verdict = 'wrong' then
    update public.review_credits set status = 'void' where source = p_source and source_id = p_id and status = 'accrued';
    if p_source = 'forum' then
      update public.forum_posts set review_state = 'pending' where id = p_id;
    else
      update public.consult_answers set verified = false where id = p_id;
    end if;
    perform app.reviewer_enforce(v_user);
  end if;
  return 'ok';
end $$;

-- sample to audit: recent reviews and answers nobody has audited yet
create or replace function public.reviewer_audit_queue(p_limit int default 12) returns table (
  source text, id uuid, body text, state text, note text, reviewer_id uuid, reviewer_name text, minutes numeric, at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.can_manage_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select * from (
    select 'forum'::text, p.id, p.body, p.review_state, p.review_note, p.reviewed_by, p.reviewer_name, p.review_minutes, p.reviewed_at
    from public.forum_posts p
    where p.reviewed_by is not null and p.review_state in ('verified','corrected') and p.reviewed_at > now() - interval '30 days'
      and not exists (select 1 from public.reviewer_events ev where ev.source = 'forum' and ev.source_id = p.id and ev.kind in ('good','wrong','unclear'))
    union all
    select 'answer', a.id, a.body, case when a.verified then 'verified' else 'pending' end, null::text, a.author_id,
           (select e.display_name from public.consult_experts e where e.user_id = a.author_id), null::numeric, a.created_at
    from public.consult_answers a
    where a.created_at > now() - interval '30 days' and a.status = 'visible'
      and not exists (select 1 from public.reviewer_events ev where ev.source = 'answer' and ev.source_id = a.id and ev.kind in ('good','wrong','unclear'))
  ) q order by random() limit greatest(least(p_limit, 50), 1);
end $$;

-- staff table: everyone who applied or works as a reviewer
create or replace function public.reviewer_admin_list() returns table (
  user_id uuid, display_name text, specialty text, license_no text, bio text, status text, basis text, qualification_note text,
  status_reason text, paused_until timestamptz, applied_at timestamptz, eligible_pharmacist boolean,
  late_n int, wrong_n int, good_n int, reviews_30d int, avg_minutes numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_manage_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform app.reviewer_sweep();
  return query
  select e.user_id, e.display_name, e.specialty, e.license_no, e.bio, e.status, e.basis, e.qualification_note,
         e.status_reason, e.paused_until, e.created_at,
         (e.specialty = 'pharmacist' and app.is_verified_pharmacist(e.user_id)),
         app.strikes(e.user_id, 'late'), app.strikes(e.user_id, 'wrong'),
         (select count(*)::int from public.reviewer_events v where v.user_id = e.user_id and v.kind = 'good'),
         (select count(*)::int from public.review_credits c where c.user_id = e.user_id and c.created_at > now() - interval '30 days'),
         (select round(avg(c.minutes)::numeric, 1) from public.review_credits c where c.user_id = e.user_id and c.minutes > 0)
  from public.consult_experts e
  order by case e.status when 'pending' then 0 when 'paused' then 1 when 'suspended' then 2 when 'approved' then 3 else 4 end, e.created_at desc;
end $$;

create or replace function public.reviewer_events_list(p_user uuid, p_limit int default 30) returns table (
  id bigint, kind text, source text, source_id uuid, note text, internal_note text, auto boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.can_manage_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select v.id, v.kind, v.source, v.source_id, v.note, v.internal_note, v.auto, v.created_at
    from public.reviewer_events v where v.user_id = p_user order by v.created_at desc limit least(greatest(p_limit, 1), 100);
end $$;

-- the reviewer's own view: status, strikes against the limits, and the feedback addressed to them
create or replace function public.my_reviewer_status() returns table (
  status text, reason text, paused_until timestamptz, basis text, late_n int, wrong_n int, late_limit int, wrong_limit int, window_days int)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.reviewer_sweep();
  return query select e.status, e.status_reason, e.paused_until, e.basis,
    app.strikes(auth.uid(), 'late'), app.strikes(auth.uid(), 'wrong'),
    app.setting_num('reviewer.late_limit', 3)::int, app.setting_num('reviewer.wrong_limit', 2)::int,
    app.setting_num('reviewer.window_days', 30)::int
  from public.consult_experts e where e.user_id = auth.uid();
end $$;

create or replace function public.my_reviewer_events(p_limit int default 20) returns table (
  id bigint, kind text, source text, source_id uuid, note text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.kind, v.source, v.source_id, v.note, v.created_at from public.reviewer_events v
  where v.user_id = auth.uid() and v.kind <> 'applied' order by v.created_at desc limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.reviewer_set_status(uuid, text, text, int, text), public.reviewer_audit(text, uuid, text, text),
  public.reviewer_audit_queue(int), public.reviewer_admin_list(), public.reviewer_events_list(uuid, int),
  public.my_reviewer_status(), public.my_reviewer_events(int) from public, anon;
grant execute on function public.reviewer_set_status(uuid, text, text, int, text), public.reviewer_audit(text, uuid, text, text),
  public.reviewer_audit_queue(int), public.reviewer_admin_list(), public.reviewer_events_list(uuid, int),
  public.my_reviewer_status(), public.my_reviewer_events(int) to authenticated;
revoke all on function app.reviewer_sweep(), app.reviewer_enforce(uuid), app.expert_move(uuid, text, text, timestamptz),
  app.log_event(uuid, text, text, uuid, text, text, boolean) from public, anon, authenticated;

-- claims first sweep expired ones (late strikes) and refuse paused reviewers
create or replace function public.forum_claim(p_count int default 1) returns setof uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_cap int := app.setting_num('review.daily_cap', 0)::int;
  v_max int := greatest(app.setting_num('review.max_claims', 3)::int, 1);
  v_mins int := greatest(app.setting_num('review.claim_minutes', 30)::int, 1);
  v_active int; v_today int; v_take int; v_ids uuid[];
begin
  perform app.reviewer_sweep();
  if v_me is null or not (app.is_consult_expert() or app.can_manage_consult()) then
    raise exception 'only reviewers' using errcode = '42501';
  end if;
  select count(*) into v_active from public.forum_posts where claimed_by = v_me and claimed_until > now() and review_state = 'pending';
  select count(*) into v_today from public.review_credits where user_id = v_me and source = 'forum' and created_at > now() - interval '1 day';
  if v_cap > 0 and v_today + v_active >= v_cap then raise exception 'daily review cap reached' using errcode = 'P0001'; end if;
  v_take := least(greatest(p_count, 1), v_max - v_active);
  if v_cap > 0 then v_take := least(v_take, v_cap - v_today - v_active); end if;
  if v_take <= 0 then raise exception 'too many open claims' using errcode = 'P0002'; end if;

  select coalesce(array_agg(id), '{}') into v_ids from (
    select id from public.forum_posts
    where review_state = 'pending' and status = 'visible' and author_id <> v_me
      and (claimed_until is null or claimed_until < now())
    order by created_at limit v_take for update skip locked) s;
  perform set_config('app.forum_internal', '1', true);
  update public.forum_posts set claimed_by = v_me, claimed_at = now(), claimed_until = now() + make_interval(mins => v_mins)
  where id = any(v_ids);
  perform set_config('app.forum_internal', '0', true);
  return query select unnest(v_ids);
end $$;

-- ---------------------------------------------------------------- settings (Settings › Forum & specialists › qualification)
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
 ('reviewer.auto_pharmacist','expert','boolean',null,null,null,null,
  '{"fa": "پذیرش خودکار داروساز تاییدشده", "en": "Auto-accept verified pharmacists", "ar": "قبول الصيدلي الموثق تلقائياً"}',
  '{"fa": "روشن = داروسازی که مسئول فنی فعال یک داروخانه‌ی فعال با شماره‌ی نظام است، همان لحظه‌ی درخواست متخصص می‌شود و پس از آن همیشه صلاحیت دارد. خاموش = همه را دوروا دستی تایید می‌کند.", "en": "On = a licensed technical officer of an active pharmacy is accepted at once and stays qualified.", "ar": "تشغيل = يُقبل المسؤول الفني المرخص فوراً."}',1030),
 ('reviewer.auto_enforce','expert','boolean',null,null,null,null,
  '{"fa": "توقف خودکار بر اساس نظارت", "en": "Automatic pause by monitoring", "ar": "إيقاف تلقائي حسب المراقبة"}',
  '{"fa": "روشن = اگر تاخیر یا بازبینی نادرست از سقف‌های زیر بگذرد، متخصص خودکار متوقف می‌شود و دلیل را می‌بیند.", "en": "On = a reviewer passing the limits below is paused automatically and sees why.", "ar": "تشغيل = يُوقف المراجع تلقائياً."}',1031),
 ('reviewer.late_limit','expert','number',null,0,50,'{"fa": "مورد", "en": "times", "ar": "مرة"}',
  '{"fa": "سقف تاخیر", "en": "Late limit", "ar": "حد التأخير"}',
  '{"fa": "چند بار گذاشتن نظر برداشته‌شده تا پایان مهلت بدون نتیجه، در بازه‌ی زیر، به توقف می‌انجامد. صفر = بررسی نشود.", "en": "Claims left to expire within the window before a pause. 0 = off.", "ar": "عدد الحجوزات المنتهية قبل الإيقاف."}',1032),
 ('reviewer.wrong_limit','expert','number',null,0,50,'{"fa": "مورد", "en": "times", "ar": "مرة"}',
  '{"fa": "سقف بازبینی نادرست", "en": "Wrong-review limit", "ar": "حد المراجعة الخاطئة"}',
  '{"fa": "چند بازبینی نادرست (ثبت‌شده در حسابرسی دوروا) در بازه‌ی زیر به توقف می‌انجامد. صفر = بررسی نشود.", "en": "Wrong reviews found by audit within the window before a pause. 0 = off.", "ar": "عدد المراجعات الخاطئة قبل الإيقاف."}',1033),
 ('reviewer.window_days','expert','number',null,1,365,'{"fa": "روز", "en": "days", "ar": "يوم"}',
  '{"fa": "بازه‌ی شمارش", "en": "Counting window", "ar": "فترة الاحتساب"}',
  '{"fa": "تاخیر و خطاهای این چند روز اخیر شمرده می‌شود.", "en": "Strikes older than this are ignored.", "ar": "الأخطاء الأقدم تُهمل."}',1034),
 ('reviewer.pause_days','expert','number',null,0,365,'{"fa": "روز", "en": "days", "ar": "يوم"}',
  '{"fa": "مدت توقف خودکار", "en": "Automatic pause length", "ar": "مدة الإيقاف التلقائي"}',
  '{"fa": "بعد از این مدت دسترسی خودکار برمی‌گردد. صفر = تا بررسی دوروا متوقف بماند.", "en": "Access returns by itself afterwards. 0 = stays off until Dorva reinstates.", "ar": "يعود الوصول تلقائياً. 0 = حتى تعيده دوروا."}',1035)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
 ('reviewer.auto_pharmacist','platform','true','پذیرش خودکار داروساز تاییدشده'),
 ('reviewer.auto_enforce','platform','true','توقف خودکار بر اساس نظارت'),
 ('reviewer.late_limit','platform','3','سقف تاخیر'),
 ('reviewer.wrong_limit','platform','2','سقف بازبینی نادرست'),
 ('reviewer.window_days','platform','30','بازه‌ی شمارش'),
 ('reviewer.pause_days','platform','7','مدت توقف خودکار')
on conflict do nothing;
