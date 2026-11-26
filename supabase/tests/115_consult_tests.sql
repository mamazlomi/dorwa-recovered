-- T250-T256: SMS code table is closed to browsers; forum, consultants, verified answers, magazine
reset role;
insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000001', 'asker@test.local'),
  ('c0000000-0000-0000-0000-000000000002', 'expert@test.local'),
  ('c0000000-0000-0000-0000-000000000003', 'boss@test.local'),
  ('c0000000-0000-0000-0000-000000000004', 'other@test.local')
on conflict do nothing;
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'c0000000-0000-0000-0000-000000000003', null, r.id from public.roles r
where r.scope = 'platform' and r.code = 'super_admin'
on conflict do nothing;

-- T250: nobody but the service role touches SMS codes
insert into public.phone_otps (phone, code_hash, expires_at) values ('09120000000', 'x', now() + interval '2 minutes');
set role authenticated;
do $$ begin
  begin perform 1 from public.phone_otps limit 1; raise exception 'TEST FAIL T250 authenticated reads codes';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T250 SMS codes closed to browsers';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from public.phone_otps limit 1; raise exception 'TEST FAIL T250 anon reads codes';
  exception when insufficient_privilege then null; end;
  begin insert into public.phone_otps (phone, code_hash, expires_at) values ('09120000001', 'x', now()); raise exception 'TEST FAIL T250 anon writes codes';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T250b anon cannot read or write SMS codes';
end $$;
reset role;

-- T251: ask a question (public and private), limits
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare q uuid; q2 uuid;
begin
  insert into public.consult_questions (title, body, topic, is_public)
  values ('آیا استامینوفن با آنتی‌بیوتیک مصرف شود؟', 'من آموکسی‌سیلین می‌خورم و سردرد دارم؛ می‌توانم استامینوفن بخورم؟', 'drug', true) returning id into q;
  insert into public.consult_questions (title, body, topic, is_public)
  values ('سوال خصوصی من', 'این پرسش فقط برای مشاور است و نباید عمومی شود.', 'general', false) returning id into q2;
  if (select asker_id from public.consult_questions where id = q) <> 'c0000000-0000-0000-0000-000000000001' then raise exception 'TEST FAIL T251 asker'; end if;
  begin insert into public.consult_questions (title, body) values ('کوتاه', 'کم'); raise exception 'TEST FAIL T251 short question accepted';
  exception when check_violation then null; end;
  perform set_config('app.t_q', q::text, false);
  perform set_config('app.t_q2', q2::text, false);
  raise notice 'PASS T251 signed-in user asks public and private questions, bad input rejected';
end $$;
reset role;

-- T252: visibility
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000004', false) \gset ignore_
set role authenticated;
do $$ begin
  if (select count(*) from public.consult_questions where id = current_setting('app.t_q')::uuid) <> 1 then raise exception 'TEST FAIL T252 public hidden'; end if;
  if (select count(*) from public.consult_questions where id = current_setting('app.t_q2')::uuid) <> 0 then raise exception 'TEST FAIL T252 private leaked'; end if;
  begin update public.consult_questions set title = 'تغییر توسط غریبه برای سوال' where id = current_setting('app.t_q')::uuid;
    if found then raise exception 'TEST FAIL T252 stranger edited'; end if;
  exception when insufficient_privilege then null; end;
  begin insert into public.consult_answers (question_id, body) values (current_setting('app.t_q')::uuid, 'من مشاور نیستم ولی جواب می‌دهم');
    raise exception 'TEST FAIL T252 non-expert answered';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T252 public visible, private hidden from strangers, non-expert cannot answer';
end $$;
reset role;
set role anon;
do $$ begin
  if (select count(*) from public.consult_questions where id = current_setting('app.t_q')::uuid) <> 1 then raise exception 'TEST FAIL T252 anon public'; end if;
  if (select count(*) from public.consult_questions where id = current_setting('app.t_q2')::uuid) <> 0 then raise exception 'TEST FAIL T252 anon private'; end if;
  raise notice 'PASS T252b visitors read public questions only';
end $$;
reset role;

-- T253: consultant signs up, cannot approve himself, staff approve
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', false) \gset ignore_
set role authenticated;
do $$ begin
  insert into public.consult_experts (user_id, display_name, specialty, status)
  values ('c0000000-0000-0000-0000-000000000002', 'دکتر نمونه', 'pharmacist', 'approved');
  if (select status from public.consult_experts where user_id = 'c0000000-0000-0000-0000-000000000002') <> 'pending' then raise exception 'TEST FAIL T253 self approved'; end if;
  begin update public.consult_experts set status = 'approved' where user_id = 'c0000000-0000-0000-0000-000000000002';
    raise exception 'TEST FAIL T253 self approval via update';
  exception when insufficient_privilege then null; end;
  begin insert into public.consult_answers (question_id, body) values (current_setting('app.t_q')::uuid, 'پیش از تایید نباید بتوانم پاسخ بدهم');
    raise exception 'TEST FAIL T253 pending expert answered';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T253 consultant cannot approve himself or answer before approval';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$ begin
  update public.consult_experts set status = 'approved' where user_id = 'c0000000-0000-0000-0000-000000000002';
  if (select reviewed_by from public.consult_experts where user_id = 'c0000000-0000-0000-0000-000000000002') is distinct from 'c0000000-0000-0000-0000-000000000003'::uuid then raise exception 'TEST FAIL T253 reviewer not stored'; end if;
  raise notice 'PASS T253b staff approve consultant, reviewer recorded';
end $$;
reset role;

-- T254: approved consultant answers, marks cannot be self-set, question flips to answered
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000002', false) \gset ignore_
set role authenticated;
do $$
declare a uuid;
begin
  if (select count(*) from public.consult_questions where id = current_setting('app.t_q2')::uuid) <> 1 then raise exception 'TEST FAIL T254 expert cannot see private'; end if;
  insert into public.consult_answers (question_id, body, verified)
  values (current_setting('app.t_q')::uuid, 'مصرف همزمان استامینوفن و آموکسی‌سیلین معمولاً مشکلی ندارد؛ به دوز توجه کنید.', true) returning id into a;
  if (select verified from public.consult_answers where id = a) then raise exception 'TEST FAIL T254 self verified'; end if;
  begin update public.consult_answers set verified = true where id = a; raise exception 'TEST FAIL T254 self verify by update';
  exception when insufficient_privilege then null; end;
  if (select status from public.consult_questions where id = current_setting('app.t_q')::uuid) <> 'answered' then raise exception 'TEST FAIL T254 status'; end if;
  perform set_config('app.t_a', a::text, false);
  raise notice 'PASS T254 approved consultant answers; cannot mark own answer verified; question becomes answered';
end $$;
reset role;

-- T255: staff verify, everybody sees the mark and the counts
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$ begin
  update public.consult_answers set verified = true where id = current_setting('app.t_a')::uuid;
  if not (select verified from public.consult_answers where id = current_setting('app.t_a')::uuid) then raise exception 'TEST FAIL T255 verify'; end if;
  if (select verified_by from public.consult_answers where id = current_setting('app.t_a')::uuid) is distinct from 'c0000000-0000-0000-0000-000000000003'::uuid then raise exception 'TEST FAIL T255 verified_by'; end if;
  raise notice 'PASS T255 staff verify an answer';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$ begin
  if (select answers from public.consult_answer_counts(array[current_setting('app.t_q')::uuid])) <> 1 then raise exception 'TEST FAIL T255 count'; end if;
  if (select verified from public.consult_answer_counts(array[current_setting('app.t_q')::uuid])) <> 1 then raise exception 'TEST FAIL T255 verified count'; end if;
  if (select count(*) from public.consult_answers where question_id = current_setting('app.t_q2')::uuid) <> 0 then raise exception 'TEST FAIL T255 answers of private'; end if;
  raise notice 'PASS T255b visitors see answers and the verified count of public questions';
end $$;
reset role;

-- T256: magazine
select set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$ begin
  insert into public.magazine_articles (slug, title, body, status)
  values ('vitamin-d-basics', 'ویتامین د چه زمانی لازم است؟', repeat('متن علمی نمونه برای مقاله. ', 10), 'published');
  insert into public.magazine_articles (slug, title, body)
  values ('draft-article', 'پیش‌نویس مقاله هنوز منتشر نشده', repeat('متن پیش‌نویس نمونه. ', 10));
  if (select published_at from public.magazine_articles where slug = 'vitamin-d-basics') is null then raise exception 'TEST FAIL T256 published_at'; end if;
  raise notice 'PASS T256 staff write articles, publish date set';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) \gset ignore_
set role anon;
do $$ begin
  if (select count(*) from public.magazine_articles) <> 1 then raise exception 'TEST FAIL T256 drafts visible'; end if;
  begin insert into public.magazine_articles (slug, title, body) values ('hack-article', 'مقاله از طرف مهمان', repeat('x', 60)); raise exception 'TEST FAIL T256 anon wrote';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T256b visitors read only published articles';
end $$;
reset role;
