-- Inventory tools and data enrichment:
--  * product lookup by barcode (catalog GTIN/IRC, plus codes pharmacies suggested and Dorva approved);
--  * pharmacies suggest a barcode for a product; Dorva always reviews (approve/reject in bulk);
--  * receiving stock with batch number, expiry date and UID (scanner tool);
--  * Excel import: upsert many stock rows (prices still wait for Dorva's approval);
--  * contribution points, a "Dorva partner" badge and a small, optional priority
--    in order allocation, each switched on/off in Settings › Data enrichment.

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('enrich.points_enabled', 'enrich', 'boolean', null, null, null, null,
   '{"fa":"امتیاز مشارکت داروخانه‌ها","en":"Contribution points for pharmacies","ar":"نقاط مساهمة الصيدليات"}',
   '{"fa":"برای هر بارکد یا اطلاعاتی که داروخانه پیشنهاد دهد و دوروا تأیید کند، امتیاز داده می‌شود.","en":"Points for every barcode or detail a pharmacy suggests and Dorva approves.","ar":"نقاط لكل رمز تعتمده دوروا."}', 900),
  ('enrich.points_per_code', 'enrich', 'number', null, 1, 100, '{"fa":"امتیاز","en":"points","ar":"نقطة"}',
   '{"fa":"امتیاز هر بارکد تأییدشده","en":"Points per approved barcode","ar":"نقاط لكل رمز معتمد"}', null, 901),
  ('enrich.badge_enabled', 'enrich', 'boolean', null, null, null, null,
   '{"fa":"نشان «همکار دوروا» در صفحه داروخانه","en":"\"Dorva partner\" badge on the pharmacy page","ar":"شارة «شريك دوروا»"}', null, 902),
  ('enrich.badge_points', 'enrich', 'number', null, 1, 10000, '{"fa":"امتیاز","en":"points","ar":"نقطة"}',
   '{"fa":"امتیاز لازم برای نشان","en":"Points needed for the badge","ar":"النقاط اللازمة للشارة"}', null, 903),
  ('enrich.priority_enabled', 'enrich', 'boolean', null, null, null, null,
   '{"fa":"اولویت کم در تخصیص سفارش برای همکاران","en":"Small allocation priority for contributors","ar":"أولوية صغيرة في توزيع الطلبات"}',
   '{"fa":"روشن: بین داروخانه‌های هم‌فاصله، داروخانه همکار طوری حساب می‌شود که انگار امروز چند سفارش کمتر گرفته (حداکثر طبق تنظیم زیر). فاصله و موجودی کامل همچنان اولویت اول است.","en":"On: among equally near pharmacies, a contributor counts as if it had a few fewer orders today (up to the maximum below). Distance and a full basket still come first.","ar":"تشغيل: بين الصيدليات المتساوية في المسافة."}', 904),
  ('enrich.priority_points', 'enrich', 'number', null, 5, 10000, '{"fa":"امتیاز","en":"points","ar":"نقطة"}',
   '{"fa":"امتیاز لازم برای هر یک سفارش اولویت","en":"Points per order of priority","ar":"النقاط لكل طلب أولوية"}', null, 905),
  ('enrich.priority_max', 'enrich', 'number', null, 0, 5, '{"fa":"سفارش","en":"orders","ar":"طلب"}',
   '{"fa":"حداکثر اولویت (سفارش در روز)","en":"Maximum priority (orders per day)","ar":"الحد الأقصى للأولوية"}', null, 906)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('enrich.points_enabled', 'platform', 'true', 'امتیاز مشارکت'),
  ('enrich.points_per_code', 'platform', '1', 'امتیاز هر بارکد'),
  ('enrich.badge_enabled', 'platform', 'true', 'نشان همکار دوروا'),
  ('enrich.badge_points', 'platform', '20', 'امتیاز لازم برای نشان'),
  ('enrich.priority_enabled', 'platform', 'false', 'اولویت کم برای همکاران'),
  ('enrich.priority_points', 'platform', '50', 'امتیاز هر سفارش اولویت'),
  ('enrich.priority_max', 'platform', '1', 'حداکثر اولویت')
on conflict do nothing;

-- ---------------------------------------------------------------- barcodes
create table if not exists public.product_codes (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.catalog_products(id) on delete cascade,
  code         text not null check (code ~ '^[0-9A-Za-z]{6,40}$'),
  kind         text not null default 'gtin' check (kind in ('gtin', 'irc', 'other')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  pharmacy_id  uuid references public.pharmacies(id) on delete set null,
  suggested_by uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  reviewed_by  uuid references auth.users(id),
  reviewed_at  timestamptz,
  note         text check (note is null or length(note) <= 300)
);
create unique index if not exists product_codes_approved on public.product_codes (code) where status = 'approved';
create unique index if not exists product_codes_once on public.product_codes (code, product_id, coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending';
create index if not exists product_codes_pending on public.product_codes (created_at) where status = 'pending';
alter table public.product_codes enable row level security;   -- through the functions below only

create table if not exists public.pharmacy_points (
  id          bigserial primary key,
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  points      int not null,
  reason      text not null check (reason in ('code', 'adjust')),
  ref         uuid,
  created_at  timestamptz not null default now()
);
create index if not exists pharmacy_points_ph on public.pharmacy_points (pharmacy_id);
alter table public.pharmacy_points enable row level security;

-- GTIN-8/12/13/14 written the same way: digits only, no leading zeros beyond 13 digits
create or replace function app.norm_code(p text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when regexp_replace(coalesce(p, ''), '\s', '', 'g') ~ '^[0-9]{8,14}$'
              then ltrim(regexp_replace(p, '\s', '', 'g'), '0')
              else upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')) end;
$$;

-- the product a scanned code belongs to: catalog GTIN/IRC first, then approved suggestions,
-- then (for the suggesting pharmacy only) its own pending suggestion
create or replace function public.product_by_code(p_code text, p_pharmacy uuid default null)
returns table (product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, gtin text, irc text, source text,
               quantity int, image_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select app.norm_code(p_code) k),
  hit as (
    select p.id, 'catalog' src, 1 ord from catalog_products p, c where c.k <> '' and (app.norm_code(p.gtin) = c.k or app.norm_code(p.irc) = c.k)
    union all
    select x.product_id, 'approved', 2 from product_codes x, c where x.status = 'approved' and app.norm_code(x.code) = c.k
    union all
    select x.product_id, 'pending', 3 from product_codes x, c where x.status = 'pending' and app.norm_code(x.code) = c.k
      and p_pharmacy is not null and x.pharmacy_id = p_pharmacy
  )
  select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.gtin, p.irc, h.src,
         (select s.quantity from stock_items s where s.product_id = p.id and s.pharmacy_id = p_pharmacy
            and app.has_pharmacy_permission(p_pharmacy, 'inventory.read')),
         p.image_url
  from (select distinct on (id) id, src, ord from hit order by id, ord) h join catalog_products p on p.id = h.id
  order by h.ord limit 5;
$$;

create or replace function public.code_suggest(p_pharmacy uuid, p_code text, p_product uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text := app.norm_code(p_code);
begin
  if not (app.has_pharmacy_permission(p_pharmacy, 'inventory.manage') or app.has_pharmacy_permission(p_pharmacy, 'inventory.read')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if k !~ '^[0-9A-Z]{6,40}$' then return 'code'; end if;
  if not exists (select 1 from catalog_products where id = p_product) then return 'product'; end if;
  if exists (select 1 from catalog_products where id = p_product and (app.norm_code(gtin) = k or app.norm_code(irc) = k))
     or exists (select 1 from product_codes where status = 'approved' and app.norm_code(code) = k and product_id = p_product) then
    return 'known';
  end if;
  if exists (select 1 from product_codes where status = 'approved' and app.norm_code(code) = k) then return 'taken'; end if;
  insert into product_codes (product_id, code, kind, pharmacy_id, suggested_by)
  values (p_product, k, case when k ~ '^[0-9]{8,14}$' then 'gtin' else 'other' end, p_pharmacy, auth.uid())
  on conflict do nothing;
  return 'ok';
end $$;

-- Dorva's review queue: one row per suggestion, with how many pharmacies agree
create or replace function public.code_suggestions()
returns table (id uuid, code text, product_id uuid, product_name text, product_gtin text, pharmacy_name text,
               created_at timestamptz, agree int, conflicts int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('catalog.publish') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select x.id, x.code, x.product_id, p.name_fa, p.gtin, ph.name_fa, x.created_at,
           (select count(distinct y.pharmacy_id)::int from product_codes y where y.status = 'pending' and y.code = x.code and y.product_id = x.product_id),
           (select count(distinct y.product_id)::int - 1 from product_codes y where y.status = 'pending' and y.code = x.code)
    from product_codes x join catalog_products p on p.id = x.product_id left join pharmacies ph on ph.id = x.pharmacy_id
    where x.status = 'pending'
    order by x.code, x.created_at;
end $$;

create or replace function public.code_review(p_ids uuid[], p_approve boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; v_pts int := app.setting_num('enrich.points_per_code', 1)::int;
begin
  if not app.has_platform_permission('catalog.publish') then raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select * from product_codes where id = any(p_ids) and status = 'pending' order by created_at loop
    if not p_approve then
      update product_codes set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), note = left(nullif(trim(p_note), ''), 300) where id = r.id;
      n := n + 1;
      continue;
    end if;
    -- a code belongs to one product: approving it closes the other pending suggestions for the code
    if exists (select 1 from product_codes where status = 'approved' and code = r.code) then
      update product_codes set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), note = 'duplicate' where id = r.id;
      continue;
    end if;
    update product_codes set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = r.id;
    -- everyone who suggested the same link earns the points; the rest are closed
    if app.setting_bool('enrich.points_enabled', true) then
      insert into pharmacy_points (pharmacy_id, points, reason, ref)
      select distinct y.pharmacy_id, v_pts, 'code', r.id from product_codes y
      where y.code = r.code and y.product_id = r.product_id and y.pharmacy_id is not null and (y.id = r.id or y.status = 'pending');
    end if;
    update product_codes set status = case when product_id = r.product_id then 'approved' else 'rejected' end,
                             reviewed_by = auth.uid(), reviewed_at = now()
    where code = r.code and status = 'pending' and id <> r.id and product_id <> r.product_id;
    delete from product_codes where code = r.code and status = 'pending' and product_id = r.product_id and id <> r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- approved codes for the catalog team (the catalog itself is managed elsewhere)
create or replace function public.code_export()
returns table (product_id uuid, name_fa text, irc text, catalog_gtin text, code text, kind text, approved_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('catalog.publish') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select p.id, p.name_fa, p.irc, p.gtin, x.code, x.kind, x.reviewed_at
    from product_codes x join catalog_products p on p.id = x.product_id where x.status = 'approved' order by x.reviewed_at;
end $$;

-- ---------------------------------------------------------------- points, badge, priority
create or replace function app.pharmacy_points_total(p_pharmacy uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(points), 0)::int from pharmacy_points where pharmacy_id = p_pharmacy;
$$;

create or replace function public.pharmacy_contribution(p_pharmacy uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_pts int := app.pharmacy_points_total(p_pharmacy);
begin
  if not (app.is_pharmacy_member(p_pharmacy) or app.has_platform_permission('pharmacy.read_all')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'points', v_pts, 'points_enabled', app.setting_bool('enrich.points_enabled', true),
    'badge_enabled', app.setting_bool('enrich.badge_enabled', true), 'badge_points', app.setting_num('enrich.badge_points', 20),
    'priority_enabled', app.setting_bool('enrich.priority_enabled', false), 'priority', app.contribution_bonus(p_pharmacy),
    'pending', (select count(*) from product_codes where pharmacy_id = p_pharmacy and status = 'pending'),
    'approved', (select count(*) from product_codes where pharmacy_id = p_pharmacy and status = 'approved'),
    'rejected', (select count(*) from product_codes where pharmacy_id = p_pharmacy and status = 'rejected'));
end $$;

-- public: does this pharmacy show the "Dorva partner" badge?
create or replace function public.pharmacy_badge(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.setting_bool('enrich.badge_enabled', true)
     and app.pharmacy_points_total(p_pharmacy) >= app.setting_num('enrich.badge_points', 20);
$$;

-- orders "forgiven" today when picking among equally near pharmacies
create or replace function app.contribution_bonus(p_pharmacy uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not app.setting_bool('enrich.priority_enabled', false) then 0
              else least(app.setting_num('enrich.priority_max', 1)::int,
                         app.pharmacy_points_total(p_pharmacy) / greatest(app.setting_num('enrich.priority_points', 50)::int, 1)) end;
$$;

create or replace function app.effective_load(p_pharmacy uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select dl.orders from public.pharmacy_daily_load dl where dl.pharmacy_id = p_pharmacy and dl.day = current_date), 0)
         - app.contribution_bonus(p_pharmacy);
$$;

-- the cart allocation, unchanged except that the daily load includes the contribution bonus
create or replace function public.plan_cart(
  p_items     jsonb,
  p_city      int default null,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_preferred uuid default null,
  p_force     uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_total     int;
  v_max_ph    int     := greatest(coalesce((app.setting('cart.max_pharmacies'))::text::int, 2), 1);
  v_r0        numeric := coalesce((app.setting('allocation.initial_radius_km'))::text::numeric, 2);
  v_step      numeric := greatest(coalesce((app.setting('allocation.radius_step_km'))::text::numeric, 2), 0.5);
  v_rmax      numeric := coalesce((app.setting('allocation.max_radius_km'))::text::numeric, 10);
  v_band      numeric := greatest(coalesce((app.setting('allocation.equal_band_km'))::text::numeric, 1), 0);
  v_tiebreak  text    := coalesce(app.setting('allocation.tiebreak') #>> '{}', 'round_robin');
  v_w         jsonb   := coalesce(app.setting('allocation.weights'), '{}'::jsonb);
  v_prefer    boolean := coalesce((app.setting('allocation.prefer_shopped_pharmacy'))::text::boolean, true);
  v_split_min numeric := coalesce((app.setting('cart.split_min_subtotal_rial'))::text::numeric, 0);
  v_loc_req   text    := coalesce(app.setting('checkout.location_required') #>> '{}', 'point');
  v_has_loc   boolean := p_lat is not null and p_lng is not null;
  v_r         numeric;
  v_d0        numeric;
  v_chosen    uuid[] := '{}';
  v_strategy  text;
  v_radius    numeric;
  v_pick      uuid;
  v_band_n    int := 0;
  v_part      numeric;
  i           int;
  v_result    jsonb;
  v_cand      app.cart_cand[];
  v_avail     app.cart_avail[];
begin
  select count(*) into v_total from app.cart_lines(p_items) where dispensing_class <> 'rx';

  select coalesce(array_agg(row(c.pharmacy_id, c.distance_km, c.covered, c.subtotal, c.n::int,
           app.effective_load(c.pharmacy_id),
           coalesce((select (coalesce(m.acceptance_rate, 0.5) + coalesce(m.rating / 5, 0.5)) / 2
                       from public.pharmacy_metrics m where m.pharmacy_id = c.pharmacy_id), 0.5)
         )::app.cart_cand order by c.n), '{}')
    into v_cand
  from public.cart_candidates(p_items, p_city, p_lat, p_lng, 100) with ordinality as c(pharmacy_id, slug, name_fa, name_i18n,
         city_id, district_id, distance_km, covered, total, subtotal, n);

  select coalesce(array_agg(row(o.pharmacy_id, l.product_id, l.qty, o.final_price, o.list_price, o.discount_pct)::app.cart_avail), '{}')
    into v_avail
  from app.cart_lines(p_items) l
  join app.offers o on o.product_id = l.product_id
  join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = l.product_id
  where l.dispensing_class <> 'rx' and s.quantity >= l.qty
    and o.pharmacy_id in (select (x).pharmacy_id from unnest(v_cand) x);

  if v_total = 0 then
    v_strategy := 'empty';
  elsif p_force is not null and exists (select 1 from unnest(v_cand) where pharmacy_id = p_force) then
    v_chosen := array[p_force]; v_strategy := 'chosen';
  elsif v_prefer and p_preferred is not null
        and exists (select 1 from unnest(v_cand) where pharmacy_id = p_preferred and covered = v_total) then
    v_chosen := array[p_preferred]; v_strategy := 'preferred';
  else
    -- (c) nearest complete pharmacy, widening the radius
    if v_has_loc then
      v_r := v_r0;
      loop
        select min(distance_km) into v_d0 from unnest(v_cand) where covered = v_total and distance_km <= v_r;
        exit when v_d0 is not null or v_r >= v_rmax;
        v_r := least(v_r + v_step, v_rmax);
      end loop;
      v_radius := v_r;
    end if;

    if exists (select 1 from unnest(v_cand) where covered = v_total) and (v_d0 is not null or not v_has_loc) then
      -- the equal-distance band, then the configured tie-break
      with band as (
        select c.* from unnest(v_cand) c
        where c.covered = v_total
          and (not v_has_loc or c.distance_km <= v_d0 + case when v_tiebreak = 'nearest' then 0 else v_band end)
      ),
      stats as (
        select min(distance_km) dmin, max(distance_km) dmax, min(subtotal) smin, max(subtotal) smax,
               max(load) lmax, count(*) n from band
      ),
      ranked as (
        select b.pharmacy_id, s.n,
          case v_tiebreak
            when 'score' then
                coalesce((v_w->>'distance')::numeric, 0) *
                  case when b.distance_km is null or s.dmax = s.dmin then 1
                       else 1 - (b.distance_km - s.dmin) / (s.dmax - s.dmin) end
              + coalesce((v_w->>'quality')::numeric, 0) * b.quality
              + coalesce((v_w->>'price')::numeric, 0) *
                  case when s.smax = s.smin then 1 else 1 - (b.subtotal - s.smin) / (s.smax - s.smin) end
              + coalesce((v_w->>'load')::numeric, 0) *
                  case when s.lmax = 0 then 1 else 1 - b.load::numeric / s.lmax end
            else 0 end as score
        from band b cross join stats s
      )
      select r.pharmacy_id, r.n into v_pick, v_band_n
      from ranked r join unnest(v_cand) c using (pharmacy_id)
      order by
        case when v_tiebreak = 'nearest' then coalesce(c.distance_km, 0) end,
        case when v_tiebreak = 'round_robin' then c.load end,
        case when v_tiebreak = 'score' then -r.score end,
        md5(c.pharmacy_id::text || current_date::text)
      limit 1;
    end if;

    if v_pick is not null then
      v_chosen := array[v_pick]; v_strategy := 'single';
    elsif v_max_ph >= 2 and exists (select 1 from unnest(v_cand)) then
      -- (d) best pair: most lines covered, then least total distance, then least load
      select array[a.pharmacy_id, b.pharmacy_id] into v_chosen
      from (select * from unnest(v_cand) order by rnk limit 30) a
      join (select * from unnest(v_cand) order by rnk limit 30) b on a.rnk < b.rnk
      order by (select count(distinct product_id) from unnest(v_avail) v
                 where v.pharmacy_id in (a.pharmacy_id, b.pharmacy_id)) desc,
               coalesce(a.distance_km, 0) + coalesce(b.distance_km, 0),
               a.load + b.load,
               a.rnk + b.rnk
      limit 1;
      -- the pharmacy covering more lines goes first
      if v_chosen is not null and (select covered from unnest(v_cand) where pharmacy_id = v_chosen[2])
                                > (select covered from unnest(v_cand) where pharmacy_id = v_chosen[1]) then
        v_chosen := array[v_chosen[2], v_chosen[1]];
      end if;
      -- more pharmacies if the setting allows: add greedily
      while v_chosen is not null and coalesce(array_length(v_chosen, 1), 0) < v_max_ph loop
        v_pick := null;
        select c.pharmacy_id into v_pick from unnest(v_cand) c
         where not c.pharmacy_id = any(v_chosen)
           and exists (select 1 from unnest(v_avail) v where v.pharmacy_id = c.pharmacy_id
                         and v.product_id not in (select product_id from unnest(v_avail) where pharmacy_id = any(v_chosen)))
         order by c.rnk limit 1;
        exit when v_pick is null;
        v_chosen := v_chosen || v_pick;
      end loop;
      -- remove extra pharmacies whose share is too small to justify another delivery
      i := 2;
      while v_chosen is not null and i <= coalesce(array_length(v_chosen, 1), 0) loop
        select coalesce(sum(v.final_price * v.qty), 0) into v_part
        from unnest(v_avail) v
        where v.pharmacy_id = v_chosen[i]
          and v.product_id not in (select product_id from unnest(v_avail) where pharmacy_id = any(v_chosen[1:i-1]));
        if v_part = 0 or v_part < v_split_min then
          v_chosen := v_chosen[1:i-1] || v_chosen[i+1:];
        else
          i := i + 1;
        end if;
      end loop;
      v_strategy := case when coalesce(array_length(v_chosen, 1), 0) > 1 then 'split' else 'partial' end;
    else
      v_chosen := array[(select pharmacy_id from unnest(v_cand) order by rnk limit 1)];
      v_strategy := 'partial';
    end if;
    v_chosen := coalesce(v_chosen, '{}');
    if array_length(v_chosen, 1) is null or v_chosen[1] is null then
      v_chosen := '{}'; v_strategy := 'none';
    end if;
  end if;

  -- each line goes to the first chosen pharmacy (in priority order) that has it
  with assigned as (
    select distinct on (v.product_id) v.*, array_position(v_chosen, v.pharmacy_id) as pos
    from unnest(v_avail) v
    where v.pharmacy_id = any(v_chosen)
    order by v.product_id, array_position(v_chosen, v.pharmacy_id)
  ),
  per_ph as (
    select a.pharmacy_id, min(a.pos) as pos,
           jsonb_agg(jsonb_build_object(
             'product_id', a.product_id, 'qty', a.qty, 'unit_price', a.final_price,
             'list_price', a.list_price, 'discount_pct', a.discount_pct,
             'line_total', a.final_price * a.qty) order by a.product_id) as items,
           sum(a.final_price * a.qty) as subtotal
    from assigned a group by a.pharmacy_id
  )
  select jsonb_build_object(
    'strategy', v_strategy,
    'tiebreak', v_tiebreak,
    'band_km', v_band,
    'band_size', v_band_n,
    'radius_km', v_radius,
    'max_pharmacies', v_max_ph,
    'has_location', v_has_loc,
    'location_required', case v_loc_req when 'point' then not v_has_loc
                                        when 'city' then (p_city is null and not v_has_loc) else false end,
    'pharmacies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'pharmacy_id', ph.id, 'slug', ph.slug, 'name_fa', ph.name_fa, 'name_i18n', ph.name_i18n,
        'city_id', ph.city_id, 'district_id', ph.district_id, 'distance_km', c.distance_km,
        'items', p.items, 'subtotal', p.subtotal) order by p.pos)
      from per_ph p
      join public.pharmacies ph on ph.id = p.pharmacy_id
      join unnest(v_cand) c on c.pharmacy_id = p.pharmacy_id), '[]'::jsonb),
    'total', coalesce((select sum(subtotal) from per_ph), 0),
    'unavailable', coalesce((
      select jsonb_agg(l.product_id) from app.cart_lines(p_items) l
      where l.dispensing_class <> 'rx'
        and l.product_id not in (select product_id from assigned)), '[]'::jsonb),
    'needs_prescription', coalesce((
      select jsonb_agg(l.product_id) from app.cart_lines(p_items) l
      where l.dispensing_class = 'rx'), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------- receiving stock (scanner) and Excel import
create or replace function public.stock_receive(p_pharmacy uuid, p_product uuid, p_qty int, p_batch text default null,
                                                p_expiry date default null, p_uid text default null) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_item uuid;
begin
  if not app.has_pharmacy_permission(p_pharmacy, 'inventory.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_qty is null or p_qty not between 1 and 100000 then return 'qty'; end if;
  if p_expiry is not null and p_expiry < current_date then return 'expired'; end if;
  if not exists (select 1 from catalog_products where id = p_product) then return 'product'; end if;
  insert into stock_items (pharmacy_id, product_id, quantity, source) values (p_pharmacy, p_product, p_qty, 'manual')
  on conflict (pharmacy_id, product_id) do update set quantity = stock_items.quantity + excluded.quantity, updated_at = now()
  returning id into v_item;
  if p_batch is not null or p_expiry is not null or p_uid is not null then
    insert into stock_batches (stock_item_id, batch_no, expiry_date, uid, quantity)
    values (v_item, nullif(left(trim(p_batch), 40), ''), p_expiry, nullif(left(trim(p_uid), 80), ''), p_qty);
  end if;
  return 'ok';
end $$;

-- rows: [{product_id, quantity, discount_pct, price (Rial or null)}]; new rows are inserted
create or replace function public.stock_import_apply(p_pharmacy uuid, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare it jsonb; v_ok int := 0; v_err jsonb := '[]'::jsonb; v_cap text; v_code text;
begin
  if not app.has_pharmacy_permission(p_pharmacy, 'inventory.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    return jsonb_build_object('ok', 0, 'errors', jsonb_build_array(jsonb_build_object('product_id', null, 'code', 'too_many')));
  end if;
  for it in select * from jsonb_array_elements(p_rows) loop
    begin
      if coalesce(it->>'quantity', '') !~ '^[0-9]{1,6}$'
         or coalesce(it->>'discount_pct', '') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or (it->>'discount_pct')::numeric > 100
         or (it->>'price' is not null and it->>'price' !~ '^[0-9]{1,13}$') then
        v_err := v_err || jsonb_build_object('product_id', it->>'product_id', 'code', 'value'); continue;
      end if;
      insert into stock_items (pharmacy_id, product_id, quantity, discount_pct, price, source)
      values (p_pharmacy, (it->>'product_id')::uuid, (it->>'quantity')::int, (it->>'discount_pct')::numeric,
              nullif(it->>'price', '')::numeric, 'excel')
      on conflict (pharmacy_id, product_id) do update set quantity = excluded.quantity, discount_pct = excluded.discount_pct,
             price = excluded.price, source = 'excel', updated_at = now();
      v_ok := v_ok + 1;
    exception when others then
      v_cap := substring(sqlerrm from 'exceeds max allowed ([0-9.]+)');
      v_code := case when v_cap is not null then 'discount' when sqlerrm like '%above Dorva cap%' then 'price_cap'
                     when sqlerrm like '%below Dorva floor%' then 'price_floor' when sqlstate = '42501' then 'forbidden'
                     when sqlstate = '23503' then 'product' else 'unknown' end;
      v_err := v_err || jsonb_build_object('product_id', it->>'product_id', 'code', v_code, 'cap', v_cap);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_err);
end $$;

grant execute on function public.product_by_code(text, uuid) to authenticated;
grant execute on function public.code_suggest(uuid, text, uuid) to authenticated;
grant execute on function public.code_suggestions() to authenticated;
grant execute on function public.code_review(uuid[], boolean, text) to authenticated;
grant execute on function public.code_export() to authenticated;
grant execute on function public.pharmacy_contribution(uuid) to authenticated;
grant execute on function public.pharmacy_badge(uuid) to anon, authenticated;
grant execute on function public.stock_receive(uuid, uuid, int, text, date, text) to authenticated;
grant execute on function public.stock_import_apply(uuid, jsonb) to authenticated;

-- everything the pharmacy's Excel template needs, in one query: published products
-- (and anything already in its stock) with codes, Dorva price, cap and current stock
create or replace function public.stock_template(p_pharmacy uuid)
returns table (product_id uuid, irc text, gtin text, name_fa text, name_en text, generic_name text, dispensing_class text,
               category_path text[], brand text, base_price numeric, price_policy text, cap numeric,
               quantity int, own_price numeric, own_discount numeric, price_requested numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_pharmacy_permission(p_pharmacy, 'inventory.read') or app.has_platform_permission('pharmacy.read_all')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, p.irc,
           coalesce(p.gtin, (select x.code from product_codes x where x.product_id = p.id and x.status = 'approved' order by x.reviewed_at limit 1)),
           p.name_fa, p.name_en, p.generic_name, p.dispensing_class, p.category_path,
           case jsonb_typeof(p.facets->'brand') when 'array' then p.facets->'brand'->>0 else p.facets->>'brand' end,
           l.base_price, coalesce(l.price_policy, 'fixed'), app.max_discount(p.id),
           s.quantity, s.price, s.discount_pct, s.price_requested
    from catalog_products p
    left join product_listings l on l.product_id = p.id
    left join stock_items s on s.product_id = p.id and s.pharmacy_id = p_pharmacy
    where p.is_active and (coalesce(l.is_published, false) or s.id is not null)
    order by p.category_path, p.name_fa;
end $$;
grant execute on function public.stock_template(uuid) to authenticated;
