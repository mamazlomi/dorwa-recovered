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
