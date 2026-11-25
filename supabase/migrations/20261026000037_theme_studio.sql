-- Theme studio: saved storefront looks ("themes") with a draft and a published
-- version each, ready-made presets, scheduling (e.g. a Nowruz look for two weeks),
-- and a limited look per pharmacy (accent color, logo, cover) after Dorva review.
--
-- The allowed keys and values live in app.theme_spec() (same list as the app's
-- src/lib/themeSpec.json); nothing outside it can be stored.

set search_path = public, extensions;

-- ---------------------------------------------------------------- permission
insert into public.permissions (code, scope, description_fa) values
  ('theme.manage', 'platform', 'استودیوی ظاهر: قالب‌ها، زمان‌بندی و بررسی ظاهر داروخانه‌ها')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'theme.manage' from public.roles r
where r.is_system and r.pharmacy_id is null and r.scope = 'platform' and r.code in ('super_admin', 'content_moderator')
on conflict do nothing;

-- ---------------------------------------------------------------- spec + validation
create or replace function app.theme_spec() returns jsonb
language sql immutable set search_path = pg_catalog as $$ select '{"colors.primary":{"t":"color"},"colors.highlight":{"t":"color"},"colors.accent":{"t":"color"},"colors.background":{"t":"color"},"colors.surface":{"t":"color"},"colors.text":{"t":"color"},"colors.muted":{"t":"color"},"colors.border":{"t":"color"},"colors.sale":{"t":"color"},"mode":{"t":"enum","v":["light","dark"]},"font.body":{"t":"enum","v":["vazirmatn","plex","kufi","readex","naskh"]},"font.heading":{"t":"enum","v":["same","vazirmatn","plex","kufi","readex","lalezar"]},"font.size":{"t":"num","min":13,"max":18},"font.headingWeight":{"t":"enum","v":["600","700","800","900"]},"shape.radius":{"t":"num","min":0,"max":28},"shape.button":{"t":"enum","v":["solid","soft","outline","pill","gradient"]},"shape.shadow":{"t":"enum","v":["none","soft","medium","strong"]},"shape.borders":{"t":"bool"},"layout.width":{"t":"num","min":1024,"max":1600},"layout.density":{"t":"enum","v":["compact","normal","spacious"]},"layout.background":{"t":"enum","v":["plain","soft","dots","gradient"]},"logo.mode":{"t":"enum","v":["image","text","both"]},"logo.height":{"t":"num","min":24,"max":64},"logo.image":{"t":"image"},"logo.text":{"t":"i18n","max":30},"header.style":{"t":"enum","v":["classic","compact","centered","stacked"]},"header.sticky":{"t":"bool"},"header.deliverTo":{"t":"bool"},"header.language":{"t":"bool"},"header.categories":{"t":"bool"},"header.finder":{"t":"bool"},"header.announce.on":{"t":"bool"},"header.announce.text":{"t":"i18n","max":160},"header.announce.link":{"t":"path"},"header.announce.tone":{"t":"enum","v":["brand","accent","dark","amber","rose"]},"footer.style":{"t":"enum","v":["full","simple","minimal"]},"footer.features":{"t":"bool"},"footer.about":{"t":"i18n","max":600},"footer.phone":{"t":"text","max":30},"footer.email":{"t":"text","max":80},"footer.address":{"t":"i18n","max":200},"footer.hours":{"t":"i18n","max":80},"footer.social.instagram":{"t":"url"},"footer.social.telegram":{"t":"url"},"footer.social.whatsapp":{"t":"url"},"footer.social.linkedin":{"t":"url"},"footer.social.aparat":{"t":"url"},"footer.social.eitaa":{"t":"url"},"card.style":{"t":"enum","v":["classic","minimal","bordered","compact","elevated"]},"card.image":{"t":"enum","v":["square","portrait","landscape"]},"card.titleLines":{"t":"num","min":1,"max":3},"card.category":{"t":"bool"},"card.pharmacies":{"t":"bool"},"card.discount":{"t":"bool"},"card.quickAdd":{"t":"enum","v":["full","icon","none"]},"card.price":{"t":"enum","v":["ink","brand","accent"]},"card.align":{"t":"enum","v":["start","center"]},"grid.mobile":{"t":"num","min":1,"max":2},"grid.desktop":{"t":"num","min":2,"max":5},"grid.view":{"t":"enum","v":["grid","list"]},"grid.toggle":{"t":"bool"},"grid.filters":{"t":"enum","v":["side","top"]},"rows.size":{"t":"enum","v":["s","m","l"]},"rows.arrows":{"t":"bool"},"product.layout":{"t":"enum","v":["side","stacked","compact"]},"product.offers":{"t":"enum","v":["list","cards","table"]},"product.specs":{"t":"enum","v":["after","before"]},"product.stickyBuy":{"t":"bool"},"pharmacy.hero":{"t":"enum","v":["card","cover","minimal"]},"pharmacy.list":{"t":"enum","v":["grid","list"]},"cart.summary":{"t":"enum","v":["side","bottom"]}}'::jsonb $$;

create or replace function app.theme_value_ok(p_rule jsonb, v jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare t text := p_rule->>'t'; k text;
begin
  case t
    when 'color' then return jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^#[0-9a-fA-F]{6}$';
    when 'bool' then return jsonb_typeof(v) = 'boolean';
    when 'enum' then return jsonb_typeof(v) = 'string' and (p_rule->'v') ? (v #>> '{}');
    when 'num' then return jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between (p_rule->>'min')::numeric and (p_rule->>'max')::numeric;
    when 'text' then return jsonb_typeof(v) = 'string' and length(v #>> '{}') <= (p_rule->>'max')::int;
    when 'i18n' then
      if jsonb_typeof(v) <> 'object' then return false; end if;
      for k in select jsonb_object_keys(v) loop
        if k not in ('fa', 'en', 'ar') or jsonb_typeof(v->k) <> 'string' or length(v->>k) > (p_rule->>'max')::int then return false; end if;
      end loop;
      return true;
    when 'path' then return jsonb_typeof(v) = 'string' and ((v #>> '{}') = ''
      or ((v #>> '{}') ~ '^/[a-z0-9/_?=&%.-]{0,150}$' and (v #>> '{}') !~ '^//'));
    when 'url' then return jsonb_typeof(v) = 'string' and ((v #>> '{}') = '' or (v #>> '{}') ~ '^https://[^\s"''<>]{3,200}$');
    when 'image' then return jsonb_typeof(v) = 'string'
      and ((v #>> '{}') = '' or (v #>> '{}') ~ '^(theme|[0-9a-f-]{36})/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$');
    else return false;
  end case;
end $$;

-- 'ok', or the first problem as 'key:<path>' (unknown) / 'value:<path>' (not allowed) / 'size'
create or replace function app.theme_validate(p_cfg jsonb, p_prefix text default '') returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare k text; v jsonb; path text; rule jsonb; sub text; spec jsonb := app.theme_spec();
begin
  if p_prefix = '' then
    if p_cfg is null or jsonb_typeof(p_cfg) <> 'object' then return 'value:'; end if;
    if length(p_cfg::text) > 20000 then return 'size'; end if;
  end if;
  for k, v in select * from jsonb_each(p_cfg) loop
    path := case when p_prefix = '' then k else p_prefix || '.' || k end;
    rule := spec->path;
    if rule is not null then
      if not app.theme_value_ok(rule, v) then return 'value:' || path; end if;
    elsif jsonb_typeof(v) = 'object' and exists (select 1 from jsonb_object_keys(spec) s where s like path || '.%') then
      sub := app.theme_validate(v, path);
      if sub <> 'ok' then return sub; end if;
    else
      return 'key:' || path;
    end if;
  end loop;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- tables
create table if not exists public.themes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 60),
  config        jsonb not null default '{}'::jsonb check (app.theme_validate(config) = 'ok'),
  draft         jsonb check (draft is null or app.theme_validate(draft) = 'ok'),
  is_default    boolean not null default false,
  preset        text,
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create unique index if not exists themes_one_default on public.themes ((true)) where is_default;
alter table public.themes enable row level security;   -- through the functions below only

create table if not exists public.theme_schedules (
  id         uuid primary key default gen_random_uuid(),
  theme_id   uuid not null references public.themes(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  note       text check (note is null or length(note) <= 120),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists theme_schedules_time on public.theme_schedules (starts_at, ends_at);
alter table public.theme_schedules enable row level security;

create table if not exists public.pharmacy_looks (
  pharmacy_id   uuid primary key references public.pharmacies(id) on delete cascade,
  draft         jsonb not null default '{}'::jsonb,
  published     jsonb,
  status        text not null default 'draft' check (status in ('draft', 'pending', 'published', 'rejected')),
  review_note   text check (review_note is null or length(review_note) <= 500),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  published_at  timestamptz,
  reviewed_by   uuid references auth.users(id)
);
alter table public.pharmacy_looks enable row level security;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('theme.pharmacy_enabled', 'theme', 'boolean', null, null, null, null,
   '{"fa":"ظاهر اختصاصی داروخانه‌ها","en":"Pharmacy looks","ar":"مظهر الصيدليات"}',
   '{"fa":"روشن: هر داروخانه می‌تواند رنگ تأکید، لوگو و تصویر کاور صفحه خودش را تعیین کند.","en":"On: each pharmacy may set its own accent color, logo and cover image.","ar":"تشغيل: لكل صيدلية لون تمييز وشعار وصورة غلاف."}', 60),
  ('theme.pharmacy_approval', 'theme', 'boolean', null, null, null, null,
   '{"fa":"ظاهر داروخانه با تأیید دوروا","en":"Pharmacy looks need Dorva approval","ar":"مظهر الصيدلية بموافقة دوروا"}', null, 61)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('theme.pharmacy_enabled', 'platform', 'true', 'ظاهر اختصاصی داروخانه‌ها'),
  ('theme.pharmacy_approval', 'platform', 'true', 'ظاهر داروخانه با تأیید دوروا')
on conflict do nothing;

-- ---------------------------------------------------------------- presets
-- the default look keeps the colors chosen so far in Settings (now moved here)
do $$
declare
  v jsonb := '{}'::jsonb; s jsonb;
begin
  if exists (select 1 from themes) then return; end if;
  select jsonb_object_agg(key, value) into s from settings
   where scope = 'platform' and key in ('theme.primary', 'theme.highlight', 'theme.accent', 'theme.logo', 'theme.page_width');
  s := coalesce(s, '{}'::jsonb);
  if s ? 'theme.primary' then v := jsonb_set(v, '{colors}', coalesce(v->'colors', '{}') || jsonb_build_object('primary', s->'theme.primary')); end if;
  if s ? 'theme.highlight' then v := jsonb_set(v, '{colors}', coalesce(v->'colors', '{}') || jsonb_build_object('highlight', s->'theme.highlight')); end if;
  if s ? 'theme.accent' then v := jsonb_set(v, '{colors}', coalesce(v->'colors', '{}') || jsonb_build_object('accent', s->'theme.accent')); end if;
  if s ? 'theme.logo' then v := v || jsonb_build_object('logo', jsonb_build_object('mode', s->'theme.logo')); end if;
  if s ? 'theme.page_width' then v := v || jsonb_build_object('layout', jsonb_build_object('width', s->'theme.page_width')); end if;
  if app.theme_validate(v) <> 'ok' then v := '{}'::jsonb; end if;

  insert into themes (name, config, is_default, preset, published_at) values
    ('دروا کلاسیک', v, true, 'classic', now()),
    ('مینیمال سفید', '{"colors":{"primary":"#111827","highlight":"#6b7280","accent":"#111827","background":"#ffffff","border":"#e5e7eb"},"shape":{"radius":8,"button":"outline","shadow":"none"},"card":{"style":"minimal","align":"center","quickAdd":"icon"},"header":{"style":"centered"},"footer":{"style":"simple"},"layout":{"background":"plain"}}', false, 'minimal', now()),
    ('بنفش مدرن', '{"colors":{"primary":"#5b2ee0","highlight":"#22d3ee","accent":"#db2777","background":"#f7f5ff"},"shape":{"radius":22,"button":"gradient","shadow":"medium","borders":false},"card":{"style":"elevated","price":"accent"},"header":{"style":"stacked"},"font":{"heading":"kufi"},"layout":{"background":"gradient"}}', false, 'modern', now()),
    ('نوروز', '{"colors":{"primary":"#15803d","highlight":"#f59e0b","accent":"#be123c","background":"#f6fbf4"},"shape":{"radius":18,"button":"pill","shadow":"soft"},"card":{"style":"bordered"},"font":{"heading":"lalezar","headingWeight":"700"},"header":{"announce":{"on":true,"tone":"amber","text":{"fa":"نوروزتان پیروز! ارسال سریع از داروخانه نزدیک شما","en":"Happy Nowruz! Fast delivery from a pharmacy near you","ar":"نوروز سعيد! توصيل سريع من صيدلية قريبة منك"},"link":"/products"}},"layout":{"background":"dots"}}', false, 'nowruz', now()),
    ('شب (تیره)', '{"mode":"dark","colors":{"primary":"#38bdf8","highlight":"#22d3ee","accent":"#a78bfa"},"shape":{"radius":14,"shadow":"none"},"card":{"style":"bordered"}}', false, 'dark', now()),
    ('فشرده و سریع', '{"layout":{"density":"compact","width":1440},"font":{"size":14},"shape":{"radius":10},"card":{"style":"compact","titleLines":1,"category":false},"grid":{"desktop":5,"filters":"top"},"rows":{"size":"s"},"header":{"style":"compact"},"product":{"layout":"compact","offers":"table"}}', false, 'compact', now());
end $$;

-- the colors moved into the theme; their old settings go away
delete from public.settings where scope = 'platform' and key in ('theme.primary', 'theme.highlight', 'theme.accent', 'theme.logo', 'theme.page_width');
delete from public.setting_definitions where key in ('theme.primary', 'theme.highlight', 'theme.accent', 'theme.logo', 'theme.page_width');

-- ---------------------------------------------------------------- reading
-- the look visitors get now: a scheduled theme whose window is open (latest start wins), else the default
create or replace function app.theme_now() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select s.theme_id from theme_schedules s where now() >= s.starts_at and now() < s.ends_at order by s.starts_at desc, s.created_at desc limit 1),
    (select id from themes where is_default));
$$;

create or replace function public.theme_active() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select config from themes where id = app.theme_now()), '{}'::jsonb);
$$;

-- an editor previews the unpublished draft of any theme
create or replace function public.theme_preview(p_theme uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.has_platform_permission('theme.manage')
              then (select jsonb_build_object('name', name, 'config', coalesce(draft, config)) from themes where id = p_theme) end;
$$;

create or replace function public.theme_list() returns table(
  id uuid, name text, is_default boolean, preset text, has_draft boolean, is_live boolean,
  updated_at timestamptz, published_at timestamptz, schedules int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select t.id, t.name, t.is_default, t.preset, t.draft is not null, t.id = app.theme_now(), t.updated_at, t.published_at,
           (select count(*)::int from theme_schedules s where s.theme_id = t.id and s.ends_at > now())
    from themes t order by t.is_default desc, t.name;
end $$;

create or replace function public.theme_get(p_theme uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r themes;
begin
  if not app.has_platform_permission('theme.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from themes where id = p_theme;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'name', r.name, 'config', r.config, 'draft', r.draft, 'is_default', r.is_default,
    'is_live', r.id = app.theme_now(), 'published_at', r.published_at, 'updated_at', r.updated_at);
end $$;

-- ---------------------------------------------------------------- editing
create or replace function public.theme_save(p_theme uuid, p_name text, p_draft jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare chk text;
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  chk := app.theme_validate(coalesce(p_draft, '{}'::jsonb));
  if chk <> 'ok' then return chk; end if;
  if p_name is not null and length(trim(p_name)) not between 1 and 60 then return 'name'; end if;
  update themes set draft = p_draft, name = coalesce(nullif(trim(p_name), ''), name), updated_at = now(), updated_by = auth.uid()
  where id = p_theme;
  return case when found then 'ok' else 'not_found' end;
end $$;

create or replace function public.theme_publish(p_theme uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  update themes set config = coalesce(draft, config), draft = null, published_at = now(), updated_at = now(), updated_by = auth.uid()
  where id = p_theme;
  return case when found then 'published' else 'not_found' end;
end $$;

create or replace function public.theme_discard(p_theme uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  update themes set draft = null, updated_at = now() where id = p_theme;
  return 'ok';
end $$;

create or replace function public.theme_create(p_name text, p_from uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if not app.has_platform_permission('theme.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'name' using errcode = '22023'; end if;
  insert into themes (name, config, updated_by, published_at)
  values (trim(p_name), coalesce((select coalesce(draft, config) from themes where id = p_from), '{}'::jsonb), auth.uid(), now())
  returning id into v;
  return v;
end $$;

create or replace function public.theme_set_default(p_theme uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  if not exists (select 1 from themes where id = p_theme) then return 'not_found'; end if;
  update themes set is_default = false where is_default and id <> p_theme;
  update themes set is_default = true where id = p_theme;
  return 'ok';
end $$;

create or replace function public.theme_delete(p_theme uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  if exists (select 1 from themes where id = p_theme and is_default) then return 'default'; end if;
  delete from themes where id = p_theme;
  return 'ok';
end $$;

create or replace function public.theme_schedule_add(p_theme uuid, p_starts timestamptz, p_ends timestamptz, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts then return 'dates'; end if;
  if p_ends <= now() then return 'past'; end if;
  if not exists (select 1 from themes where id = p_theme) then return 'not_found'; end if;
  insert into theme_schedules (theme_id, starts_at, ends_at, note) values (p_theme, p_starts, p_ends, nullif(left(trim(coalesce(p_note, '')), 120), ''));
  return 'ok';
end $$;

create or replace function public.theme_schedule_delete(p_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  delete from theme_schedules where id = p_id;
  return 'ok';
end $$;

create or replace function public.theme_schedule_list() returns table(id uuid, theme_id uuid, theme_name text, starts_at timestamptz, ends_at timestamptz, note text, state text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, s.theme_id, t.name, s.starts_at, s.ends_at, s.note,
           case when now() >= s.ends_at then 'ended' when now() >= s.starts_at then 'running' else 'upcoming' end
    from theme_schedules s join themes t on t.id = s.theme_id
    where s.ends_at > now() - interval '30 days'
    order by s.starts_at;
end $$;

-- ---------------------------------------------------------------- pharmacy looks
-- {accent: color, logo: image, cover: image, coverTone: brand|accent|dark|soft}
create or replace function app.pharmacy_look_ok(p_ph uuid, p jsonb) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare k text; img text := '^' || p_ph::text || '/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$';
begin
  if jsonb_typeof(p) <> 'object' then return 'value'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('accent', 'logo', 'cover', 'coverTone') then return 'key:' || k; end if;
  end loop;
  if p ? 'accent' and (jsonb_typeof(p->'accent') <> 'string' or p->>'accent' !~ '^#[0-9a-fA-F]{6}$') then return 'value:accent'; end if;
  if p ? 'logo' and (jsonb_typeof(p->'logo') <> 'string' or (p->>'logo' <> '' and p->>'logo' !~ img)) then return 'image'; end if;
  if p ? 'cover' and (jsonb_typeof(p->'cover') <> 'string' or (p->>'cover' <> '' and p->>'cover' !~ img)) then return 'image'; end if;
  if p ? 'coverTone' and coalesce(p->>'coverTone', '') not in ('brand', 'accent', 'dark', 'soft') then return 'value:coverTone'; end if;
  return 'ok';
end $$;

create or replace function app.can_edit_look(p_ph uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_platform_permission('theme.manage')
      or (app.setting_bool('theme.pharmacy_enabled', true) and app.has_pharmacy_permission(p_ph, 'pharmacy.pages.manage'));
$$;

create or replace function public.pharmacy_look_editor(p_pharmacy uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r pharmacy_looks;
begin
  if not app.can_edit_look(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from pharmacy_looks where pharmacy_id = p_pharmacy;
  return jsonb_build_object('draft', coalesce(r.draft, '{}'::jsonb), 'published', r.published, 'status', coalesce(r.status, 'draft'),
    'review_note', r.review_note,
    'needs_approval', app.setting_bool('theme.pharmacy_approval', true) and not app.has_platform_permission('theme.manage'));
end $$;

create or replace function public.pharmacy_look_save(p_pharmacy uuid, p_draft jsonb, p_submit boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare chk text; v_direct boolean;
begin
  if not app.can_edit_look(p_pharmacy) then return 'forbidden'; end if;
  chk := app.pharmacy_look_ok(p_pharmacy, coalesce(p_draft, '{}'::jsonb));
  if chk <> 'ok' then return chk; end if;
  v_direct := not app.setting_bool('theme.pharmacy_approval', true) or app.has_platform_permission('theme.manage');
  insert into pharmacy_looks (pharmacy_id, draft, status, updated_by, updated_at)
  values (p_pharmacy, p_draft, 'draft', auth.uid(), now())
  on conflict (pharmacy_id) do update set draft = excluded.draft, updated_by = excluded.updated_by, updated_at = now(),
    status = case when pharmacy_looks.status = 'pending' then 'draft' else pharmacy_looks.status end;
  if not p_submit then return 'ok'; end if;
  if v_direct then
    update pharmacy_looks set published = draft, status = 'published', published_at = now(), review_note = null where pharmacy_id = p_pharmacy;
    return 'published';
  end if;
  update pharmacy_looks set status = 'pending', submitted_at = now() where pharmacy_id = p_pharmacy;
  return 'pending';
end $$;

create or replace function public.pharmacy_look_review(p_pharmacy uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then return 'forbidden'; end if;
  if p_action = 'approve' then
    update pharmacy_looks set published = draft, status = 'published', published_at = now(), reviewed_by = auth.uid(), review_note = nullif(trim(coalesce(p_note, '')), '')
    where pharmacy_id = p_pharmacy and status = 'pending';
  elsif p_action = 'reject' then
    if length(trim(coalesce(p_note, ''))) = 0 then return 'note'; end if;
    update pharmacy_looks set status = 'rejected', reviewed_by = auth.uid(), review_note = left(trim(p_note), 500)
    where pharmacy_id = p_pharmacy and status = 'pending';
  elsif p_action = 'unpublish' then
    update pharmacy_looks set published = null, status = 'draft', reviewed_by = auth.uid() where pharmacy_id = p_pharmacy;
  else
    return 'unknown';
  end if;
  return case when found then 'done' else 'not_pending' end;
end $$;

create or replace function public.pharmacy_look_queue() returns table(
  pharmacy_id uuid, slug text, name_fa text, status text, draft jsonb, published jsonb, submitted_at timestamptz, review_note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('theme.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select l.pharmacy_id, p.slug::text, p.name_fa, l.status, l.draft, l.published, l.submitted_at, l.review_note
    from pharmacy_looks l join pharmacies p on p.id = l.pharmacy_id
    order by (l.status = 'pending') desc, l.submitted_at desc nulls last, l.updated_at desc;
end $$;

create or replace function public.pharmacy_look_public(p_pharmacy uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.setting_bool('theme.pharmacy_enabled', true)
              then (select published from pharmacy_looks where pharmacy_id = p_pharmacy) end;
$$;

-- ---------------------------------------------------------------- uploads
-- theme pictures (logo) go to page-media/theme/…, editable by theme managers
create or replace function app.page_media_folder_ok(p_folder text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_folder = 'home' then app.can_edit_page(null)
              when p_folder = 'theme' then app.has_platform_permission('theme.manage')
              when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then app.can_edit_page(p_folder::uuid) or app.can_edit_look(p_folder::uuid)
              else false end;
$$;

-- ---------------------------------------------------------------- grants
grant execute on function public.theme_active() to anon, authenticated;
grant execute on function public.pharmacy_look_public(uuid) to anon, authenticated;
grant execute on function public.theme_preview(uuid) to authenticated;
grant execute on function public.theme_list() to authenticated;
grant execute on function public.theme_get(uuid) to authenticated;
grant execute on function public.theme_save(uuid, text, jsonb) to authenticated;
grant execute on function public.theme_publish(uuid) to authenticated;
grant execute on function public.theme_discard(uuid) to authenticated;
grant execute on function public.theme_create(text, uuid) to authenticated;
grant execute on function public.theme_set_default(uuid) to authenticated;
grant execute on function public.theme_delete(uuid) to authenticated;
grant execute on function public.theme_schedule_add(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.theme_schedule_delete(uuid) to authenticated;
grant execute on function public.theme_schedule_list() to authenticated;
grant execute on function public.pharmacy_look_editor(uuid) to authenticated;
grant execute on function public.pharmacy_look_save(uuid, jsonb, boolean) to authenticated;
grant execute on function public.pharmacy_look_review(uuid, text, text) to authenticated;
grant execute on function public.pharmacy_look_queue() to authenticated;
