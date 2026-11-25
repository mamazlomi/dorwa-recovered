-- T110-T118: staff invitations, role templates, no escalation, last manager, holdings
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-000000000031', 'clerk@staff.test'),
  ('dddddddd-0000-0000-0000-000000000032', 'lite@staff.test'),
  ('dddddddd-0000-0000-0000-000000000033', 'outsider@staff.test'),
  ('dddddddd-0000-0000-0000-000000000034', 'holding@staff.test')
on conflict do nothing;

-- a test template that can manage staff but holds little else
insert into public.roles (scope, code, name_fa, is_system) values ('pharmacy', 'test_manager_lite', 'مدیر آزمون', true)
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select id, unnest(array['staff.manage', 'inventory.read']) from public.roles where code = 'test_manager_lite'
on conflict do nothing;
insert into public.memberships (user_id, pharmacy_id, role_id)
select 'dddddddd-0000-0000-0000-000000000032', (select id from public.pharmacies where slug = 'test-owner-a'), id
from public.roles where code = 'test_manager_lite';

select id as ph_a from public.pharmacies where slug = 'test-owner-a' \gset
select id as r_clerk from public.roles where scope = 'pharmacy' and code = 'inventory_clerk' and pharmacy_id is null \gset
select id as r_tech from public.roles where scope = 'pharmacy' and code = 'technical_officer' and pharmacy_id is null \gset
select id as r_owner from public.roles where scope = 'pharmacy' and code = 'owner' and pharmacy_id is null \gset
create temp table t_ids as select :'ph_a'::uuid ph, :'r_clerk'::uuid clerk, :'r_tech'::uuid tech, :'r_owner'::uuid owner;
grant select on t_ids to authenticated;

-- the owner of test-owner-a
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare c record; st text;
begin
  select * into c from t_ids;
  -- T110: memberships cannot be written directly
  begin
    insert into public.memberships (user_id, pharmacy_id, role_id) values ('dddddddd-0000-0000-0000-000000000033', c.ph, c.clerk);
    raise exception 'TEST FAIL T110: direct membership insert';
  exception when insufficient_privilege then null;
  end;
  -- T116: no custom pharmacy roles
  begin
    insert into public.roles (scope, pharmacy_id, code, name_fa) values ('pharmacy', c.ph, 'my_role', 'نقش من');
    raise exception 'TEST FAIL T116: custom role created';
  exception when insufficient_privilege then null;
  end;
  -- T111: invitations
  st := public.staff_invite(c.ph, c.tech, 'outsider@staff.test');
  if st <> 'license' then raise exception 'TEST FAIL T111: tech officer without licence -> %', st; end if;
  st := public.staff_invite(c.ph, c.clerk, 'Clerk@Staff.test');
  if st <> 'ok' then raise exception 'TEST FAIL T111: %', st; end if;
  raise notice 'PASS T110 T111 T116 direct writes refused, licence required, invitation sent';
end $$;
reset role;

-- T112: only the invited person can accept
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000033', false) \gset ignore_
set role authenticated;
do $$ begin
  if exists (select 1 from public.my_staff_invites()) then raise exception 'TEST FAIL T112: outsider sees invite'; end if;
  begin
    perform public.staff_invite_answer((select id from public.staff_invites where email = 'clerk@staff.test' limit 1), true);
    raise exception 'TEST FAIL T112: outsider accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000031', false) \gset ignore_
set role authenticated;
do $$
declare inv uuid; st text;
begin
  select id into inv from public.my_staff_invites() limit 1;
  if inv is null then raise exception 'TEST FAIL T112: invitee sees no invite'; end if;
  st := public.staff_invite_answer(inv, true);
  if st <> 'accepted' or not app.has_pharmacy_permission((select ph from t_ids), 'inventory.manage') then
    raise exception 'TEST FAIL T112: %', st;
  end if;
  -- T113: a clerk cannot invite
  begin
    perform public.staff_invite((select ph from t_ids), (select clerk from t_ids), 'x@staff.test');
    raise exception 'TEST FAIL T113: clerk invited';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T112-T113 invite accepted by the right person only; clerk cannot invite';
end $$;
reset role;

-- T114: a manager cannot grant more than they hold
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000032', false) \gset ignore_
set role authenticated;
do $$
declare st text;
begin
  st := public.staff_invite((select ph from t_ids), (select owner from t_ids), 'outsider@staff.test');
  if st <> 'role' then raise exception 'TEST FAIL T114: escalation to owner -> %', st; end if;
  st := public.staff_invite((select ph from t_ids), (select clerk from t_ids), 'outsider@staff.test');
  if st <> 'role' then raise exception 'TEST FAIL T114: granted inventory.manage without holding it -> %', st; end if;
  -- cannot touch the owner either
  st := public.staff_update((select id from public.memberships where pharmacy_id = (select ph from t_ids) and role_id = (select owner from t_ids) limit 1), 'disable');
  if st <> 'role' then raise exception 'TEST FAIL T114: lite manager disabled the owner -> %', st; end if;
  raise notice 'PASS T114 no escalation';
end $$;
reset role;

-- T115: with the lite manager removed, the owner is the last manager
delete from public.memberships where user_id = 'dddddddd-0000-0000-0000-000000000032';
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$
declare st text; m uuid;
begin
  select id into m from public.memberships where user_id = auth.uid() and pharmacy_id = (select ph from t_ids) and role_id = (select owner from t_ids);
  if m is null then raise notice 'SKIP T115: owner membership not found'; return; end if;
  st := public.staff_update(m, 'remove');
  if st <> 'last_manager' then raise exception 'TEST FAIL T115: %', st; end if;
  st := public.staff_update(m, 'role', (select clerk from t_ids));
  if st <> 'last_manager' then raise exception 'TEST FAIL T115: demoted last owner -> %', st; end if;
  if (select count(*) from public.staff_list((select ph from t_ids))) < 2 then raise exception 'TEST FAIL T115: staff list'; end if;
  raise notice 'PASS T115 last manager protected, staff list';
end $$;
reset role;

-- T117-T118: holdings need the pharmacy's consent and never see customers
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000034', false) \gset ignore_
set role authenticated;
create temp table t_h (id uuid);
do $$
declare h uuid; st text;
begin
  h := public.holding_create('هلدینگ آزمون');
  insert into t_h values (h);
  st := public.holding_request(h, 'test-owner-a', 'سلام');
  if st <> 'ok' then raise exception 'TEST FAIL T117: request %', st; end if;
  if exists (select 1 from public.holding_stats(h)) or exists (select 1 from public.holding_stock(h, (select ph from t_ids))) then
    raise exception 'TEST FAIL T117: data before approval';
  end if;
  -- cannot approve its own request
  begin
    perform public.holding_link_decide((select id from public.holding_links where holding_id = h), 'approve');
    raise exception 'TEST FAIL T117: holding approved itself';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
grant select on t_h to authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ declare st text; begin
  st := public.holding_link_decide((select l.id from public.pharmacy_holding_links((select ph from t_ids)) l limit 1), 'approve');
  if st <> 'ok' then raise exception 'TEST FAIL T117: approve %', st; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000034', false) \gset ignore_
set role authenticated;
do $$
declare h uuid := (select id from t_h);
begin
  if (select count(*) from public.holding_stats(h)) <> 1 then raise exception 'TEST FAIL T117: stats after approval'; end if;
  if exists (select 1 from public.holding_orders(h, (select ph from t_ids)) o
             where o.items::text ~* 'recipient|phone|address|user_id') then
    raise exception 'TEST FAIL T118: customer data leaked';
  end if;
  -- the holding cannot read the pharmacy's raw orders or stock tables
  if exists (select 1 from public.orders) or exists (select 1 from public.customer_addresses) then
    raise exception 'TEST FAIL T118: raw customer tables visible';
  end if;
  raise notice 'PASS T117-T118 holding link needs consent; aggregates without customer data';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) \gset ignore_
set role authenticated;
do $$ begin
  perform public.holding_link_decide((select l.id from public.pharmacy_holding_links((select ph from t_ids)) l where l.status = 'active' limit 1), 'revoke');
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000034', false) \gset ignore_
set role authenticated;
do $$ begin
  if exists (select 1 from public.holding_stats((select id from t_h))) then raise exception 'TEST FAIL T117: data after revoke'; end if;
  raise notice 'PASS T117b pharmacy can cut the link';
end $$;
reset role;
