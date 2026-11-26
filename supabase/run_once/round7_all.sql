-- ===== 053_phone_login =====
-- Round 7a: sign-in with an SMS code (mobile number, no password).
--
-- The server (Next.js, service role) sends the code through the SMS provider and
-- checks it here. Codes are stored only as an HMAC hash, expire fast, allow a few
-- wrong tries, and are rate limited per number and per IP.
-- The table has no policies on purpose: browsers (anon / authenticated) cannot read it.

set search_path = public, extensions;

create table if not exists public.phone_otps (
  id          bigint generated always as identity primary key,
  phone       text not null check (phone ~ '^09[0-9]{9}$'),
  code_hash   text not null,
  ip          text,
  attempts    smallint not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists phone_otps_phone_idx on public.phone_otps (phone, created_at desc);
create index if not exists phone_otps_ip_idx    on public.phone_otps (ip, created_at desc) where ip is not null;

alter table public.phone_otps enable row level security;
revoke all on public.phone_otps from anon, authenticated;

-- Housekeeping: old codes are useless after a day.
create or replace function public.phone_otp_cleanup() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with d as (delete from public.phone_otps where created_at < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.phone_otp_cleanup() from public, anon, authenticated;

comment on table public.phone_otps is 'SMS sign-in codes (hashed). Service role only.';

-- ===== 054_consult =====
-- Round 7b: consultation — scientific forum (patient questions, expert answers,
-- "verified by Dorva" mark), the network of consultants and the scientific magazine.
--
-- Rules the database enforces:
--  * only a signed-in user can ask; at most 10 questions per day
--  * only an APPROVED consultant can answer, and only as himself
--  * an answer is "verified" only by Dorva staff (consult.manage); nobody else can set it
--  * a consultant cannot approve himself
--  * private questions (is_public = false) are seen by the asker, approved consultants and staff
--  * public questions are readable by everyone, the asker is never shown (no name in any table)

set search_path = public, extensions;

-- ---------------------------------------------------------------- permission
insert into public.permissions (code, scope, description_fa) values
  ('consult.manage', 'platform', 'مدیریت مشاوره، فروم علمی و مجله (تایید مشاور، تایید پاسخ، انتشار مقاله)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'consult.manage' from public.roles r
where r.is_system and r.scope = 'platform' and r.code in ('super_admin', 'content_moderator')
on conflict do nothing;

-- ---------------------------------------------------------------- consultants
create table public.consult_experts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  pharmacy_id  uuid references public.pharmacies(id) on delete set null,
  display_name text not null check (length(trim(display_name)) between 3 and 80),
  specialty    text not null check (specialty in ('pharmacist','physician','skin','nutrition','other')),
  license_no   text check (license_no is null or length(license_no) <= 40),
  bio          text check (bio is null or length(bio) <= 800),
  status       text not null default 'pending' check (status in ('pending','approved','suspended')),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create or replace function app.is_consult_expert() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.consult_experts where user_id = auth.uid() and status = 'approved');
$$;

create or replace function app.can_manage_consult() returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select app.has_platform_permission('consult.manage');
$$;

-- a consultant edits his own card but never his status
create or replace function app.guard_consult_expert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if not app.can_manage_consult() then
      new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null;
    end if;
    return new;
  end if;
  if not app.can_manage_consult() then
    if new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
       or new.user_id is distinct from old.user_id then
      raise exception 'only Dorva staff can change a consultant status' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  return new;
end $$;
create trigger consult_experts_guard before insert or update on public.consult_experts
  for each row execute function app.guard_consult_expert();

-- ---------------------------------------------------------------- questions
create table public.consult_questions (
  id          uuid primary key default gen_random_uuid(),
  asker_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (length(trim(title)) between 5 and 140),
  body        text not null check (length(trim(body)) between 10 and 2000),
  topic       text not null default 'general'
              check (topic in ('general','drug','pregnancy','child','skin','supplement','elderly','other')),
  is_public   boolean not null default false,
  status      text not null default 'open' check (status in ('open','answered','closed','hidden')),
  created_at  timestamptz not null default now()
);
create index consult_questions_public_idx on public.consult_questions (created_at desc)
  where is_public and status in ('open','answered');
create index consult_questions_asker_idx on public.consult_questions (asker_id, created_at desc);

create or replace function app.guard_consult_question() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.asker_id := auth.uid();
    new.status := 'open';
    if new.asker_id is null then raise exception 'sign in first' using errcode = '42501'; end if;
    if (select count(*) from public.consult_questions
        where asker_id = new.asker_id and created_at > now() - interval '1 day') >= greatest(app.setting_num('consult.questions_per_day', 10), 1)::int then
      raise exception 'daily question limit reached' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- update: the asker may only close his own question; staff may also hide it.
  -- The answer trigger (nesting depth 2) may flip open -> answered; a direct update never has that depth.
  if pg_trigger_depth() > 1 and old.status = 'open' and new.status = 'answered' then return new; end if;
  if not app.can_manage_consult() then
    if new.id is distinct from old.id or new.asker_id is distinct from old.asker_id
       or new.title is distinct from old.title or new.body is distinct from old.body
       or new.topic is distinct from old.topic or new.is_public is distinct from old.is_public
       or new.status not in ('closed', old.status) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger consult_questions_guard before insert or update on public.consult_questions
  for each row execute function app.guard_consult_question();

-- ---------------------------------------------------------------- answers
create table public.consult_answers (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.consult_questions(id) on delete cascade,
  author_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body         text not null check (length(trim(body)) between 10 and 3000),
  verified     boolean not null default false,
  verified_by  uuid references auth.users(id),
  status       text not null default 'visible' check (status in ('visible','hidden')),
  created_at   timestamptz not null default now()
);
create index consult_answers_q_idx on public.consult_answers (question_id, created_at);

create or replace function app.guard_consult_answer() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    if not (app.is_consult_expert() or app.can_manage_consult()) then
      raise exception 'only approved consultants can answer' using errcode = '42501';
    end if;
    if not app.can_manage_consult() then new.verified := false; new.verified_by := null; new.status := 'visible'; end if;
    return new;
  end if;
  if not app.can_manage_consult() then
    -- the author may only edit the text of his own answer, never the marks
    if new.author_id is distinct from old.author_id or new.question_id is distinct from old.question_id
       or new.verified is distinct from old.verified or new.status is distinct from old.status then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  if new.verified and not old.verified then new.verified_by := auth.uid(); end if;
  if not new.verified then new.verified_by := null; end if;
  return new;
end $$;
create trigger consult_answers_guard before insert or update on public.consult_answers
  for each row execute function app.guard_consult_answer();

-- first visible answer flips the question to "answered"
create or replace function app.consult_answer_after() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.consult_questions set status = 'answered'
  where id = new.question_id and status = 'open';
  return null;
end $$;
create trigger consult_answers_after after insert on public.consult_answers
  for each row execute function app.consult_answer_after();

-- ---------------------------------------------------------------- magazine
create table public.magazine_articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78})[a-z0-9]$'),
  title         text not null check (length(trim(title)) between 5 and 160),
  summary       text check (summary is null or length(summary) <= 400),
  body          text not null check (length(trim(body)) >= 50),
  author_name   text,
  reviewed_by   text,
  status        text not null default 'draft' check (status in ('draft','published')),
  published_at  timestamptz,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index magazine_published_idx on public.magazine_articles (published_at desc) where status = 'published';

create or replace function app.magazine_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  if new.status = 'draft' then new.published_at := null; end if;
  return new;
end $$;
create trigger magazine_touch before insert or update on public.magazine_articles
  for each row execute function app.magazine_touch();

-- ---------------------------------------------------------------- RLS
alter table public.consult_experts    enable row level security;
alter table public.consult_questions  enable row level security;
alter table public.consult_answers    enable row level security;
alter table public.magazine_articles  enable row level security;

-- consultants: approved ones are a public list; one sees his own card; staff see all
create policy experts_read on public.consult_experts for select
  using (status = 'approved' or user_id = auth.uid() or app.can_manage_consult());
create policy experts_insert on public.consult_experts for insert to authenticated
  with check (user_id = auth.uid() or app.can_manage_consult());
create policy experts_update on public.consult_experts for update to authenticated
  using (user_id = auth.uid() or app.can_manage_consult())
  with check (user_id = auth.uid() or app.can_manage_consult());
create policy experts_delete on public.consult_experts for delete to authenticated
  using (user_id = auth.uid() or app.can_manage_consult());

-- questions
create policy questions_read on public.consult_questions for select
  using (
    asker_id = auth.uid()
    or app.can_manage_consult()
    or (status <> 'hidden' and (is_public or app.is_consult_expert()))
  );
create policy questions_insert on public.consult_questions for insert to authenticated
  with check (asker_id = auth.uid());
create policy questions_update on public.consult_questions for update to authenticated
  using (asker_id = auth.uid() or app.can_manage_consult())
  with check (asker_id = auth.uid() or app.can_manage_consult());

-- answers: visible when the question is visible to the reader (RLS of questions applies)
create policy answers_read on public.consult_answers for select
  using (
    app.can_manage_consult()
    or author_id = auth.uid()
    or (status = 'visible' and exists (select 1 from public.consult_questions q where q.id = question_id))
  );
create policy answers_insert on public.consult_answers for insert to authenticated
  with check (author_id = auth.uid() and (app.is_consult_expert() or app.can_manage_consult()));
create policy answers_update on public.consult_answers for update to authenticated
  using (author_id = auth.uid() or app.can_manage_consult())
  with check (author_id = auth.uid() or app.can_manage_consult());
create policy answers_delete on public.consult_answers for delete to authenticated
  using (app.can_manage_consult());

-- magazine: readers see published; staff manage
create policy magazine_read on public.magazine_articles for select
  using (status = 'published' or app.can_manage_consult());
create policy magazine_write on public.magazine_articles for all to authenticated
  using (app.can_manage_consult()) with check (app.can_manage_consult());

-- anonymous visitors only read; everything else needs a session
revoke insert, update, delete on public.consult_experts, public.consult_questions,
  public.consult_answers, public.magazine_articles from anon;

-- ---------------------------------------------------------------- reading helpers
-- counts shown on the forum list (answers visible to everybody)
create or replace function public.consult_answer_counts(p_ids uuid[]) returns table (question_id uuid, answers int, verified int)
language sql stable set search_path = public, pg_temp as $$
  select a.question_id, count(*)::int, count(*) filter (where a.verified)::int
  from public.consult_answers a
  where a.question_id = any(p_ids) and a.status = 'visible'
  group by a.question_id;
$$;

-- ===== 055_forum =====
-- Round 7c: open health forum, separate from the consultation Q&A.
--  * any signed-in user can start a thread or comment (30 posts a day)
--  * every post starts "pending"; a reviewer (approved consultant or staff) later marks it:
--      verified   = confirmed by a specialist
--      corrected  = specialist added a correction / note (review_note required)
--      not_needed = no medical claim, nothing to verify
--  * a reviewer cannot review his own post (staff excepted); only staff can hide posts
--  * the text of a post can never be changed after it is posted
set search_path = public, extensions;

create table public.forum_posts (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references public.forum_posts(id) on delete cascade,
  author_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category      text not null default 'general'
                check (category in ('general','drug','pregnancy','child','skin','supplement','elderly','nutrition','mental','other')),
  title         text check (title is null or length(trim(title)) between 5 and 140),
  body          text not null check (length(trim(body)) between 5 and 3000),
  status        text not null default 'visible' check (status in ('visible','hidden')),
  review_state  text not null default 'pending' check (review_state in ('pending','verified','corrected','not_needed')),
  review_note   text check (review_note is null or length(review_note) <= 2000),
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  check ((parent_id is null and title is not null) or (parent_id is not null and title is null))
);
create index forum_posts_threads_idx on public.forum_posts (created_at desc) where parent_id is null;
create index forum_posts_parent_idx  on public.forum_posts (parent_id, created_at);
create index forum_posts_review_idx  on public.forum_posts (review_state, created_at) where status = 'visible';

create or replace function app.guard_forum_post() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.status := 'visible'; new.review_state := 'pending';
    new.review_note := null; new.reviewed_by := null; new.reviewed_at := null;
    if new.parent_id is not null then
      if not exists (select 1 from public.forum_posts p where p.id = new.parent_id and p.parent_id is null and p.status = 'visible') then
        raise exception 'thread not found' using errcode = '23503';
      end if;
      new.category := (select category from public.forum_posts where id = new.parent_id);
    end if;
    if (select count(*) from public.forum_posts where author_id = new.author_id and created_at > now() - interval '1 day') >= 30 then
      raise exception 'daily post limit reached' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.body is distinct from old.body or new.title is distinct from old.title
     or new.author_id is distinct from old.author_id or new.parent_id is distinct from old.parent_id
     or new.category is distinct from old.category then
    raise exception 'post text is immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not app.can_manage_consult() then
    raise exception 'only staff can hide posts' using errcode = '42501';
  end if;
  if new.review_state is distinct from old.review_state or new.review_note is distinct from old.review_note then
    if not (app.is_consult_expert() or app.can_manage_consult()) then
      raise exception 'only reviewers can review' using errcode = '42501';
    end if;
    if old.author_id = auth.uid() and not app.can_manage_consult() then
      raise exception 'cannot review own post' using errcode = '42501';
    end if;
    if new.review_state = 'corrected' and coalesce(length(trim(new.review_note)), 0) < 5 then
      raise exception 'a correction needs a note' using errcode = '23514';
    end if;
    if new.review_state = 'pending' then
      new.reviewed_by := null; new.reviewed_at := null;
    else
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger forum_posts_guard before insert or update on public.forum_posts
  for each row execute function app.guard_forum_post();

alter table public.forum_posts enable row level security;
create policy forum_read on public.forum_posts for select
  using (status = 'visible' or author_id = auth.uid() or app.can_manage_consult());
create policy forum_insert on public.forum_posts for insert to authenticated
  with check (author_id = auth.uid());
create policy forum_update on public.forum_posts for update to authenticated
  using (app.is_consult_expert() or app.can_manage_consult())
  with check (app.is_consult_expert() or app.can_manage_consult());
create policy forum_delete on public.forum_posts for delete to authenticated
  using (app.can_manage_consult());

create or replace function public.forum_comment_counts(p_ids uuid[]) returns table (thread_id uuid, comments int, reviewed int)
language sql stable security invoker set search_path = public, pg_temp as $$
  select parent_id, count(*)::int, count(*) filter (where review_state in ('verified','corrected'))::int
  from public.forum_posts where parent_id = any(p_ids) and status = 'visible' group by parent_id;
$$;
grant execute on function public.forum_comment_counts(uuid[]) to anon, authenticated;

-- ===== 056_reviewer_workflow =====
-- Round 7d: reviewer workflow, credits (points / working hours), payout records, all limits in Settings.
--  * Reviewers CLAIM posts from the queue (locked for N minutes), then decide; staff may review without a claim.
--  * Every decision snapshots the reviewer's name and specialty on the post (shown next to the verification).
--  * Each review / consultant answer creates a credit: points and minutes worked, priced by Settings
--    (per point or per hour). Dorva staff with consult.payout record payouts; money moves outside this system.
--  * Every number below is a row in Settings (group "forum" and "review"); nothing is hard-coded.
set search_path = public, extensions;

-- ---------------------------------------------------------------- permission
insert into public.permissions (code, scope, description_fa) values
  ('consult.payout', 'platform', 'ثبت پرداخت به متخصصان (مشاوران و بازبینان)')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'consult.payout' from public.roles r
where r.is_system and r.scope = 'platform' and r.code = 'super_admin'
on conflict do nothing;

create or replace function app.can_payout_consult() returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select app.has_platform_permission('consult.payout');
$$;

-- ---------------------------------------------------------------- post columns
alter table public.forum_posts
  add column claimed_by         uuid references auth.users(id) on delete set null,
  add column claimed_at         timestamptz,
  add column claimed_until      timestamptz,
  add column reviewer_name      text,
  add column reviewer_specialty text,
  add column review_minutes     numeric;
create index forum_posts_claim_idx on public.forum_posts (claimed_by) where claimed_until is not null;

-- ---------------------------------------------------------------- credits
create table public.review_credits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  source       text not null check (source in ('forum','answer')),
  source_id    uuid not null,
  action       text not null check (action in ('verify','correct','none','answer')),
  points       numeric not null default 0 check (points >= 0),
  minutes      numeric not null default 0 check (minutes >= 0),
  pay_mode     text not null check (pay_mode in ('points','hours')),
  rate_rial    numeric not null default 0,
  amount_rial  numeric not null default 0 check (amount_rial >= 0),
  status       text not null default 'accrued' check (status in ('accrued','paid','void')),
  batch_id     uuid,
  created_at   timestamptz not null default now(),
  unique (source, source_id, user_id)
);
create index review_credits_user_idx on public.review_credits (user_id, status, created_at desc);

create table public.payout_batches (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id),
  amount_rial  numeric not null,
  credits      int not null,
  note         text,
  paid_by      uuid not null default auth.uid() references auth.users(id),
  paid_at      timestamptz not null default now()
);

create table public.expert_payout_info (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  holder_name  text not null check (length(trim(holder_name)) between 3 and 80),
  iban         text not null check (iban ~ '^IR[0-9]{24}$'),
  updated_at   timestamptz not null default now()
);

alter table public.review_credits    enable row level security;
alter table public.payout_batches    enable row level security;
alter table public.expert_payout_info enable row level security;
create policy credits_read on public.review_credits for select
  using (user_id = auth.uid() or app.can_manage_consult());
create policy batches_read on public.payout_batches for select
  using (user_id = auth.uid() or app.can_payout_consult());
create policy payinfo_read on public.expert_payout_info for select
  using (user_id = auth.uid() or app.can_payout_consult());
create policy payinfo_write on public.expert_payout_info for insert to authenticated
  with check (user_id = auth.uid() and app.is_consult_expert());
create policy payinfo_update on public.expert_payout_info for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.review_credits, public.payout_batches from anon, authenticated;

-- one place that prices and records a credit
create or replace function app.record_credit(p_user uuid, p_source text, p_source_id uuid, p_action text, p_minutes numeric)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_pts  numeric := case p_action
    when 'verify'  then app.setting_num('review.points_verify', 3)
    when 'correct' then app.setting_num('review.points_note', 5)
    when 'none'    then app.setting_num('review.points_none', 1)
    else app.setting_num('consult.points_answer', 4) end;
  v_mode text := coalesce(app.setting('review.pay_mode') #>> '{}', 'points');
  v_rate numeric;
  v_min  numeric := least(greatest(coalesce(p_minutes, 0), 0), app.setting_num('review.max_minutes', 15));
begin
  if not exists (select 1 from public.consult_experts where user_id = p_user and status = 'approved') then return; end if;
  if v_mode not in ('points','hours') then v_mode := 'points'; end if;
  v_rate := case v_mode when 'points' then app.setting_num('review.rial_per_point', 0)
                        else app.setting_num('review.rial_per_hour', 0) end;
  insert into public.review_credits (user_id, source, source_id, action, points, minutes, pay_mode, rate_rial, amount_rial)
  values (p_user, p_source, p_source_id, p_action, v_pts, v_min, v_mode, v_rate,
          round(case v_mode when 'points' then v_pts * v_rate else v_min / 60 * v_rate end))
  on conflict (source, source_id, user_id) do nothing;
end $$;

-- ---------------------------------------------------------------- forum guard (replaces 055)
create or replace function app.guard_forum_post() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_internal boolean := coalesce(current_setting('app.forum_internal', true), '') = '1';
  v_staff boolean := app.can_manage_consult();
  v_limit int; e record;
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    if new.author_id is null then raise exception 'sign in first' using errcode = '42501'; end if;
    if not app.setting_bool('forum.enabled', true) then raise exception 'forum is closed' using errcode = 'P0001'; end if;
    new.status := 'visible'; new.review_state := 'pending';
    new.review_note := null; new.reviewed_by := null; new.reviewed_at := null;
    new.claimed_by := null; new.claimed_at := null; new.claimed_until := null;
    new.reviewer_name := null; new.reviewer_specialty := null; new.review_minutes := null;
    if new.parent_id is not null then
      if not exists (select 1 from public.forum_posts p where p.id = new.parent_id and p.parent_id is null and p.status = 'visible') then
        raise exception 'thread not found' using errcode = '23503';
      end if;
      new.category := (select category from public.forum_posts where id = new.parent_id);
    end if;
    v_limit := app.setting_num('forum.posts_per_day', 30)::int;
    if v_limit > 0 and (select count(*) from public.forum_posts
        where author_id = new.author_id and created_at > now() - interval '1 day') >= v_limit then
      raise exception 'daily post limit reached' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.body is distinct from old.body or new.title is distinct from old.title
     or new.author_id is distinct from old.author_id or new.parent_id is distinct from old.parent_id
     or new.category is distinct from old.category then
    raise exception 'post text is immutable' using errcode = '42501';
  end if;
  if (new.claimed_by is distinct from old.claimed_by or new.claimed_at is distinct from old.claimed_at
      or new.claimed_until is distinct from old.claimed_until) and not v_internal and not (v_staff and new.review_state is distinct from old.review_state) then
    raise exception 'claims go through forum_claim()' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not v_staff then
    raise exception 'only staff can hide posts' using errcode = '42501';
  end if;

  if new.review_state is distinct from old.review_state or new.review_note is distinct from old.review_note then
    if not (app.is_consult_expert() or v_staff) then
      raise exception 'only reviewers can review' using errcode = '42501';
    end if;
    if old.author_id = auth.uid() and not v_staff then
      raise exception 'cannot review own post' using errcode = '42501';
    end if;
    if not v_staff and not coalesce(old.claimed_by = auth.uid() and old.claimed_until > now(), false) then
      raise exception 'claim the post first' using errcode = '42501';
    end if;
    if new.review_state = 'corrected' and coalesce(length(trim(new.review_note)), 0) < 5 then
      raise exception 'a correction needs a note' using errcode = '23514';
    end if;
    if new.review_state = 'pending' then
      new.reviewed_by := null; new.reviewed_at := null; new.reviewer_name := null; new.reviewer_specialty := null;
      new.review_minutes := null;
    else
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
      select display_name, specialty into e from public.consult_experts where user_id = auth.uid() and status = 'approved';
      new.reviewer_name := coalesce(e.display_name, 'Dorva');
      new.reviewer_specialty := coalesce(e.specialty, 'staff');
      new.review_minutes := case when old.claimed_by = auth.uid() and old.claimed_at is not null
        then round((extract(epoch from now() - old.claimed_at) / 60)::numeric, 1) else null end;
    end if;
    new.claimed_by := null; new.claimed_at := null; new.claimed_until := null;
  end if;
  return new;
end $$;

create or replace function app.forum_review_credit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.review_state = 'pending' and new.review_state <> 'pending' and new.reviewed_by is not null then
    perform app.record_credit(new.reviewed_by, 'forum', new.id,
      case new.review_state when 'verified' then 'verify' when 'corrected' then 'correct' else 'none' end, new.review_minutes);
  end if;
  return null;
end $$;
create trigger forum_posts_credit after update on public.forum_posts
  for each row execute function app.forum_review_credit();

create or replace function app.answer_credit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.record_credit(new.author_id, 'answer', new.id, 'answer', null);
  return null;
end $$;
create trigger consult_answers_credit after insert on public.consult_answers
  for each row execute function app.answer_credit();

-- ---------------------------------------------------------------- workflow functions
create or replace function public.forum_claim(p_count int default 1) returns setof uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_me uuid := auth.uid();
  v_cap int := app.setting_num('review.daily_cap', 0)::int;
  v_max int := greatest(app.setting_num('review.max_claims', 3)::int, 1);
  v_mins int := greatest(app.setting_num('review.claim_minutes', 30)::int, 1);
  v_active int; v_today int; v_take int; v_ids uuid[];
begin
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

create or replace function public.forum_release(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.forum_internal', '1', true);
  update public.forum_posts set claimed_by = null, claimed_at = null, claimed_until = null
  where id = p_id and claimed_by = auth.uid();
  perform set_config('app.forum_internal', '0', true);
end $$;

-- my own numbers (reviewer)
create or replace function public.my_review_stats() returns table (accrued_rial numeric, accrued_points numeric, paid_rial numeric, reviews_today int, answers_today int)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount_rial) filter (where status = 'accrued'), 0),
         coalesce(sum(points) filter (where status = 'accrued'), 0),
         coalesce(sum(amount_rial) filter (where status = 'paid'), 0),
         (count(*) filter (where source = 'forum' and created_at > now() - interval '1 day'))::int,
         (count(*) filter (where source = 'answer' and created_at > now() - interval '1 day'))::int
  from public.review_credits where user_id = auth.uid();
$$;

-- staff overview: one row per specialist
create or replace function public.reviewer_balances() returns table (
  user_id uuid, display_name text, specialty text, reviews int, answers int, points numeric, minutes numeric,
  accrued_rial numeric, paid_rial numeric, has_iban boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.can_manage_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select e.user_id, e.display_name, e.specialty,
         (count(c.id) filter (where c.source = 'forum' and c.status <> 'void'))::int,
         (count(c.id) filter (where c.source = 'answer' and c.status <> 'void'))::int,
         coalesce(sum(c.points) filter (where c.status = 'accrued'), 0),
         coalesce(sum(c.minutes) filter (where c.status = 'accrued'), 0),
         coalesce(sum(c.amount_rial) filter (where c.status = 'accrued'), 0),
         coalesce(sum(c.amount_rial) filter (where c.status = 'paid'), 0),
         exists (select 1 from public.expert_payout_info i where i.user_id = e.user_id)
  from public.consult_experts e left join public.review_credits c on c.user_id = e.user_id
  where e.status = 'approved'
  group by e.user_id, e.display_name, e.specialty
  order by 8 desc;
end $$;

-- record that Dorva paid this specialist; closes every open credit
create or replace function public.payout_mark(p_user uuid, p_note text default null) returns numeric
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_sum numeric; v_n int; v_batch uuid := gen_random_uuid(); v_min numeric := app.setting_num('review.min_payout_rial', 0);
begin
  if not app.can_payout_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.review_credits where user_id = p_user and status = 'accrued' for update;
  select coalesce(sum(amount_rial), 0), count(*) into v_sum, v_n from public.review_credits
   where user_id = p_user and status = 'accrued';
  if v_n = 0 or v_sum <= 0 then raise exception 'nothing to pay' using errcode = 'P0002'; end if;
  if v_sum < v_min then raise exception 'below the minimum payout' using errcode = 'P0001'; end if;
  insert into public.payout_batches (id, user_id, amount_rial, credits, note) values (v_batch, p_user, v_sum, v_n, nullif(trim(p_note), ''));
  update public.review_credits set status = 'paid', batch_id = v_batch where user_id = p_user and status = 'accrued';
  return v_sum;
end $$;

create or replace function public.credit_void(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_payout_consult() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.review_credits set status = 'void' where id = p_id and status = 'accrued';
end $$;

revoke all on function public.forum_claim(int), public.forum_release(uuid), public.my_review_stats(),
  public.reviewer_balances(), public.payout_mark(uuid, text), public.credit_void(uuid) from public, anon;
grant execute on function public.forum_claim(int), public.forum_release(uuid), public.my_review_stats(),
  public.reviewer_balances(), public.payout_mark(uuid, text), public.credit_void(uuid) to authenticated;

-- ---------------------------------------------------------------- settings (Settings page › Forum & specialists)
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
 ('forum.enabled','forum','boolean',null,null,null,null,
  '{"fa":"فروم فعال باشد","en":"Forum enabled","ar":"المنتدى مفعل"}','{"fa":"خاموش = ثبت گفتگو و نظر تازه بسته می‌شود.","en":"Off = no new posts.","ar":"إيقاف = لا مشاركات جديدة."}',1000),
 ('forum.posts_per_day','forum','number',null,0,500,'{"fa":"پست در روز","en":"posts/day","ar":"مشاركة/يوم"}',
  '{"fa": "سقف پست روزانه", "en": "Posts per day", "ar": "حد المشاركات اليومي"}',
  '{"fa":"سقف گفتگو و نظر هر کاربر در ۲۴ ساعت. صفر = بدون سقف.","en":"Per user per 24h. 0 = no limit.","ar":"لكل مستخدم. 0 = بلا حد."}',1001),
 ('consult.questions_per_day','forum','number',null,1,100,'{"fa":"پرسش در روز","en":"questions/day","ar":"سؤال/يوم"}',
  '{"fa": "سقف پرسش مشاوره در روز", "en": "Consultation questions per day", "ar": "حد أسئلة الاستشارة"}',
  '{"fa":"سقف پرسش مشاوره‌ی هر کاربر در ۲۴ ساعت.","en":"Consultation questions per user per 24h.","ar":"أسئلة الاستشارة لكل مستخدم."}',1002),
 ('review.claim_minutes','review','number',null,5,1440,'{"fa":"دقیقه","en":"minutes","ar":"دقيقة"}',
  '{"fa": "مهلت بررسی نظر", "en": "Review time limit", "ar": "مهلة المراجعة"}',
  '{"fa":"مهلت بررسی بعد از برداشتن نظر از صف. پس از آن نظر دوباره به صف برمی‌گردد.","en":"How long a claimed post stays locked for the reviewer.","ar":"مدة حجز المشاركة."}',1010),
 ('review.max_claims','review','number',null,1,50,'{"fa":"نظر","en":"posts","ar":"مشاركة"}',
  '{"fa": "حداکثر نظر هم‌زمان برای هر متخصص", "en": "Max open claims per reviewer", "ar": "الحد الأقصى للحجوزات"}',
  '{"fa":"حداکثر نظرهای هم‌زمانِ برداشته‌شده توسط هر متخصص.","en":"Max open claims per reviewer.","ar":"الحد الأقصى للحجوزات."}',1011),
 ('review.daily_cap','review','number',null,0,1000,'{"fa":"بررسی در روز","en":"reviews/day","ar":"مراجعة/يوم"}',
  '{"fa": "سقف بررسی روزانه‌ی هر متخصص", "en": "Daily review cap", "ar": "حد المراجعات اليومي"}',
  '{"fa":"سقف بررسی هر متخصص در ۲۴ ساعت (برای کنترل هزینه). صفر = بدون سقف.","en":"Per reviewer per 24h. 0 = no limit.","ar":"لكل مراجع. 0 = بلا حد."}',1012),
 ('review.points_verify','review','number',null,0,1000,'{"fa":"امتیاز","en":"points","ar":"نقاط"}',
  '{"fa": "امتیاز تایید نظر", "en": "Points: verify", "ar": "نقاط التوثيق"}',
  '{"fa":"امتیاز «تایید» یک نظر.","en":"Points for a verification.","ar":"نقاط التوثيق."}',1013),
 ('review.points_note','review','number',null,0,1000,'{"fa":"امتیاز","en":"points","ar":"نقاط"}',
  '{"fa": "امتیاز ثبت توضیح", "en": "Points: specialist note", "ar": "نقاط الملاحظة"}',
  '{"fa":"امتیاز «ثبت توضیح» (کار بیشتری می‌برد).","en":"Points for adding a specialist note.","ar":"نقاط إضافة ملاحظة."}',1014),
 ('review.points_none','review','number',null,0,1000,'{"fa":"امتیاز","en":"points","ar":"نقاط"}',
  '{"fa": "امتیاز نظر بدون نیاز به بررسی", "en": "Points: no review needed", "ar": "نقاط بلا مراجعة"}',
  '{"fa":"امتیاز «نیاز به بررسی ندارد».","en":"Points for marking a post as needing no review.","ar":"نقاط «لا تحتاج مراجعة»."}',1015),
 ('consult.points_answer','review','number',null,0,1000,'{"fa":"امتیاز","en":"points","ar":"نقاط"}',
  '{"fa": "امتیاز پاسخ به پرسش مشاوره", "en": "Points: consultation answer", "ar": "نقاط الإجابة"}',
  '{"fa":"امتیاز پاسخ به یک پرسش مشاوره.","en":"Points for answering a consultation question.","ar":"نقاط الإجابة."}',1016),
 ('review.max_minutes','review','number',null,1,240,'{"fa":"دقیقه","en":"minutes","ar":"دقيقة"}',
  '{"fa": "سقف دقیقه‌ی هر بررسی", "en": "Max minutes per review", "ar": "أقصى دقائق للمراجعة"}',
  '{"fa":"سقف زمانِ قابل‌حساب برای یک بررسی (در حالت پرداخت ساعتی).","en":"Max billable minutes per review (hourly mode).","ar":"أقصى دقائق لكل مراجعة."}',1017),
 ('review.pay_mode','review','enum','[{"value":"points","label":{"fa":"بر اساس امتیاز","en":"Per point","ar":"حسب النقاط"}},{"value":"hours","label":{"fa":"بر اساس ساعت کار","en":"Per working hour","ar":"حسب ساعات العمل"}}]'::jsonb,null,null,null,
  '{"fa":"شیوه‌ی محاسبه‌ی پرداخت","en":"Payment method","ar":"طريقة الدفع"}','{"fa":"فقط روی اعتبارهای تازه اثر دارد؛ اعتبارهای قبلی با نرخ همان زمان می‌مانند.","en":"Applies to new credits only.","ar":"يسري على الأرصدة الجديدة فقط."}',1018),
 ('review.rial_per_point','review','number',null,0,100000000,'{"fa":"ریال","en":"rial","ar":"ريال"}',
  '{"fa":"ارزش هر امتیاز","en":"Value of one point","ar":"قيمة النقطة"}','{"fa":"در حالت «بر اساس امتیاز».","en":"Used in per-point mode.","ar":"في وضع النقاط."}',1019),
 ('review.rial_per_hour','review','number',null,0,1000000000,'{"fa":"ریال","en":"rial","ar":"ريال"}',
  '{"fa":"نرخ هر ساعت کار","en":"Hourly rate","ar":"أجر الساعة"}','{"fa":"در حالت «بر اساس ساعت کار»؛ زمان از لحظه‌ی برداشتن نظر تا ثبت نتیجه حساب می‌شود.","en":"Used in hourly mode; time runs from claim to decision.","ar":"في وضع الساعات."}',1020),
 ('review.min_payout_rial','review','number',null,0,1000000000,'{"fa":"ریال","en":"rial","ar":"ريال"}',
  '{"fa":"حداقل مبلغ برای ثبت پرداخت","en":"Minimum payout","ar":"الحد الأدنى للدفع"}','{"fa":"تا رسیدن به این مبلغ، پرداخت ثبت نمی‌شود.","en":"Payouts below this are blocked.","ar":"لا يُسجل دفع أقل منه."}',1021)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
 ('forum.enabled','platform','true','فروم فعال'),
 ('forum.posts_per_day','platform','30','سقف پست روزانه'),
 ('consult.questions_per_day','platform','10','سقف پرسش مشاوره روزانه'),
 ('review.claim_minutes','platform','30','مهلت بررسی'),
 ('review.max_claims','platform','3','حداکثر نظر هم‌زمان'),
 ('review.daily_cap','platform','0','سقف بررسی روزانه'),
 ('review.points_verify','platform','3','امتیاز تایید'),
 ('review.points_note','platform','5','امتیاز توضیح'),
 ('review.points_none','platform','1','امتیاز بدون نیاز'),
 ('consult.points_answer','platform','4','امتیاز پاسخ مشاوره'),
 ('review.max_minutes','platform','15','سقف دقیقه'),
 ('review.pay_mode','platform','"points"','شیوه پرداخت'),
 ('review.rial_per_point','platform','0','ارزش هر امتیاز'),
 ('review.rial_per_hour','platform','0','نرخ ساعتی'),
 ('review.min_payout_rial','platform','0','حداقل پرداخت')
on conflict do nothing;

-- ===== 057_expert_qualification =====
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

