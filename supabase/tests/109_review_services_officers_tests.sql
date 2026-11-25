-- T206-T212: rejection needs a reason, resubmit, history, services, officer upsert,
-- cross-pharmacy isolation of page/look/collection editors, pharmacist bank
reset role;
insert into auth.users (id, email) values ('dddddddd-0000-0000-0000-000000000004', 'owner-r@test') on conflict do nothing;
create temp table t_rv as select (select id from public.cities where slug = 'tehran') city;
grant select on t_rv to anon, authenticated;

select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false) \gset ignore_
set role authenticated;
select public.register_pharmacy('داروخانه آزمون رد', 'test-owner-r', 'LIC-R-001', (select city from t_rv),
  'خیابان آزمون', 35.7, 51.4, '02100000000', 'دکتر آزمون', 'P-111') \gset ignore_
reset role;

-- Dorva: a rejection without a reason is refused; with a reason it is stored and logged
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid := (select id from public.pharmacies where slug = 'test-owner-r');
begin
  begin
    perform public.review_pharmacy(ph, false, null);
    raise exception 'TEST FAIL T206 reject without reason accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.review_pharmacy(ph, false, 'شماره پروانه با مدارک یکی نیست');
  if (select status from public.pharmacies where id = ph) <> 'rejected' then raise exception 'TEST FAIL T206 status'; end if;
  if (select count(*) from public.pharmacy_review_history(ph) where action = 'rejected') <> 1 then raise exception 'TEST FAIL T206 history'; end if;
  raise notice 'PASS T206 rejection needs a reason and is logged';
end $$;
reset role;

-- the pharmacy sees the reason, cannot change status directly, and resubmits
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid := (select id from public.pharmacies where slug = 'test-owner-r');
begin
  if (select note from public.pharmacy_review_history(ph) limit 1) is distinct from 'شماره پروانه با مدارک یکی نیست' then
    raise exception 'TEST FAIL T207 reason not visible';
  end if;
  begin
    update public.pharmacies set status = 'pending' where id = ph;
    raise exception 'TEST FAIL T207 direct status change allowed';
  exception when insufficient_privilege then null;
  end;
  if public.pharmacy_resubmit(ph, '{"message":""}') <> 'message' then raise exception 'TEST FAIL T207 empty message'; end if;
  if public.pharmacy_resubmit(ph, '{"license_no":"LIC-A-001","message":"اصلاح شد"}') <> 'license' then raise exception 'TEST FAIL T207 duplicate license'; end if;
  if public.pharmacy_resubmit(ph, '{"license_no":"LIC-R-002","message":"شماره پروانه اصلاح شد"}') <> 'ok' then raise exception 'TEST FAIL T207 resubmit'; end if;
  if (select status || license_no from public.pharmacies where id = ph) <> 'pendingLIC-R-002' then raise exception 'TEST FAIL T207 state'; end if;
  if public.pharmacy_resubmit(ph, '{"message":"دوباره"}') <> 'status' then raise exception 'TEST FAIL T207 resubmit twice'; end if;
  -- the guard is back on after the function
  begin
    update public.pharmacies set status = 'active' where id = ph;
    raise exception 'TEST FAIL T207 guard left open';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T207 reason visible, resubmit with corrections, guard stays on';
end $$;
reset role;

-- owner B may not resubmit or read another pharmacy's history
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid := (select id from public.pharmacies where slug = 'test-owner-r');
        pa uuid := (select id from public.pharmacies where slug = 'test-owner-a');
begin
  if exists (select 1 from public.pharmacy_review_history(ph)) then raise exception 'TEST FAIL T208 history leaked'; end if;
  begin
    perform public.pharmacy_resubmit(ph, '{"message":"x y z"}');
    raise exception 'TEST FAIL T208 foreign resubmit';
  exception when insufficient_privilege then null;
  end;
  -- cross-pharmacy editors (the reported "layout of an unrelated pharmacy")
  if public.can_manage_collections(pa) then raise exception 'TEST FAIL T209 collections of A'; end if;
  if app.can_edit_page(pa) then raise exception 'TEST FAIL T209 page of A'; end if;
  if app.can_edit_look(pa) then raise exception 'TEST FAIL T209 look of A'; end if;
  if public.my_pharmacy_access(pa) is not null then raise exception 'TEST FAIL T209 access label'; end if;
  begin
    perform public.page_editor(pa);
    raise exception 'TEST FAIL T209 page_editor of A';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.pharmacy_look_editor(pa);
    raise exception 'TEST FAIL T209 look editor of A';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.pharmacy_profile_get(pa);
    raise exception 'TEST FAIL T209 profile of A';
  exception when insufficient_privilege then null;
  end;
  if public.my_pharmacy_access((select id from public.pharmacies where slug = 'test-owner-b')) <> 'member' then raise exception 'TEST FAIL T209 own label'; end if;
  raise notice 'PASS T208-T209 no cross-pharmacy review, page, look, collection or profile access';
end $$;
reset role;

update public.settings set value = '"free"' where key = 'moderation.profile' and scope = 'platform';
-- services and officers: ids keep profile/resume across saves
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare pa uuid := (select id from public.pharmacies where slug = 'test-owner-a'); p jsonb; oid uuid := gen_random_uuid(); r text;
begin
  p := public.pharmacy_profile_get(pa);
  p := p || jsonb_build_object('service_codes', '["bp_check","home_delivery","nope"]'::jsonb,
    'officers', jsonb_build_array(jsonb_build_object('id', oid, 'full_name', 'دکتر نمونه', 'council_no', 'P-9', 'shifts', '[]'::jsonb,
      'profile', '{"degree":"PharmD","university":"تهران","years_total":"8","consent":true}'::jsonb,
      'resume', pa::text || '/resume-abcdef12.pdf')));
  r := public.pharmacy_profile_save(pa, p);
  if r <> 'ok' then raise exception 'TEST FAIL T210 save %', r; end if;
  if (select service_codes from public.pharmacies where id = pa) <> array['bp_check', 'home_delivery'] then
    raise exception 'TEST FAIL T210 services %', (select service_codes from public.pharmacies where id = pa);
  end if;
  -- second save without changes keeps the same officer row and its data
  r := public.pharmacy_profile_save(pa, public.pharmacy_profile_get(pa) - 'id');
  if r <> 'ok' then raise exception 'TEST FAIL T211 resave %', r; end if;
  p := public.pharmacy_profile_get(pa);
  if jsonb_array_length(p->'officers') <> 1 or (p->'officers'->0->>'id')::uuid <> oid
     or p->'officers'->0->'profile'->>'university' is distinct from 'تهران' or p->'officers'->0->>'resume' is null then
    raise exception 'TEST FAIL T211 officer data lost %', p->'officers';
  end if;
  -- a resume path in another pharmacy's folder is refused
  p := jsonb_set(public.pharmacy_profile_get(pa), '{officers,0,resume}', to_jsonb(gen_random_uuid()::text || '/resume-abcdef12.pdf'));
  if public.pharmacy_profile_save(pa, p) <> 'officer' then raise exception 'TEST FAIL T211 foreign resume path'; end if;
  if jsonb_array_length(public.pharmacy_about_public(pa)->'service_groups') <> 2 then raise exception 'TEST FAIL T210 public groups'; end if;
  if (public.pharmacy_about_public(pa)->'officers'->0) ? 'resume' then raise exception 'TEST FAIL T211 resume public'; end if;
  begin
    perform public.pharmacist_bank(null, true);
    raise exception 'TEST FAIL T212 bank open to pharmacies';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T210-T211 grouped services, officers kept by id, resume private';
end $$;
reset role;

select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
declare b jsonb;
begin
  b := public.pharmacist_bank('PharmD', false);
  if jsonb_array_length(b->'rows') < 1 then raise exception 'TEST FAIL T212 bank search'; end if;
  if (b->'rows'->0->'profile') ? 'resume_text' then raise exception 'TEST FAIL T212 resume text in list'; end if;
  if public.pharmacy_reopen((select id from public.pharmacies where slug = 'test-owner-a'), null) <> 'status' then
    raise exception 'TEST FAIL T212 reopen active';
  end if;
  if public.service_option_save('service', 'test_srv', 'nope', 'خدمت آزمون') <> 'group' then raise exception 'TEST FAIL T212 service group'; end if;
  if public.service_option_save('service', 'test_srv', 'checks', 'خدمت آزمون') <> 'ok' then raise exception 'TEST FAIL T212 service save'; end if;
  raise notice 'PASS T212 pharmacist bank, reopen, service catalog editing';
end $$;
reset role;
reset role;
update public.settings set value = '"approval"' where key = 'moderation.profile' and scope = 'platform';
