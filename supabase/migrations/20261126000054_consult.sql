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
