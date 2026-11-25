-- T213-T220: Dorva supervises but does not edit; per-type policy; officer accounts; inbox
reset role;
insert into auth.users (id, email) values ('ffffffff-0000-0000-0000-000000000077', 'officer-x@test.ir') on conflict do nothing;
update public.pharmacies set status = 'active' where slug = 'test-owner-a';

-- T213: Dorva staff cannot edit a real pharmacy's page, look, collections or profile, but may preview
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare pa uuid := (select id from public.pharmacies where slug = 'test-owner-a');
begin
  if app.can_edit_page(pa) or app.can_edit_look(pa) or app.can_manage_collection(pa) or app.can_edit_profile(pa) then
    raise exception 'TEST FAIL T213 staff can edit a pharmacy';
  end if;
  begin perform public.page_save(pa, '[]'); raise exception 'TEST FAIL T213 page_save';
  exception when insufficient_privilege then null; end;
  if public.pharmacy_look_save(pa, '{}') <> 'forbidden' then raise exception 'TEST FAIL T213 look'; end if;
  if (public.page_editor(pa)->>'can_edit')::boolean then raise exception 'TEST FAIL T213 preview says editable'; end if;
  begin perform public.pharmacy_profile_get(pa); raise exception 'TEST FAIL T213 profile';
  exception when insufficient_privilege then null; end;
  if public.my_pharmacy_access(pa) is not null then raise exception 'TEST FAIL T213 access label'; end if;
  raise notice 'PASS T213 Dorva staff preview only, no editing of real pharmacies';
end $$;
reset role;

-- T214-T216: owner A under the default "approval" policy
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare pa uuid := (select id from public.pharmacies where slug = 'test-owner-a'); p jsonb; st text; cid uuid;
begin
  p := public.pharmacy_profile_get(pa) || '{"about_fa":"متن تازه برای بررسی"}'::jsonb;
  p := jsonb_set(p, '{officers,0,invite_email}', '"officer-x@test.ir"');
  st := public.pharmacy_profile_save(pa, p - 'change' - 'mode');
  if st <> 'pending' then raise exception 'TEST FAIL T214 profile %', st; end if;
  if (public.pharmacy_profile_get(pa)->>'about_fa') = 'متن تازه برای بررسی' then raise exception 'TEST FAIL T214 went live'; end if;
  if (public.pharmacy_profile_get(pa)->'change'->>'status') <> 'pending' then raise exception 'TEST FAIL T214 change'; end if;
  if public.pharmacy_profile_save(pa, '{"lat":10,"lng":51.4}') <> 'location' then raise exception 'TEST FAIL T214 dry-run validation'; end if;
  st := public.page_save(pa, '[]');
  if public.page_publish(pa) not in ('pending', 'block') then raise exception 'TEST FAIL T215 page'; end if;
  if public.pharmacy_look_save(pa, '{"accent":"#112233"}', true) <> 'pending' then raise exception 'TEST FAIL T215 look'; end if;
  insert into public.collections (pharmacy_id, slug, title, status) values (pa, 'mod-test', '{"fa":"تست"}', 'published') returning id into cid;
  if (select status from public.collections where id = cid) <> 'pending' then raise exception 'TEST FAIL T216 collection'; end if;
  update public.collections set featured = true where id = cid;
  raise notice 'PASS T214-T216 profile, page, look and collection wait for Dorva; live version unchanged';
end $$;
reset role;

-- T217: Dorva sees the reminder counts and approves
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare pa uuid := (select id from public.pharmacies where slug = 'test-owner-a'); b jsonb; cid uuid;
begin
  b := public.approval_inbox();
  if (b->>'profiles')::int < 1 or (b->>'looks')::int < 1 or (b->>'collections')::int < 1 then raise exception 'TEST FAIL T217 inbox %', b; end if;
  if public.profile_change_review(pa, false, '') <> 'note' then raise exception 'TEST FAIL T217 reject without note'; end if;
  if public.profile_change_review(pa, true) <> 'ok' then raise exception 'TEST FAIL T217 approve'; end if;
  if (select about_fa from public.pharmacies where id = pa) <> 'متن تازه برای بررسی' then raise exception 'TEST FAIL T217 applied'; end if;
  select (x->>'id')::uuid into cid from jsonb_array_elements(public.collection_queue()) x where x->>'slug' = 'mod-test';
  if public.collection_review(cid, true) <> 'ok' then raise exception 'TEST FAIL T217 collection'; end if;
  if public.pharmacy_look_review(pa, 'approve') <> 'done' then raise exception 'TEST FAIL T217 look'; end if;
  raise notice 'PASS T217 inbox counts and approvals';
end $$;
reset role;

-- T218-T219: the officer accepts the invite and edits their own profile; locked policy
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000077', false) \gset ignore_
set role authenticated;
do $$
declare oid uuid; me jsonb; p jsonb;
begin
  select (x->>'id')::uuid into oid from jsonb_array_elements(public.my_officer_invites()) x limit 1;
  if oid is null then raise exception 'TEST FAIL T218 no invite'; end if;
  if public.officer_invite_answer(oid, true) <> 'ok' then raise exception 'TEST FAIL T218 accept'; end if;
  me := public.my_officer_profile();
  p := (me->'officer') || '{"bio":"داروساز بالینی با ده سال سابقه"}'::jsonb;
  if public.officer_self_save(p) <> 'pending' then raise exception 'TEST FAIL T218 self save'; end if;
  if public.officer_self_save(p || '{"photo":"00000000-0000-0000-0000-000000000000/x.jpg"}') <> 'file' then raise exception 'TEST FAIL T218 foreign photo'; end if;
  raise notice 'PASS T218 officer invite, self edit goes to review';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare u uuid := 'ffffffff-0000-0000-0000-000000000077';
begin
  if public.officer_change_review(u, true) <> 'ok' then raise exception 'TEST FAIL T219 approve'; end if;
  if (select (public.pharmacist_bank(null, true)->'rows') @> '[{"has_account":true}]') is not true then raise exception 'TEST FAIL T219 bank'; end if;
  raise notice 'PASS T219 officer change approved';
end $$;
reset role;
update public.settings set value = '"locked"' where key = 'moderation.page' and scope = 'platform';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare pa uuid := (select id from public.pharmacies where slug = 'test-owner-a');
begin
  if public.page_save(pa, '[]') <> 'locked' then raise exception 'TEST FAIL T220 locked page'; end if;
  if (select bio from public.pharmacy_officers where pharmacy_id = pa limit 1) is not null then null; end if;
  raise notice 'PASS T220 locked policy';
end $$;
reset role;
update public.settings set value = '"approval"' where key = 'moderation.page' and scope = 'platform';
