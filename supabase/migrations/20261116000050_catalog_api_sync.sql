-- Catalog layer sync from the pharma-catalog API (catalog = source of truth, read-only here).
--  * The API key lives in Supabase Vault (secret "dorva_catalog_api_key"). Dorva admins can set or
--    replace it from the admin panel but never read it back; only the sync function reads it.
--  * The Edge Function catalog-sync does the HTTP work; the database decides what to run:
--      full load   — paged with next_cursor until null; at the end, catalog products that were not
--                    seen are switched off (the API lists published products only, so this is how
--                    withdrawals reach Dorva). Runs first, then every catalog.full_hours.
--      incremental — updated_since = server_time of the last good run minus a small overlap.
--      one         — a single product by id or internal code; 404 switches it off.
--  * Upsert by catalog id. Absent fields stay absent (null / not in detail), so nothing is shown.
--  * Price, stock, expiry and publishing stay in the Dorva and pharmacy layers (untouched here).
--  * Products from the earlier test import are marked source = 'seed' and can be switched off
--    (reversibly) from the admin page.

set search_path = public, extensions;

alter table public.catalog_products
  add column if not exists source text not null default 'seed',
  add column if not exists internal_code text,
  add column if not exists detail jsonb not null default '{}'::jsonb,
  add column if not exists complete boolean,
  add column if not exists missing text[] not null default '{}',
  add column if not exists catalog_changed_at timestamptz,
  add column if not exists last_seen_run bigint;
create index if not exists catalog_products_source_idx on public.catalog_products (source, is_active);
create index if not exists catalog_products_internal_code_idx on public.catalog_products (internal_code);

alter table public.catalog_sync_state
  add column if not exists last_server_time timestamptz,
  add column if not exists last_full_at timestamptz,
  add column if not exists last_ok_at timestamptz,
  add column if not exists last_error text,
  add column if not exists running_since timestamptz,
  add column if not exists run_id bigint,
  add column if not exists full_run bigint,
  add column if not exists full_cursor text,
  add column if not exists full_server_time timestamptz,
  add column if not exists pending_mode text,
  add column if not exists pending_id text;
insert into public.catalog_sync_state (id) values (1) on conflict do nothing;

create table if not exists public.catalog_sync_runs (
  id           bigserial primary key,
  mode         text not null check (mode in ('full', 'incremental', 'one')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  pages        int not null default 0,
  received     int not null default 0,
  created      int not null default 0,
  updated      int not null default 0,
  unchanged    int not null default 0,
  skipped      int not null default 0,
  deactivated  int not null default 0,
  error        text,
  requested_by uuid
);
alter table public.catalog_sync_runs enable row level security;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('catalog.sync_enabled', 'catalog_sync', 'boolean', null, null, null, null,
   '{"fa":"همگام‌سازی خودکار کاتالوگ","en":"Automatic catalog sync","ar":"المزامنة التلقائية للكتالوج"}',
   '{"fa":"روشن = تغییرات کاتالوگ هر چند دقیقه یک‌بار به دوروا می‌آید. کلید اتصال در صفحه «همگام‌سازی کاتالوگ» گذاشته می‌شود.","en":"Pulls catalog changes every few minutes. The API key is set on the catalog sync page.","ar":"يجلب تغييرات الكتالوج كل بضع دقائق."}', 950),
  ('catalog.sync_minutes', 'catalog_sync', 'number', null, 1, 1440, '{"fa":"دقیقه","en":"minutes","ar":"دقيقة"}',
   '{"fa":"فاصله همگام‌سازی تغییرات","en":"Incremental sync interval","ar":"فاصل المزامنة"}', null, 951),
  ('catalog.full_hours', 'catalog_sync', 'number', null, 1, 720, '{"fa":"ساعت","en":"hours","ar":"ساعة"}',
   '{"fa":"فاصله بارگیری کامل","en":"Full reload interval","ar":"فاصل التحميل الكامل"}',
   '{"fa":"بارگیری کامل کالاهایی را که در کاتالوگ از انتشار خارج شده‌اند در دوروا هم غیرفعال می‌کند.","en":"A full reload switches off products withdrawn in the catalog.","ar":"يعطّل المنتجات المسحوبة."}', 952),
  ('catalog.overlap_minutes', 'catalog_sync', 'number', null, 0, 120, '{"fa":"دقیقه","en":"minutes","ar":"دقيقة"}',
   '{"fa":"هم‌پوشانی زمانی هر دور","en":"Overlap per run","ar":"التداخل الزمني"}',
   '{"fa":"برای اینکه تغییری که لحظه آخر ثبت شده جا نماند، هر دور این چند دقیقه را دوباره می‌خواند (تکراری‌ها بی‌اثرند).","en":"Re-reads this window so late commits are not missed.","ar":"لتفادي فقد التغييرات المتأخرة."}', 953),
  ('catalog.api_base', 'catalog_sync', 'text', null, null, null, null,
   '{"fa":"نشانی API کاتالوگ","en":"Catalog API base URL","ar":"عنوان واجهة الكتالوج"}', null, 954),
  ('catalog.sync_url', 'catalog_sync', 'text', null, null, null, null,
   '{"fa":"نشانی تابع همگام‌سازی","en":"Sync function URL","ar":"عنوان دالة المزامنة"}', null, 955),
  ('catalog.incomplete_badge', 'catalog_sync', 'boolean', null, null, null, null,
   '{"fa":"برچسب «اطلاعات در حال تکمیل» روی صفحه کالا","en":"\"Information being completed\" badge on product pages","ar":"شارة «المعلومات قيد الإكمال»"}',
   '{"fa":"برای کالاهایی که کاتالوگ آن‌ها را ناقص اعلام کرده (مثلاً بی‌عکس یا بی‌متن).","en":"For products the catalog reports as incomplete.","ar":"للمنتجات غير المكتملة."}', 956)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
  ('catalog.sync_enabled', 'platform', 'true', 'همگام‌سازی خودکار کاتالوگ'),
  ('catalog.sync_minutes', 'platform', '5', 'فاصله همگام‌سازی'),
  ('catalog.full_hours', 'platform', '24', 'فاصله بارگیری کامل'),
  ('catalog.overlap_minutes', 'platform', '5', 'هم‌پوشانی'),
  ('catalog.api_base', 'platform', '"https://pharma-catalog.vercel.app/api/v1/catalog"', 'نشانی API کاتالوگ'),
  ('catalog.sync_url', 'platform', '"https://qcxbatdnajftmnmxnwjv.supabase.co/functions/v1/catalog-sync"', 'نشانی تابع همگام‌سازی'),
  ('catalog.incomplete_badge', 'platform', 'true', 'برچسب ناقص')
on conflict do nothing;

-- ---------------------------------------------------------------- API key in Vault
create or replace function app.catalog_key() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'dorva_catalog_api_key' limit 1;
$$;
revoke all on function app.catalog_key() from public;

create or replace function public.catalog_key_set(p_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_key text := btrim(coalesce(p_key, '')); v_id uuid;
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_key !~ '^pk_[A-Za-z0-9_]{10,200}$' then return 'format'; end if;
  select id into v_id from vault.secrets where name = 'dorva_catalog_api_key';
  if v_id is null then
    perform vault.create_secret(v_key, 'dorva_catalog_api_key', 'pharma-catalog API key (x-api-key) for the Dorva catalog sync');
  else
    perform vault.update_secret(v_id, v_key);
  end if;
  update catalog_sync_state set last_error = null where id = 1;
  return 'ok';
end $$;

create or replace function public.catalog_key_clear() returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from vault.secrets where name = 'dorva_catalog_api_key';
  return 'ok';
end $$;

-- ---------------------------------------------------------------- mapping one API product
-- facet terms of a product: the facets object plus the top-level vocabulary terms
create or replace function app.catalog_terms(p jsonb)
returns table (k text, code text, fa text, en text)
language sql immutable set search_path = public, pg_temp as $$
  with t as (
    select f.key k, e
      from jsonb_each(case when jsonb_typeof(p->'facets') = 'object' then p->'facets' else '{}'::jsonb end) f,
           jsonb_array_elements(case when jsonb_typeof(f.value) = 'array' then f.value else '[]'::jsonb end) e
    union all
    select m.k, p->m.src
      from (values ('brand', 'brand'), ('manufacturer', 'manufacturer'), ('license_holder', 'license_holder'),
                   ('country', 'country'), ('dosage_form', 'dosage_form'), ('supplement_subtype', 'subtype')) m(k, src)
     where jsonb_typeof(p->m.src) = 'object'
  )
  select distinct on (k, c) k, c, coalesce(nullif(e->>'fa', ''), nullif(e->>'en', ''), c), nullif(e->>'en', '')
    from (select k, e, coalesce(nullif(e->>'code', ''), nullif(e->>'id', ''), nullif(e->>'term_id', ''), nullif(e->>'fa', '')) c from t
           where jsonb_typeof(e) = 'object') x
   where c is not null and k ~ '^[a-z_]+$'
   order by k, c;
$$;

create or replace function app.catalog_apply(p jsonb, p_run bigint) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid; v_name text; v_class text; v_dc text; v_changed timestamptz; v_old catalog_products;
  v_facets jsonb; v_path text[]; v_sub text; v_generic text; v_img text; v_detail jsonb; v_cats jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return 'skipped'; end if;
  begin v_id := (p->>'id')::uuid; exception when others then return 'skipped'; end;
  v_name := coalesce(nullif(btrim(p#>>'{name,fa}'), ''), nullif(btrim(p#>>'{name,en}'), ''));
  if v_id is null or v_name is null then return 'skipped'; end if;
  begin v_changed := coalesce((p->>'changed_at')::timestamptz, (p->>'updated_at')::timestamptz, now());
  exception when others then v_changed := now(); end;
  v_detail := p - 'changed_at';

  select * into v_old from catalog_products where id = v_id;
  if found and v_old.source = 'api' and v_old.catalog_changed_at is not null
     and (v_old.catalog_changed_at > v_changed or (v_old.catalog_changed_at = v_changed and v_old.detail = v_detail)) then
    update catalog_products set last_seen_run = p_run, is_active = true where id = v_id;
    return 'same';
  end if;

  v_class := lower(coalesce(p->>'class', 'supplement'));
  v_dc := case when v_class in ('general', 'supplement', 'otc', 'rx') then v_class
               when v_class in ('drug', 'medicine') then 'rx'
               when v_class in ('cosmetic', 'hygiene', 'device', 'equipment', 'baby', 'mother_baby') then 'general'
               else 'otc' end;   -- unknown classes stay behind the technical officer

  insert into catalog_facet_values (facet_key, value_code, name_fa, name_i18n)
  select k, code, fa, case when en is null then '{}'::jsonb else jsonb_build_object('en', en) end from app.catalog_terms(p)
  on conflict (facet_key, value_code) do update
    set name_fa = excluded.name_fa, name_i18n = catalog_facet_values.name_i18n || excluded.name_i18n;
  select coalesce(jsonb_object_agg(k, codes), '{}'::jsonb) into v_facets
    from (select k, jsonb_agg(code order by code) codes from app.catalog_terms(p) group by k) x;

  -- category path: the catalog's categories (parent first); otherwise class section + source subcategory
  v_cats := case when jsonb_typeof(p->'categories') = 'array' then p->'categories' else '[]'::jsonb end;
  select array_agg(c->>'fa' order by (c->>'parent_id') is not null and (c->>'parent_id') in (select x->>'id' from jsonb_array_elements(v_cats) x), c->>'fa')
    into v_path from jsonb_array_elements(v_cats) c where nullif(c->>'fa', '') is not null;
  if v_path is null then
    v_sub := coalesce(nullif(p#>>'{facets,import_subcategory,0,fa}', ''), nullif(p#>>'{subtype,fa}', ''));
    v_path := array_remove(array[case v_dc when 'supplement' then 'مکمل' when 'otc' then 'دارو' when 'rx' then 'دارو' end, v_sub], null);
  end if;

  -- "generic" = active ingredients (primary ones when marked), used for "same ingredient" suggestions
  select string_agg(n, ' + ' order by o) into v_generic from (
    select coalesce(nullif(c#>>'{ingredient,en}', ''), c#>>'{ingredient,fa}') n, o
      from jsonb_array_elements(case when jsonb_typeof(p->'components') = 'array' then p->'components' else '[]'::jsonb end) with ordinality as t(c, o)
     where (c->>'primary')::boolean is true
        or not exists (select 1 from jsonb_array_elements(p->'components') z where (z->>'primary')::boolean is true)
     limit 4) g where n is not null;

  select coalesce(
    (select i->>'url' from jsonb_array_elements(case when jsonb_typeof(p->'images') = 'array' then p->'images' else '[]'::jsonb end) i where (i->>'primary')::boolean is true limit 1),
    p#>>'{images,0,url}') into v_img;

  insert into catalog_products as c (
    id, internal_code, gtin, irc, erx_code, name_fa, name_en, name_i18n, generic_name, dispensing_class,
    requires_tech_approval, category_path, facets, canonical_slug, image_url, catalog_status, is_active,
    catalog_version, synced_at, source, detail, complete, missing, catalog_changed_at, last_seen_run)
  values (
    v_id, p->>'internal_code',
    coalesce(p#>>'{codes,gtin,0}', (select x->>'gtin' from jsonb_array_elements(case when jsonb_typeof(p->'presentations') = 'array' then p->'presentations' else '[]'::jsonb end) x where x->>'gtin' is not null order by (x->>'primary')::boolean is true desc limit 1)),
    coalesce(p#>>'{codes,irc,0}', (select x->>'irc' from jsonb_array_elements(case when jsonb_typeof(p->'presentations') = 'array' then p->'presentations' else '[]'::jsonb end) x where x->>'irc' is not null order by (x->>'primary')::boolean is true desc limit 1)),
    p#>>'{codes,erx,0}', v_name, nullif(p#>>'{name,en}', ''),
    case when nullif(p#>>'{name,en}', '') is null then '{}'::jsonb else jsonb_build_object('en', p#>>'{name,en}') end,
    v_generic, v_dc, v_dc in ('supplement', 'otc', 'rx'), coalesce(v_path, '{}'), v_facets, nullif(p->>'slug', ''), v_img,
    'published', true, 1, now(), 'api', v_detail,
    (p#>>'{completeness,complete}')::boolean,
    coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p#>'{completeness,missing}') = 'array' then p#>'{completeness,missing}' else '[]'::jsonb end)), '{}'),
    v_changed, p_run)
  on conflict (id) do update set
    internal_code = excluded.internal_code, gtin = excluded.gtin, irc = excluded.irc, erx_code = excluded.erx_code,
    name_fa = excluded.name_fa, name_en = excluded.name_en, name_i18n = excluded.name_i18n, generic_name = excluded.generic_name,
    dispensing_class = excluded.dispensing_class, requires_tech_approval = excluded.requires_tech_approval,
    category_path = excluded.category_path, facets = excluded.facets, canonical_slug = excluded.canonical_slug,
    image_url = excluded.image_url, catalog_status = 'published', is_active = true,
    catalog_version = c.catalog_version + 1, synced_at = now(), source = 'api', detail = excluded.detail,
    complete = excluded.complete, missing = excluded.missing, catalog_changed_at = excluded.catalog_changed_at,
    last_seen_run = excluded.last_seen_run;
  return case when v_old.id is null then 'new' else 'updated' end;
end $$;
revoke all on function app.catalog_apply(jsonb, bigint) from public;

-- ---------------------------------------------------------------- scheduling
create or replace function app.catalog_sync_kick() returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  perform net.http_post(url := app.setting('catalog.sync_url') #>> '{}', body := '{}'::jsonb,
                        headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 5000);
exception when others then null;
end $$;

-- every minute from pg_cron: start a run only when one is due (or asked for) and none is running
create or replace function public.catalog_sync_tick() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s catalog_sync_state;
begin
  select * into s from catalog_sync_state where id = 1;
  if not found or app.catalog_key() is null then return; end if;
  if s.running_since is not null and s.running_since > now() - interval '15 minutes' then return; end if;
  if s.pending_mode is not null
     or (app.setting_bool('catalog.sync_enabled', true)
         and (s.last_ok_at is null or s.last_ok_at <= now() - make_interval(mins => greatest(app.setting_num('catalog.sync_minutes', 5)::int, 1))
              or s.last_full_at is null or s.last_full_at <= now() - make_interval(hours => greatest(app.setting_num('catalog.full_hours', 24)::int, 1)))) then
    perform app.catalog_sync_kick();
  end if;
end $$;
revoke all on function public.catalog_sync_tick() from public, anon, authenticated;

-- admin: ask for a run now
create or replace function public.catalog_sync_request(p_mode text, p_id text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_mode not in ('incremental', 'full', 'one') then return 'mode'; end if;
  if p_mode = 'one' and nullif(btrim(coalesce(p_id, '')), '') is null then return 'id'; end if;
  if app.catalog_key() is null then return 'no_key'; end if;
  update catalog_sync_state set pending_mode = p_mode, pending_id = nullif(btrim(coalesce(p_id, '')), ''),
         -- a manual full load starts over
         full_run = case when p_mode = 'full' then null else full_run end,
         full_cursor = case when p_mode = 'full' then null else full_cursor end
   where id = 1;
  if exists (select 1 from catalog_sync_state where id = 1 and running_since > now() - interval '15 minutes') then return 'queued'; end if;
  perform app.catalog_sync_kick();
  return 'ok';
end $$;

-- ---------------------------------------------------------------- called by the Edge Function (service role only)
create or replace function public.catalog_sync_begin() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s catalog_sync_state; v_mode text; v_run bigint; v_key text; v_since timestamptz; v_resume boolean := false;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from catalog_sync_state where id = 1 for update;
  if s.running_since is not null and s.running_since > now() - interval '15 minutes' then return '{"busy":true}'; end if;
  v_key := app.catalog_key();
  if v_key is null then return '{"no_key":true}'; end if;
  if s.pending_mode is not null then v_mode := s.pending_mode;
  elsif not app.setting_bool('catalog.sync_enabled', true) then return '{"idle":true}';
  elsif s.full_run is not null or s.last_full_at is null or s.last_server_time is null
        or s.last_full_at <= now() - make_interval(hours => greatest(app.setting_num('catalog.full_hours', 24)::int, 1)) then v_mode := 'full';
  elsif s.last_ok_at is null or s.last_ok_at <= now() - make_interval(mins => greatest(app.setting_num('catalog.sync_minutes', 5)::int, 1)) then v_mode := 'incremental';
  else return '{"idle":true}';
  end if;

  if v_mode = 'full' and s.full_run is not null then
    v_run := s.full_run; v_resume := true;
  else
    insert into catalog_sync_runs (mode) values (v_mode) returning id into v_run;
  end if;
  v_since := s.last_server_time - make_interval(mins => greatest(app.setting_num('catalog.overlap_minutes', 5)::int, 0));
  update catalog_sync_state set running_since = now(), run_id = v_run, pending_mode = null, pending_id = null,
         full_run = case when v_mode = 'full' then v_run else full_run end
   where id = 1;
  return jsonb_build_object('mode', v_mode, 'run', v_run, 'key', v_key,
    'base', rtrim(app.setting('catalog.api_base') #>> '{}', '/'),
    'since', case when v_mode = 'incremental' then v_since end,
    'cursor', case when v_resume then s.full_cursor end,
    'server_time', case when v_resume then s.full_server_time end,
    'id', case when v_mode = 'one' then s.pending_id end);
end $$;

create or replace function public.catalog_sync_ingest(p_run bigint, p_items jsonb, p_cursor text default null, p_server_time timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; r text; n_new int := 0; n_upd int := 0; n_same int := 0; n_skip int := 0;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  for e in select * from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) loop
    begin
      r := app.catalog_apply(e, p_run);
    exception when others then
      raise warning 'catalog item % failed: %', e->>'id', sqlerrm;
      r := 'skipped';
    end;
    case r when 'new' then n_new := n_new + 1; when 'updated' then n_upd := n_upd + 1; when 'same' then n_same := n_same + 1; else n_skip := n_skip + 1; end case;
  end loop;
  update catalog_sync_runs set pages = pages + 1, received = received + n_new + n_upd + n_same + n_skip,
         created = created + n_new, updated = updated + n_upd, unchanged = unchanged + n_same, skipped = skipped + n_skip
   where id = p_run;
  -- a full load remembers where it is, so a later call can continue it
  update catalog_sync_state set full_cursor = p_cursor, full_server_time = coalesce(full_server_time, p_server_time), running_since = now()
   where id = 1 and full_run = p_run;
  return jsonb_build_object('new', n_new, 'updated', n_upd, 'same', n_same, 'skipped', n_skip);
end $$;

create or replace function public.catalog_sync_gone(p_run bigint, p_id text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  update catalog_products set is_active = false, synced_at = now()
   where source = 'api' and is_active and (id::text = p_id or internal_code = p_id);
  get diagnostics n = row_count;
  update catalog_sync_runs set deactivated = deactivated + n where id = p_run;
  return n;
end $$;

-- p_done = false: a full load ran out of time and continues on the next call
create or replace function public.catalog_sync_finish(p_run bigint, p_ok boolean, p_done boolean, p_server_time timestamptz, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mode text; n int := 0;
begin
  if not app.is_service() then raise exception 'forbidden' using errcode = '42501'; end if;
  select mode into v_mode from catalog_sync_runs where id = p_run;
  if not p_ok then
    update catalog_sync_runs set finished_at = now(), ok = false, error = left(p_error, 500) where id = p_run;
    update catalog_sync_state set running_since = null, last_error = left(p_error, 500) where id = 1;
    return jsonb_build_object('ok', false);
  end if;
  if not p_done then
    update catalog_sync_state set running_since = null, pending_mode = coalesce(pending_mode, 'full') where id = 1;
    return jsonb_build_object('ok', true, 'continues', true);
  end if;
  if v_mode = 'full' then
    -- the API lists published products only: what a complete pass did not see was withdrawn
    update catalog_products set is_active = false, synced_at = now()
     where source = 'api' and is_active and last_seen_run is distinct from p_run;
    get diagnostics n = row_count;
    update catalog_sync_state set last_full_at = now(), full_run = null, full_cursor = null, full_server_time = null,
           last_server_time = coalesce(full_server_time, p_server_time, last_server_time) where id = 1;
  elsif v_mode = 'incremental' then
    update catalog_sync_state set last_server_time = coalesce(p_server_time, last_server_time) where id = 1;
  end if;
  update catalog_sync_runs set finished_at = now(), ok = true, deactivated = deactivated + n where id = p_run;
  update catalog_sync_state set running_since = null, last_error = null,
         last_ok_at = case when v_mode = 'one' then last_ok_at else now() end where id = 1;
  return jsonb_build_object('ok', true, 'deactivated', n);
end $$;

-- ---------------------------------------------------------------- admin page
create or replace function public.catalog_sync_admin() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s catalog_sync_state; v_key text;
begin
  if not (app.has_platform_permission('settings.manage') or app.has_platform_permission('catalog.publish')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into s from catalog_sync_state where id = 1;
  v_key := app.catalog_key();
  return jsonb_build_object(
    'can_manage', app.has_platform_permission('settings.manage'),
    'has_key', v_key is not null,
    'key_hint', case when v_key is null then null else left(v_key, 12) || '…' end,
    'enabled', app.setting_bool('catalog.sync_enabled', true),
    'minutes', app.setting_num('catalog.sync_minutes', 5),
    'full_hours', app.setting_num('catalog.full_hours', 24),
    'base', app.setting('catalog.api_base') #>> '{}',
    'state', jsonb_build_object('last_ok_at', s.last_ok_at, 'last_full_at', s.last_full_at, 'last_server_time', s.last_server_time,
             'last_error', s.last_error, 'running', s.running_since is not null and s.running_since > now() - interval '15 minutes',
             'pending', s.pending_mode, 'resuming', s.full_run is not null),
    'counts', (select jsonb_build_object(
               'api_active', count(*) filter (where source = 'api' and is_active),
               'api_off', count(*) filter (where source = 'api' and not is_active),
               'complete', count(*) filter (where source = 'api' and is_active and complete),
               'incomplete', count(*) filter (where source = 'api' and is_active and complete is not true),
               'seed_active', count(*) filter (where source = 'seed' and is_active),
               'seed_total', count(*) filter (where source = 'seed')) from catalog_products),
    'missing', (select coalesce(jsonb_agg(jsonb_build_object('code', m, 'n', n) order by n desc), '[]'::jsonb)
                  from (select m, count(*) n from catalog_products, unnest(missing) m where source = 'api' and is_active group by m) x),
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc), '[]'::jsonb)
               from (select id, mode, started_at, finished_at, ok, pages, received, created, updated, unchanged, skipped, deactivated, error
                       from catalog_sync_runs order by id desc limit 15) r));
end $$;

-- incomplete products for the admin list (filter by a missing code, optional)
create or replace function public.catalog_incomplete(p_code text default null, p_limit int default 100) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.has_platform_permission('settings.manage') or app.has_platform_permission('catalog.publish') then
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name_fa', name_fa, 'internal_code', internal_code, 'missing', missing) order by name_fa), '[]'::jsonb)
       from (select id, name_fa, internal_code, missing from catalog_products
              where source = 'api' and is_active and complete is not true and (p_code is null or p_code = any (missing))
              order by name_fa limit least(greatest(coalesce(p_limit, 100), 1), 500)) x)
  else null end;
$$;

-- the earlier test import: switch on/off together (reversible, nothing is deleted)
create or replace function public.catalog_seed_active(p_active boolean) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  update catalog_products set is_active = p_active where source = 'seed' and is_active is distinct from p_active;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.catalog_sync_begin() from public, anon, authenticated;
revoke all on function public.catalog_sync_ingest(bigint, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.catalog_sync_gone(bigint, text) from public, anon, authenticated;
revoke all on function public.catalog_sync_finish(bigint, boolean, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.catalog_sync_begin() to service_role;
grant execute on function public.catalog_sync_ingest(bigint, jsonb, text, timestamptz) to service_role;
grant execute on function public.catalog_sync_gone(bigint, text) to service_role;
grant execute on function public.catalog_sync_finish(bigint, boolean, boolean, timestamptz, text) to service_role;
revoke all on function public.catalog_key_set(text) from public, anon;
revoke all on function public.catalog_key_clear() from public, anon;
revoke all on function public.catalog_sync_request(text, text) from public, anon;
revoke all on function public.catalog_sync_admin() from public, anon;
revoke all on function public.catalog_incomplete(text, int) from public, anon;
revoke all on function public.catalog_seed_active(boolean) from public, anon;
grant execute on function public.catalog_key_set(text) to authenticated;
grant execute on function public.catalog_key_clear() to authenticated;
grant execute on function public.catalog_sync_request(text, text) to authenticated;
grant execute on function public.catalog_sync_admin() to authenticated;
grant execute on function public.catalog_incomplete(text, int) to authenticated;
grant execute on function public.catalog_seed_active(boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'dorva-catalog-sync') then
      perform cron.schedule('dorva-catalog-sync', '* * * * *', 'select public.catalog_sync_tick()');
    end if;
  end if;
end $$;
