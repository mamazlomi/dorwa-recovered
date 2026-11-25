-- =====================================================================
-- Dorva core schema v0.1
-- Layers: (1) catalog mirror  (2) Dorva policy  (3) pharmacy operations
-- Every pharmacy-scoped table carries pharmacy_id and is isolated by RLS.
-- =====================================================================

-- Supabase keeps extensions in their own schema
create schema if not exists extensions;
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

create schema if not exists app;

-- ---------------------------------------------------------------------
-- Geography
-- ---------------------------------------------------------------------
create table public.provinces (
  id          smallserial primary key,
  code        text not null unique,
  name_fa     text not null,
  name_en     text
);

create table public.cities (
  id          serial primary key,
  province_id smallint not null references public.provinces(id),
  slug        citext not null unique,
  name_fa     text not null,
  name_en     text,
  lat         double precision not null,
  lng         double precision not null
);

create table public.insurers (
  code        text primary key,
  name_fa     text not null
);

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  mobile      text unique,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pharmacies (tenants)
-- ---------------------------------------------------------------------
create table public.pharmacies (
  id                          uuid primary key default gen_random_uuid(),
  slug                        citext not null unique
                              check (slug ~ '^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$')
                              -- pharmacy pages live at dorva.ir/<slug>; keep app routes free
                              check (slug::text not in ('admin','api','auth','login','logout','signup',
                                     'pharmacy','pharmacies','p','search','cart','checkout','account',
                                     'settings','dashboard','help','about','contact','blog','magazine',
                                     'forum','static','assets','_next','dorva','www')),
  name_fa                     text not null check (length(trim(name_fa)) >= 2),
  name_en                     text,
  license_no                  text not null unique,
  status                      text not null default 'pending'
                              check (status in ('pending','active','suspended','rejected')),
  is_virtual                  boolean not null default false,
  city_id                     int not null references public.cities(id),
  address                     text,
  lat                         double precision not null check (lat between 24 and 40.5),
  lng                         double precision not null check (lng between 44 and 63.5),
  phone                       text,
  logo_url                    text,
  about_fa                    text,
  opening_hours               jsonb not null default '{}'::jsonb,
  theme                       jsonb not null default '{}'::jsonb,
  custom_domain               citext unique,
  technical_officer_name      text,
  technical_officer_license   text,
  review_note                 text,
  approved_at                 timestamptz,
  approved_by                 uuid references auth.users(id),
  created_by                  uuid references auth.users(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index pharmacies_city_status_idx on public.pharmacies (city_id, status);

create table public.pharmacy_insurers (
  pharmacy_id   uuid not null references public.pharmacies(id) on delete cascade,
  insurer_code  text not null references public.insurers(code),
  primary key (pharmacy_id, insurer_code)
);

-- ---------------------------------------------------------------------
-- Access control: permissions are fine-grained codes; roles bundle them;
-- a membership binds user + scope (platform when pharmacy_id is null) + role.
-- ---------------------------------------------------------------------
create table public.permissions (
  code            text primary key,
  scope           text not null check (scope in ('platform','pharmacy')),
  description_fa  text not null
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('platform','pharmacy')),
  pharmacy_id uuid references public.pharmacies(id) on delete cascade,
  code        text not null,
  name_fa     text not null,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  check (scope = 'pharmacy' or pharmacy_id is null),
  check (not is_system or pharmacy_id is null)
);
create unique index roles_unique_code on public.roles (scope, coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table public.role_permissions (
  role_id         uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid references public.pharmacies(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete restrict,
  status      text not null default 'active' check (status in ('active','disabled')),
  created_at  timestamptz not null default now()
);
create unique index memberships_unique on public.memberships
  (user_id, coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid), role_id);
create index memberships_pharmacy_idx on public.memberships (pharmacy_id);

-- role scope must match membership scope; a pharmacy role must be a system
-- template or belong to that same pharmacy; permissions must match role scope
create or replace function app.check_membership() returns trigger
language plpgsql as $$
declare r public.roles;
begin
  select * into r from public.roles where id = new.role_id;
  if (new.pharmacy_id is null) <> (r.scope = 'platform') then
    raise exception 'membership scope does not match role scope';
  end if;
  if r.pharmacy_id is not null and r.pharmacy_id <> new.pharmacy_id then
    raise exception 'role belongs to another pharmacy';
  end if;
  return new;
end $$;
create trigger memberships_check before insert or update on public.memberships
  for each row execute function app.check_membership();

create or replace function app.check_role_permission() returns trigger
language plpgsql as $$
begin
  if (select scope from public.roles where id = new.role_id)
     <> (select scope from public.permissions where code = new.permission_code) then
    raise exception 'permission scope does not match role scope';
  end if;
  return new;
end $$;
create trigger role_permissions_check before insert or update on public.role_permissions
  for each row execute function app.check_role_permission();

-- Permission helpers (security definer: they read membership tables
-- regardless of the caller's RLS view, but only answer for auth.uid()).
create or replace function app.has_platform_permission(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.user_id = auth.uid() and m.pharmacy_id is null
      and m.status = 'active' and rp.permission_code = p_code);
$$;

create or replace function app.has_pharmacy_permission(p_pharmacy uuid, p_code text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
    where m.user_id = auth.uid() and m.pharmacy_id = p_pharmacy
      and m.status = 'active' and rp.permission_code = p_code);
$$;

create or replace function app.is_pharmacy_member(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.pharmacy_id = p_pharmacy and m.status = 'active');
$$;

-- ---------------------------------------------------------------------
-- Layer 1: catalog mirror (written only by the sync job / service role)
-- ---------------------------------------------------------------------
create table public.catalog_products (
  id                      uuid primary key,          -- id in the catalog system
  gtin                    text,
  irc                     text,
  erx_code                text,
  name_fa                 text not null,
  name_en                 text,
  generic_name            text,
  dispensing_class        text not null
                          check (dispensing_class in ('general','supplement','otc','rx')),
  requires_tech_approval  boolean not null,
  category_path           text[] not null default '{}',
  facets                  jsonb not null default '{}'::jsonb,
  canonical_slug          text,
  image_url               text,
  catalog_status          text not null default 'published',
  is_active               boolean not null default true,
  catalog_version         bigint not null default 1,
  synced_at               timestamptz not null default now(),
  -- prescription drugs always need dispensing by the technical officer
  check (dispensing_class <> 'rx' or requires_tech_approval)
);
create index catalog_products_gtin_idx on public.catalog_products (gtin);
create index catalog_products_irc_idx on public.catalog_products (irc);
create index catalog_products_name_trgm on public.catalog_products using gin (name_fa extensions.gin_trgm_ops);

create table public.catalog_sync_state (
  id              smallint primary key default 1 check (id = 1),
  last_cursor     text,
  last_synced_at  timestamptz
);

-- Upsert used by the sync job; ignores events older than what we have.
create or replace function app.upsert_catalog_product(p jsonb) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into public.catalog_products as c (
    id, gtin, irc, erx_code, name_fa, name_en, generic_name, dispensing_class,
    requires_tech_approval, category_path, facets, canonical_slug, image_url,
    catalog_status, is_active, catalog_version, synced_at)
  values (
    (p->>'id')::uuid, p->>'gtin', p->>'irc', p->>'erx_code', p->>'name_fa', p->>'name_en',
    p->>'generic_name', p->>'dispensing_class',
    coalesce((p->>'requires_tech_approval')::boolean, p->>'dispensing_class' in ('supplement','otc','rx')),
    coalesce(array(select jsonb_array_elements_text(p->'category_path')), '{}'),
    coalesce(p->'facets', '{}'::jsonb), p->>'canonical_slug', p->>'image_url',
    coalesce(p->>'catalog_status', 'published'), coalesce((p->>'is_active')::boolean, true),
    coalesce((p->>'version')::bigint, 1), now())
  on conflict (id) do update set
    gtin = excluded.gtin, irc = excluded.irc, erx_code = excluded.erx_code,
    name_fa = excluded.name_fa, name_en = excluded.name_en, generic_name = excluded.generic_name,
    dispensing_class = excluded.dispensing_class,
    requires_tech_approval = excluded.requires_tech_approval,
    category_path = excluded.category_path, facets = excluded.facets,
    canonical_slug = excluded.canonical_slug, image_url = excluded.image_url,
    catalog_status = excluded.catalog_status, is_active = excluded.is_active,
    catalog_version = excluded.catalog_version, synced_at = now()
  where c.catalog_version < excluded.catalog_version;
end $$;
revoke all on function app.upsert_catalog_product(jsonb) from public;

-- ---------------------------------------------------------------------
-- Layer 2: Dorva policy
-- ---------------------------------------------------------------------
-- price_policy: fixed = Dorva price is the price; cap = pharmacy may go up
-- to it; floor = pharmacy may not go below it; free = pharmacy sets price.
create table public.product_listings (
  product_id    uuid primary key references public.catalog_products(id) on delete cascade,
  is_published  boolean not null default false,
  base_price    numeric(14,0) check (base_price > 0),        -- Rial
  price_policy  text not null default 'fixed'
                check (price_policy in ('fixed','cap','floor','free')),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  check (price_policy = 'free' or base_price is not null)
);

create table public.category_policies (
  dispensing_class  text primary key
                    check (dispensing_class in ('general','supplement','otc','rx')),
  commission_pct    numeric(5,2) not null check (commission_pct between 0 and 100),
  max_discount_pct  numeric(5,2) not null check (max_discount_pct between 0 and 100),
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Layer 3: pharmacy operations
-- ---------------------------------------------------------------------
create table public.stock_items (
  id            uuid primary key default gen_random_uuid(),
  pharmacy_id   uuid not null references public.pharmacies(id) on delete cascade,
  product_id    uuid not null references public.catalog_products(id),
  quantity      int not null default 0 check (quantity >= 0),
  price         numeric(14,0) check (price > 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  source        text not null default 'manual' check (source in ('manual','excel','sync')),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  unique (pharmacy_id, product_id)
);
create index stock_items_product_idx on public.stock_items (product_id) where quantity > 0;

create table public.stock_batches (
  id            uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  batch_no      text,
  expiry_date   date,
  uid           text,
  quantity      int not null default 0 check (quantity >= 0)
);

-- Effective customer price, the single place where layer 2 meets layer 3.
create or replace function app.effective_price(
  p_policy text, p_base numeric, p_pharmacy_price numeric, p_discount numeric)
returns numeric language sql immutable as $$
  select round(
    case p_policy
      when 'fixed' then p_base
      when 'cap'   then least(coalesce(p_pharmacy_price, p_base), p_base)
      when 'floor' then greatest(coalesce(p_pharmacy_price, p_base), p_base)
      else coalesce(p_pharmacy_price, p_base)
    end * (1 - coalesce(p_discount, 0) / 100.0), 0);
$$;

-- Enforce Dorva's price and discount policy on every stock write.
create or replace function app.check_stock_policy() returns trigger
language plpgsql as $$
declare
  l public.product_listings;
  max_disc numeric;
begin
  select * into l from public.product_listings where product_id = new.product_id;
  select cp.max_discount_pct into max_disc
    from public.category_policies cp
    join public.catalog_products p on p.dispensing_class = cp.dispensing_class
   where p.id = new.product_id;

  if max_disc is not null and new.discount_pct > max_disc then
    raise exception 'discount % exceeds max allowed % for this category', new.discount_pct, max_disc
      using errcode = 'check_violation';
  end if;
  if l.price_policy = 'cap' and new.price > l.base_price then
    raise exception 'price above Dorva cap' using errcode = 'check_violation';
  end if;
  if l.price_policy = 'floor' and new.price < l.base_price then
    raise exception 'price below Dorva floor' using errcode = 'check_violation';
  end if;
  if l.price_policy = 'free' and new.price is null and l.base_price is null then
    raise exception 'price required for this product' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
create trigger stock_items_policy before insert or update on public.stock_items
  for each row execute function app.check_stock_policy();

-- ---------------------------------------------------------------------
-- No-code settings: resolved pharmacy > province > platform
-- ---------------------------------------------------------------------
create table public.settings (
  key             text not null,
  scope           text not null check (scope in ('platform','province','pharmacy')),
  scope_id        text not null default '',
  value           jsonb not null,
  description_fa  text,
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  primary key (key, scope, scope_id),
  check ((scope = 'platform') = (scope_id = ''))
);

create table public.settings_audit (
  id          bigserial primary key,
  key         text not null,
  scope       text not null,
  scope_id    text not null,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create or replace function app.audit_settings() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  insert into public.settings_audit (key, scope, scope_id, old_value, new_value, changed_by)
  values (coalesce(new.key, old.key), coalesce(new.scope, old.scope), coalesce(new.scope_id, old.scope_id),
          case when tg_op = 'INSERT' then null else old.value end,
          case when tg_op = 'DELETE' then null else new.value end,
          auth.uid());
  return coalesce(new, old);
end $$;
create trigger settings_audit_trg after insert or update or delete on public.settings
  for each row execute function app.audit_settings();

create or replace function app.setting(p_key text, p_pharmacy uuid default null) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select s.value from public.settings s
  left join public.pharmacies ph on ph.id = p_pharmacy
  left join public.cities c on c.id = ph.city_id
  where s.key = p_key and (
        (s.scope = 'pharmacy' and s.scope_id = p_pharmacy::text)
     or (s.scope = 'province' and s.scope_id = c.province_id::text)
     or  s.scope = 'platform')
  order by case s.scope when 'pharmacy' then 1 when 'province' then 2 else 3 end
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Audit log for access to sensitive records (filled by later modules)
-- ---------------------------------------------------------------------
create table public.access_log (
  id          bigserial primary key,
  user_id     uuid,
  action      text not null,
  resource    text not null,
  resource_id text,
  at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Pharmacy lifecycle
-- ---------------------------------------------------------------------
-- Only platform staff may change status / approval fields.
create or replace function app.guard_pharmacy_update() returns trigger
language plpgsql as $$
begin
  if (new.status, new.approved_at, new.approved_by, new.is_virtual, new.license_no, new.custom_domain)
     is distinct from
     (old.status, old.approved_at, old.approved_by, old.is_virtual, old.license_no, old.custom_domain)
     and auth.uid() is not null
     and not app.has_platform_permission('pharmacy.approve') then
    raise exception 'only platform staff can change status, license or domain'
      using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger pharmacies_guard before update on public.pharmacies
  for each row execute function app.guard_pharmacy_update();

create or replace function public.register_pharmacy(
  p_name_fa text, p_slug text, p_license_no text, p_city_id int,
  p_address text, p_lat double precision, p_lng double precision, p_phone text,
  p_tech_officer_name text, p_tech_officer_license text,
  p_insurers text[] default '{}')
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_id uuid;
  v_owner_role uuid;
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.pharmacies (name_fa, slug, license_no, city_id, address, lat, lng, phone,
                                 technical_officer_name, technical_officer_license, created_by)
  values (p_name_fa, lower(p_slug), p_license_no, p_city_id, p_address, p_lat, p_lng, p_phone,
          p_tech_officer_name, p_tech_officer_license, auth.uid())
  returning id into v_id;

  insert into public.pharmacy_insurers (pharmacy_id, insurer_code)
  select v_id, unnest(p_insurers);

  select id into v_owner_role from public.roles
   where scope = 'pharmacy' and is_system and code = 'owner';
  insert into public.memberships (user_id, pharmacy_id, role_id)
  values (auth.uid(), v_id, v_owner_role);

  return v_id;
end $$;

create or replace function public.review_pharmacy(p_pharmacy uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not app.has_platform_permission('pharmacy.approve') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.pharmacies
     set status = case when p_approve then 'active' else 'rejected' end,
         approved_at = case when p_approve then now() end,
         approved_by = case when p_approve then auth.uid() end,
         review_note = p_note
   where id = p_pharmacy;
  if not found then raise exception 'pharmacy not found'; end if;
end $$;

-- What the signed-in user may do on the platform (drives the admin UI;
-- the database still enforces every permission on its own).
create or replace function public.my_platform_permissions() returns text[]
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code), '{}')
  from public.memberships m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.user_id = auth.uid() and m.pharmacy_id is null and m.status = 'active';
$$;

-- ---------------------------------------------------------------------
-- Public read model: what a customer may see about stock.
-- Exact quantities stay private; only availability and final price.
-- ---------------------------------------------------------------------
create or replace view public.product_offers
with (security_barrier = true) as
select s.pharmacy_id, s.product_id, ph.slug as pharmacy_slug, ph.city_id,
       app.effective_price(l.price_policy, l.base_price, s.price, s.discount_pct) as final_price,
       coalesce(s.price, l.base_price) as list_price,
       s.discount_pct
from public.stock_items s
join public.pharmacies ph      on ph.id = s.pharmacy_id and ph.status = 'active'
join public.product_listings l on l.product_id = s.product_id and l.is_published
join public.catalog_products p on p.id = s.product_id and p.is_active
where s.quantity > 0;

-- ---------------------------------------------------------------------
-- Allocation: nearest active pharmacies, ranked by basket coverage then
-- distance. Radius defaults to the no-code setting.
-- ---------------------------------------------------------------------
create or replace function public.nearest_pharmacies(
  p_lat double precision, p_lng double precision,
  p_product_ids uuid[] default null,
  p_radius_km numeric default null,
  p_limit int default 20)
returns table (
  pharmacy_id uuid, slug citext, name_fa text, distance_km numeric,
  items_available int, items_requested int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with params as (
    select coalesce(p_radius_km, (app.setting('allocation.initial_radius_km'))::text::numeric, 2) * 1000 as radius_m,
           ll_to_earth(p_lat, p_lng) as origin
  ),
  candidates as (
    select ph.id, ph.slug, ph.name_fa,
           earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) as dist_m
    from public.pharmacies ph, params
    where ph.status = 'active'
      and earth_box(params.origin, params.radius_m) @> ll_to_earth(ph.lat, ph.lng)
      and earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) <= params.radius_m
  )
  select c.id, c.slug, c.name_fa, round((c.dist_m / 1000)::numeric, 2),
         coalesce((select count(*) from public.product_offers o
                    where o.pharmacy_id = c.id
                      and o.product_id = any(p_product_ids))::int, 0),
         coalesce(cardinality(p_product_ids), 0)
  from candidates c
  order by 5 desc, c.dist_m
  limit p_limit;
$$;

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.provinces          enable row level security;
alter table public.cities             enable row level security;
alter table public.insurers           enable row level security;
alter table public.profiles           enable row level security;
alter table public.pharmacies         enable row level security;
alter table public.pharmacy_insurers  enable row level security;
alter table public.permissions        enable row level security;
alter table public.roles              enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.memberships        enable row level security;
alter table public.catalog_products   enable row level security;
alter table public.catalog_sync_state enable row level security;
alter table public.product_listings   enable row level security;
alter table public.category_policies  enable row level security;
alter table public.stock_items        enable row level security;
alter table public.stock_batches      enable row level security;
alter table public.settings           enable row level security;
alter table public.settings_audit     enable row level security;
alter table public.access_log         enable row level security;

-- reference data: readable by everyone
create policy read_all on public.provinces   for select using (true);
create policy read_all on public.cities      for select using (true);
create policy read_all on public.insurers    for select using (true);
create policy read_all on public.permissions for select using (true);
create policy read_all on public.category_policies for select using (true);
create policy manage on public.category_policies for all
  using (app.has_platform_permission('policy.manage'))
  with check (app.has_platform_permission('policy.manage'));

-- profiles: own row only
create policy own_profile on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- pharmacies
create policy read_active on public.pharmacies for select
  using (status = 'active' or app.is_pharmacy_member(id)
         or app.has_platform_permission('pharmacy.read_all'));
create policy update_own on public.pharmacies for update
  using (app.has_pharmacy_permission(id, 'pharmacy.update_profile')
         or app.has_platform_permission('pharmacy.approve'))
  with check (app.has_pharmacy_permission(id, 'pharmacy.update_profile')
              or app.has_platform_permission('pharmacy.approve'));

create policy read on public.pharmacy_insurers for select using (true);
create policy manage on public.pharmacy_insurers for all
  using (app.has_pharmacy_permission(pharmacy_id, 'pharmacy.update_profile'))
  with check (app.has_pharmacy_permission(pharmacy_id, 'pharmacy.update_profile'));

-- roles: system templates visible to all signed-in users; custom roles to their pharmacy
create policy read on public.roles for select to authenticated
  using (pharmacy_id is null or app.is_pharmacy_member(pharmacy_id)
         or app.has_platform_permission('platform.roles.manage'));
create policy manage_pharmacy_roles on public.roles for all to authenticated
  using (pharmacy_id is not null and not is_system and app.has_pharmacy_permission(pharmacy_id, 'staff.manage'))
  with check (pharmacy_id is not null and not is_system and app.has_pharmacy_permission(pharmacy_id, 'staff.manage'));
create policy manage_platform_roles on public.roles for all to authenticated
  using (app.has_platform_permission('platform.roles.manage'))
  with check (app.has_platform_permission('platform.roles.manage'));

create policy read on public.role_permissions for select to authenticated using (true);
create policy manage on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and (
           (r.pharmacy_id is not null and not r.is_system and app.has_pharmacy_permission(r.pharmacy_id, 'staff.manage'))
           or app.has_platform_permission('platform.roles.manage'))))
  with check (exists (select 1 from public.roles r where r.id = role_id and (
           (r.pharmacy_id is not null and not r.is_system and app.has_pharmacy_permission(r.pharmacy_id, 'staff.manage'))
           or app.has_platform_permission('platform.roles.manage'))));

-- memberships
create policy read on public.memberships for select to authenticated
  using (user_id = auth.uid()
         or (pharmacy_id is not null and app.has_pharmacy_permission(pharmacy_id, 'staff.manage'))
         or app.has_platform_permission('platform.roles.manage'));
create policy manage_pharmacy on public.memberships for all to authenticated
  using (pharmacy_id is not null and app.has_pharmacy_permission(pharmacy_id, 'staff.manage'))
  with check (pharmacy_id is not null and app.has_pharmacy_permission(pharmacy_id, 'staff.manage'));
create policy manage_platform on public.memberships for all to authenticated
  using (app.has_platform_permission('platform.roles.manage'))
  with check (app.has_platform_permission('platform.roles.manage'));

-- catalog mirror: read-only for clients; writes via service role / sync job
create policy read_active on public.catalog_products for select
  using (is_active or app.has_platform_permission('catalog.publish'));

-- listings
create policy read_published on public.product_listings for select
  using (is_published or app.has_platform_permission('catalog.publish'));
create policy manage on public.product_listings for all
  using (app.has_platform_permission('catalog.publish'))
  with check (app.has_platform_permission('catalog.publish'));

-- stock: private to the pharmacy and platform ops
create policy read on public.stock_items for select
  using (app.has_pharmacy_permission(pharmacy_id, 'inventory.read')
         or app.has_platform_permission('inventory.read_all'));
create policy manage on public.stock_items for all
  using (app.has_pharmacy_permission(pharmacy_id, 'inventory.manage'))
  with check (app.has_pharmacy_permission(pharmacy_id, 'inventory.manage'));

create policy read on public.stock_batches for select
  using (exists (select 1 from public.stock_items s where s.id = stock_item_id and (
           app.has_pharmacy_permission(s.pharmacy_id, 'inventory.read')
           or app.has_platform_permission('inventory.read_all'))));
create policy manage on public.stock_batches for all
  using (exists (select 1 from public.stock_items s where s.id = stock_item_id
                 and app.has_pharmacy_permission(s.pharmacy_id, 'inventory.manage')))
  with check (exists (select 1 from public.stock_items s where s.id = stock_item_id
                 and app.has_pharmacy_permission(s.pharmacy_id, 'inventory.manage')));

-- settings
create policy read on public.settings for select using (true);
create policy manage_platform on public.settings for all
  using (app.has_platform_permission('settings.manage'))
  with check (app.has_platform_permission('settings.manage'));
create policy manage_pharmacy on public.settings for all
  using (case when scope = 'pharmacy'
              then app.has_pharmacy_permission(scope_id::uuid, 'pharmacy.settings.manage') else false end)
  with check (case when scope = 'pharmacy'
              then app.has_pharmacy_permission(scope_id::uuid, 'pharmacy.settings.manage') else false end);
create policy read on public.settings_audit for select
  using (app.has_platform_permission('audit.read'));

create policy read on public.access_log for select
  using (app.has_platform_permission('audit.read'));

-- the public read model and RPCs
grant usage on schema app to anon, authenticated;
grant select on public.product_offers to anon, authenticated;
grant execute on function public.nearest_pharmacies(double precision, double precision, uuid[], numeric, int) to anon, authenticated;
revoke execute on function public.register_pharmacy(text, text, text, int, text, double precision, double precision, text, text, text, text[]) from anon, public;
grant execute on function public.register_pharmacy(text, text, text, int, text, double precision, double precision, text, text, text, text[]) to authenticated;
revoke execute on function public.my_platform_permissions() from anon, public;
grant execute on function public.my_platform_permissions() to authenticated;
revoke execute on function public.review_pharmacy(uuid, boolean, text) from anon, public;
grant execute on function public.review_pharmacy(uuid, boolean, text) to authenticated;

-- defence in depth: anonymous users never touch operational tables directly
revoke all on public.stock_items, public.stock_batches, public.memberships, public.roles,
              public.role_permissions, public.profiles, public.settings_audit, public.access_log,
              public.catalog_sync_state from anon;
