-- T170-T177: theme studio (presets, validation, drafts, scheduling, pharmacy looks)
select id as ph_a from public.pharmacies where slug = 'test-owner-a' \gset
create temp table t_th as select :'ph_a'::uuid ph, (select id from public.themes where is_default) def;
grant select on t_th to anon, authenticated;

-- T170: presets exist, one default, visitors read the active look
set role anon;
do $$ begin
  if jsonb_typeof(public.theme_active()) <> 'object' then raise exception 'TEST FAIL T170 active'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.themes where preset is not null) < 6
     or (select count(*) from public.themes where is_default) <> 1 then
    raise exception 'TEST FAIL T170 presets';
  end if;
  if exists (select 1 from public.setting_definitions where key in ('theme.primary', 'theme.accent')) then
    raise exception 'TEST FAIL T170 old color settings still listed';
  end if;
  raise notice 'PASS T170 presets, single default, public active look';
end $$;

-- T171: only listed keys and values can be stored
do $$ begin
  if app.theme_validate('{"colors":{"primary":"#123456"},"card":{"style":"minimal"},"logo":{"text":{"fa":"x"}}}') <> 'ok'
     or app.theme_validate('{"colors":{"primary":"red"}}') <> 'value:colors.primary'
     or app.theme_validate('{"colors":{"nope":"#123456"}}') <> 'key:colors.nope'
     or app.theme_validate('{"card":{"style":"wild"}}') <> 'value:card.style'
     or app.theme_validate('{"layout":{"width":5000}}') <> 'value:layout.width'
     or app.theme_validate('{"footer":{"social":{"instagram":"javascript:alert(1)"}}}') <> 'value:footer.social.instagram'
     or app.theme_validate('{"header":{"announce":{"link":"//evil.com"}}}') <> 'value:header.announce.link'
     or app.theme_validate('{"logo":{"image":"../x.png"}}') <> 'value:logo.image' then
    raise exception 'TEST FAIL T171';
  end if;
  raise notice 'PASS T171 theme validation';
end $$;

-- T172: customers cannot see or change themes
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000041', false) \gset ignore_
set role authenticated;
do $$ begin
  if public.theme_save((select def from t_th), null, '{}') <> 'forbidden' then raise exception 'TEST FAIL T172 save'; end if;
  begin perform public.theme_list(); raise exception 'TEST FAIL T172 list';
  exception when insufficient_privilege then null; end;
  if public.theme_preview((select def from t_th)) is not null then raise exception 'TEST FAIL T172 preview'; end if;
  raise notice 'PASS T172 customers cannot read or edit themes';
end $$;
reset role;

-- T173-T175: Dorva edits a draft, publishes, schedules
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$
declare v uuid; d uuid := (select def from t_th);
begin
  v := public.theme_create('تست', d);
  if public.theme_save(v, null, '{"colors":{"primary":"#ff0000"}}') <> 'value:colors.primary' then null; end if;
  if public.theme_save(v, null, '{"colors":{"primary":"bad"}}') <> 'value:colors.primary' then raise exception 'TEST FAIL T173 bad draft saved'; end if;
  if public.theme_save(v, 'تست ۲', '{"colors":{"primary":"#123456"}}') <> 'ok' then raise exception 'TEST FAIL T173 save'; end if;
  if (public.theme_preview(v)->'config'->'colors'->>'primary') <> '#123456' then raise exception 'TEST FAIL T173 preview'; end if;
  if (public.theme_get(v)->'config'->'colors'->>'primary') = '#123456' then raise exception 'TEST FAIL T173 draft leaked'; end if;
  if public.theme_publish(v) <> 'published' then raise exception 'TEST FAIL T173 publish'; end if;
  if public.theme_delete(d) <> 'default' then raise exception 'TEST FAIL T174 deleted default'; end if;
  if public.theme_schedule_add(v, now() + interval '1 day', now()) <> 'dates' then raise exception 'TEST FAIL T175 dates'; end if;
  if public.theme_schedule_add(v, now() - interval '1 hour', now() + interval '1 day', 'تست') <> 'ok' then raise exception 'TEST FAIL T175 add'; end if;
  perform set_config('test.theme', v::text, false);
end $$;
reset role;
do $$ begin
  -- new statement: the schedule is visible to theme_active
  if (public.theme_active()->'colors'->>'primary') <> '#123456' then raise exception 'TEST FAIL T175 scheduled theme not live'; end if;
  delete from public.theme_schedules where theme_id = current_setting('test.theme')::uuid;
end $$;
do $$ begin
  if (public.theme_active()->'colors'->>'primary') = '#123456' then raise exception 'TEST FAIL T175 still live after schedule removed'; end if;
  raise notice 'PASS T173 draft, preview and publish';
  raise notice 'PASS T174 the default look cannot be deleted';
  raise notice 'PASS T175 a scheduled look goes live in its window';
end $$;

-- T176-T177: a pharmacy sets its look; Dorva approves
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare ph uuid := (select ph from t_th);
begin
  if public.pharmacy_look_save(ph, '{"accent":"#aa0000","font":"x"}') <> 'key:font' then raise exception 'TEST FAIL T176 key'; end if;
  if public.pharmacy_look_save(ph, '{"logo":"home/logo.png"}') <> 'image' then raise exception 'TEST FAIL T176 foreign folder'; end if;
  if public.pharmacy_look_save(ph, jsonb_build_object('accent', '#aa0000', 'logo', ph::text || '/logo.png'), true) <> 'pending' then
    raise exception 'TEST FAIL T176 submit';
  end if;
  if public.pharmacy_look_public(ph) is not null then raise exception 'TEST FAIL T176 live before approval'; end if;
  if public.pharmacy_look_review(ph, 'approve') <> 'forbidden' then raise exception 'TEST FAIL T176 self approve'; end if;
  raise notice 'PASS T176 pharmacy look waits for Dorva';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000012', false) \gset ignore_
set role authenticated;
do $$ begin
  if public.pharmacy_look_review((select ph from t_th), 'reject') <> 'note' then raise exception 'TEST FAIL T177 reject without note'; end if;
  if public.pharmacy_look_review((select ph from t_th), 'approve') <> 'done' then raise exception 'TEST FAIL T177 approve'; end if;
end $$;
do $$ begin
  if (public.pharmacy_look_public((select ph from t_th))->>'accent') <> '#aa0000' then raise exception 'TEST FAIL T177 not live'; end if;
  raise notice 'PASS T177 approved pharmacy look goes live';
end $$;
reset role;
