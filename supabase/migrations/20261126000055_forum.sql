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
