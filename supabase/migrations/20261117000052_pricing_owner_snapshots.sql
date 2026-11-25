-- 1) Who prices a product is set per product in the product hub: the price policy (Dorva fixed price, or the
--    pharmacy within a cap / above a floor / freely) plus, per product, whether a pharmacy's price change
--    needs Dorva's approval (empty = the general setting pricing.approval).
-- 2) Configuration snapshots for testing: save the current configuration under a name and bring it back
--    with one action. Only configuration is saved and restored (settings, policies, pages, looks,
--    collections, product listings and settings, and optionally pharmacy stock). Users, pharmacies,
--    orders, payments and the catalog itself are never touched. A restore first saves the current state,
--    so a restore can itself be undone.

set search_path = public, extensions;

-- ---------------------------------------------------------------- pharmacy price approval per product
alter table public.product_settings add column if not exists price_approval boolean;

create or replace function app.stock_price_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old numeric := case when tg_op = 'UPDATE' then old.price end; v_need boolean;
begin
  if current_setting('app.price_approving', true) = 'on' then return new; end if;
  if new.price is not distinct from v_old then return new; end if;
  if new.price is null then
    new.price_requested := null; new.price_requested_at := null;
    return new;
  end if;
  select price_approval into v_need from product_settings where product_id = new.product_id;
  if not coalesce(v_need, app.setting_bool('pricing.approval', true)) or app.has_platform_permission('policy.manage')
     or auth.uid() is null then
    new.price_requested := null; new.price_requested_at := null;
    return new;
  end if;
  new.price_requested := new.price;
  new.price_requested_at := now();
  new.price_review_note := null;
  new.price := v_old;
  return new;
end $$;

-- the product hub reads and saves the new column
create or replace function public.admin_products() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_platform_permission('catalog.publish') or app.has_platform_permission('policy.manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'name_fa', p.name_fa, 'name_i18n', p.name_i18n, 'cls', p.dispensing_class, 'path', p.category_path,
      'brand', (select coalesce(v.name_fa, b) from jsonb_array_elements_text(case when jsonb_typeof(p.facets->'brand') = 'array' then p.facets->'brand' else '[]' end) b
                 left join catalog_facet_values v on v.facet_key = 'brand' and v.value_code = b limit 1),
      'maker', (select coalesce(v.name_fa, b) from jsonb_array_elements_text(case when jsonb_typeof(p.facets->'manufacturer') = 'array' then p.facets->'manufacturer' else '[]' end) b
                 left join catalog_facet_values v on v.facet_key = 'manufacturer' and v.value_code = b limit 1),
      'src', p.source, 'complete', p.complete, 'missing', case when cardinality(p.missing) > 0 then p.missing end,
      'code', p.internal_code, 'irc', p.irc, 'gtin', p.gtin,
      'pub', coalesce(l.is_published, false), 'price', l.base_price, 'policy', coalesce(l.price_policy, 'fixed'),
      'pcap', r.max_discount_pct, 'cap', c.max_discount_pct, 'cap_src', c.source,
      'stock', (select count(*) from stock_items s join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
                 where s.product_id = p.id and s.quantity > 0),
      'min', ps.min_price, 'maxq', ps.max_per_order, 'comm', ps.commission_pct, 'comm_eff', app.commission_pct(p.dispensing_class, p.id),
      'tech', ps.tech_approval, 'tech_eff', p.requires_tech_approval, 'badge', ps.badge,
      'pappr', ps.price_approval, 'pappr_eff', coalesce(ps.price_approval, app.setting_bool('pricing.approval', true)))) order by p.name_fa), '[]'::jsonb)
    from catalog_products p
    left join product_listings l on l.product_id = p.id
    left join product_settings ps on ps.product_id = p.id
    left join discount_caps r on r.scope = 'product' and r.product_id = p.id and r.is_active
    cross join lateral public.discount_cap(p.id) c
    where p.is_active);
end $$;

-- one save for the whole hub: listing fields go through listing_bulk_save, the rest are settled here
-- security definer: product_settings has no write policy; every write is checked here by permission
create or replace function public.product_admin_save(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; v_pid uuid; v_list jsonb := '[]'; v_res jsonb; v_err jsonb := '[]'; v_bad text[] := '{}'; v_n int := 0;
  k text; v_cls text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 2000 then
    return jsonb_build_object('ok', 0, 'errors', jsonb_build_array(jsonb_build_object('id', null, 'code', 'too_many')));
  end if;
  select coalesce(jsonb_agg(x), '[]') into v_list
    from (select jsonb_object_agg(e.key, e.value) x
            from jsonb_array_elements(p_items) with ordinality t(i, n), jsonb_each(t.i) e
           where e.key in ('id', 'is_published', 'base_price', 'price_policy', 'product_cap')
           group by n having count(*) > 1) y;
  if jsonb_array_length(v_list) > 0 then
    v_res := public.listing_bulk_save(v_list);
    v_err := v_err || coalesce(v_res->'errors', '[]');
    select coalesce(array_agg(e->>'id'), '{}') into v_bad from jsonb_array_elements(v_err) e;
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    continue when (it->>'id') = any (v_bad);
    if not (it ?| array['max_per_order', 'min_price', 'commission_pct', 'tech_approval', 'badge', 'price_approval']) then
      v_n := v_n + 1; continue;
    end if;
    begin
      v_pid := (it->>'id')::uuid;
      select dispensing_class into v_cls from catalog_products where id = v_pid;
      if v_cls is null then v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'missing'); continue; end if;
      if (it ? 'max_per_order' and it->>'max_per_order' is not null and (it->>'max_per_order' !~ '^[0-9]{1,3}$' or (it->>'max_per_order')::int < 1))
         or (it ? 'min_price' and it->>'min_price' is not null and it->>'min_price' !~ '^[0-9]{1,13}$')
         or (it ? 'commission_pct' and it->>'commission_pct' is not null and (it->>'commission_pct' !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or (it->>'commission_pct')::numeric > 100))
         or (it ? 'tech_approval' and it->>'tech_approval' is not null and it->>'tech_approval' not in ('true', 'false'))
         or (it ? 'price_approval' and it->>'price_approval' is not null and it->>'price_approval' not in ('true', 'false'))
         or (it ? 'badge' and it->>'badge' is not null and not exists (select 1 from product_badges where code = it->>'badge' and is_active)) then
        v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'value'); continue;
      end if;
      if v_cls = 'rx' and it->>'tech_approval' = 'false' then
        v_err := v_err || jsonb_build_object('id', it->>'id', 'code', 'rx_tech'); continue;
      end if;
      if it ? 'commission_pct' and not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
      if it ? 'price_approval' and not app.has_platform_permission('policy.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
      if (it ?| array['max_per_order', 'min_price', 'tech_approval', 'badge']) and not app.has_platform_permission('catalog.publish') then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      insert into product_settings as s (product_id, max_per_order, min_price, commission_pct, tech_approval, badge, price_approval, updated_by, updated_at)
      values (v_pid, (it->>'max_per_order')::int, (it->>'min_price')::numeric, (it->>'commission_pct')::numeric,
              (it->>'tech_approval')::boolean, it->>'badge', (it->>'price_approval')::boolean, auth.uid(), now())
      on conflict (product_id) do update set
        max_per_order = case when it ? 'max_per_order' then excluded.max_per_order else s.max_per_order end,
        min_price = case when it ? 'min_price' then excluded.min_price else s.min_price end,
        commission_pct = case when it ? 'commission_pct' then excluded.commission_pct else s.commission_pct end,
        tech_approval = case when it ? 'tech_approval' then excluded.tech_approval else s.tech_approval end,
        badge = case when it ? 'badge' then excluded.badge else s.badge end,
        price_approval = case when it ? 'price_approval' then excluded.price_approval else s.price_approval end,
        updated_by = auth.uid(), updated_at = now();
      v_n := v_n + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('id', it->>'id', 'code', case when sqlstate = '42501' then 'forbidden' when sqlstate = '23514' then 'value' else 'unknown' end);
    end;
  end loop;
  return jsonb_build_object('ok', v_n, 'errors', v_err);
end $$;


-- ---------------------------------------------------------------- configuration snapshots
create table if not exists public.config_snapshots (
  id          bigserial primary key,
  name        text not null check (length(btrim(name)) between 1 and 120),
  note        text check (note is null or length(note) <= 500),
  groups      text[] not null,
  data        jsonb not null,
  counts      jsonb not null,
  auto        boolean not null default false,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table public.config_snapshots enable row level security;

-- tables in dependency order (parents first). Group "stock" is optional.
create or replace function app.snapshot_tables() returns table (grp text, tbl text, ord int)
language sql immutable as $$
  values
    ('settings', 'settings', 10), ('settings', 'category_policies', 11), ('settings', 'category_names', 12),
    ('settings', 'discount_caps', 13), ('settings', 'discount_rules', 14), ('settings', 'catalog_filters', 15),
    ('settings', 'complement_rules', 16), ('settings', 'product_complements', 17), ('settings', 'notify_events', 18),
    ('settings', 'seo_pages', 19), ('settings', 'seo_redirects', 20), ('settings', 'pharmacy_service_groups', 21),
    ('settings', 'pharmacy_service_options', 22), ('settings', 'product_badges', 23),
    ('pages', 'themes', 30), ('pages', 'theme_schedules', 31), ('pages', 'page_layouts', 32), ('pages', 'dashboard_layouts', 33),
    ('pages', 'pharmacy_looks', 34), ('pages', 'collections', 35),
    ('products', 'product_listings', 40), ('products', 'product_settings', 41),
    ('stock', 'stock_items', 50), ('stock', 'stock_batches', 51), ('stock', 'pharmacy_shipping', 52)
$$;

create or replace function app.snapshot_take(p_name text, p_groups text[], p_auto boolean, p_note text default null) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_data jsonb := '{}'; v_counts jsonb := '{}'; v_rows jsonb; v_id bigint;
begin
  for r in select * from app.snapshot_tables() where grp = any (p_groups) order by ord loop
    continue when to_regclass('public.' || r.tbl) is null;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from public.%I t', r.tbl) into v_rows;
    v_data := v_data || jsonb_build_object(r.tbl, v_rows);
    v_counts := v_counts || jsonb_build_object(r.tbl, jsonb_array_length(v_rows));
  end loop;
  insert into config_snapshots (name, note, groups, data, counts, auto, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_note, '')), ''), p_groups, v_data, v_counts, p_auto, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.config_snapshot_create(p_name text, p_groups text[] default array['settings', 'pages', 'products', 'stock'], p_note text default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(array_length(p_groups, 1), 0) = 0 or not (p_groups <@ array['settings', 'pages', 'products', 'stock']) then
    raise exception 'groups' using errcode = '22023';
  end if;
  return app.snapshot_take(p_name, p_groups, false, p_note);
end $$;

create or replace function public.config_snapshots() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'note', s.note, 'groups', s.groups, 'counts', s.counts,
            'auto', s.auto, 'created_at', s.created_at, 'by', coalesce(p.full_name, u.email)) order by s.id desc), '[]')
          from config_snapshots s left join auth.users u on u.id = s.created_by left join profiles p on p.id = s.created_by);
end $$;

-- p_confirm must be the snapshot's name; only the chosen groups that the snapshot holds are restored
create or replace function public.config_snapshot_restore(p_id bigint, p_groups text[], p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s config_snapshots; r record; v_groups text[]; v_safety bigint; v_cols text; v_pk text; v_set text; v_rows jsonb;
  v_del int; v_ins int; v_report jsonb := '{}';
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from config_snapshots where id = p_id;
  if not found then return jsonb_build_object('error', 'missing'); end if;
  if btrim(coalesce(p_confirm, '')) <> s.name then return jsonb_build_object('error', 'confirm'); end if;
  select array_agg(g) into v_groups from unnest(p_groups) g where g = any (s.groups);
  if v_groups is null then return jsonb_build_object('error', 'groups'); end if;

  -- the state being replaced is kept, so this restore can be undone
  v_safety := app.snapshot_take('پیش از بازگردانی «' || s.name || '» — ' || to_char(now() at time zone 'Asia/Tehran', 'YYYY-MM-DD HH24:MI'),
                                v_groups, true);

  -- triggers (moderation, notifications, audit) would treat the restore as user edits
  for r in select * from app.snapshot_tables() where grp = any (v_groups) and to_regclass('public.' || tbl) is not null loop
    execute format('alter table public.%I disable trigger user', r.tbl);
  end loop;

  -- delete what the snapshot does not have, children first
  for r in select * from app.snapshot_tables() where grp = any (v_groups) and to_regclass('public.' || tbl) is not null order by ord desc loop
    select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey, a.attnum)) into v_pk
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = ('public.' || r.tbl)::regclass and i.indisprimary;
    v_rows := coalesce(s.data->r.tbl, '[]');
    execute format('delete from public.%I t where (%s) not in (select %s from jsonb_populate_recordset(null::public.%I, $1))',
                   r.tbl, (select string_agg('t.' || x, ', ') from unnest(string_to_array(v_pk, ', ')) x), v_pk, r.tbl) using v_rows;
    get diagnostics v_del = row_count;
    v_report := v_report || jsonb_build_object(r.tbl, jsonb_build_object('deleted', v_del));
  end loop;

  -- then put every saved row back as it was, parents first
  for r in select * from app.snapshot_tables() where grp = any (v_groups) and to_regclass('public.' || tbl) is not null order by ord loop
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('%I = excluded.%I', a.attname, a.attname), ', ' order by a.attnum) filter (where not exists (
             select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any (i.indkey)))
      into v_cols, v_set
      from pg_attribute a
     where a.attrelid = ('public.' || r.tbl)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey, a.attnum)) into v_pk
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = ('public.' || r.tbl)::regclass and i.indisprimary;
    v_rows := coalesce(s.data->r.tbl, '[]');
    continue when jsonb_array_length(v_rows) = 0;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) on conflict (%s) do %s',
                   r.tbl, v_cols, v_cols, r.tbl, v_pk, case when v_set is null then 'nothing' else 'update set ' || v_set end) using v_rows;
    get diagnostics v_ins = row_count;
    v_report := jsonb_set(v_report, array[r.tbl], coalesce(v_report->r.tbl, '{}') || jsonb_build_object('restored', v_ins));
  end loop;

  for r in select * from app.snapshot_tables() where grp = any (v_groups) and to_regclass('public.' || tbl) is not null loop
    execute format('alter table public.%I enable trigger user', r.tbl);
  end loop;
  return jsonb_build_object('ok', true, 'safety', v_safety, 'tables', v_report);
end $$;

create or replace function public.config_snapshot_delete(p_id bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from config_snapshots where id = p_id;
  return case when found then 'ok' else 'missing' end;
end $$;

grant execute on function public.config_snapshot_create(text, text[], text) to authenticated;
grant execute on function public.config_snapshots() to authenticated;
grant execute on function public.config_snapshot_restore(bigint, text[], text) to authenticated;
grant execute on function public.config_snapshot_delete(bigint) to authenticated;
