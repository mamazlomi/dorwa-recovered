-- Storefront look (test round 1 feedback):
--   * color settings + "Look & graphics" group (theme.*), low-stock threshold
--   * product search ranks whole-word matches first ("وی" → whey before vitamin)
--   * search suggestions from catalog words, brands and categories
--   * pharmacy search matches words by their start (no "ش" → every "آزمایشی" address)
--   * page builder: text banners (no image needed), icon tiles, feature strip block
--   * default Dorva home page layout (only when none exists)

set search_path = public, extensions;

-- ---------------------------------------------------------------- color settings
alter table public.setting_definitions drop constraint if exists setting_definitions_value_type_check;
alter table public.setting_definitions add constraint setting_definitions_value_type_check
  check (value_type in ('number', 'boolean', 'enum', 'weights', 'text', 'color'));

create or replace function app.validate_setting() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare d public.setting_definitions; v numeric; k text;
begin
  select * into d from public.setting_definitions where key = new.key;
  if not found then return new; end if;            -- undeclared keys: free-form (legacy)
  if not new.scope = any(d.scopes) then
    raise exception 'setting % cannot be set at % scope', new.key, new.scope using errcode = 'check_violation';
  end if;
  case d.value_type
    when 'number' then
      if jsonb_typeof(new.value) <> 'number' then
        raise exception 'setting % must be a number', new.key using errcode = 'check_violation'; end if;
      v := (new.value)::text::numeric;
      if (d.min_value is not null and v < d.min_value) or (d.max_value is not null and v > d.max_value) then
        raise exception 'setting % must be between % and %', new.key, d.min_value, d.max_value using errcode = 'check_violation'; end if;
    when 'boolean' then
      if jsonb_typeof(new.value) <> 'boolean' then
        raise exception 'setting % must be true/false', new.key using errcode = 'check_violation'; end if;
    when 'enum' then
      if jsonb_typeof(new.value) <> 'string'
         or not exists (select 1 from jsonb_array_elements(d.options) o where o->>'value' = new.value #>> '{}') then
        raise exception 'setting % must be one of the listed options', new.key using errcode = 'check_violation'; end if;
    when 'weights' then
      if jsonb_typeof(new.value) <> 'object' then
        raise exception 'setting % must be a set of weights', new.key using errcode = 'check_violation'; end if;
      for k in select jsonb_object_keys(d.options) loop
        if jsonb_typeof(new.value->k) <> 'number' or (new.value->>k)::numeric < 0 or (new.value->>k)::numeric > 1 then
          raise exception 'weight % of % must be between 0 and 1', k, new.key using errcode = 'check_violation'; end if;
      end loop;
    when 'color' then
      if jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then
        raise exception 'setting % must be a color like #0e76a8', new.key using errcode = 'check_violation'; end if;
    else null;
  end case;
  return new;
end $$;

insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('theme.primary', 'theme', 'color', null, null, null, null,
   '{"fa":"رنگ اصلی (دکمه‌ها و لینک‌ها)","en":"Primary color (buttons, links)","ar":"اللون الأساسي (الأزرار والروابط)"}',
   '{"fa":"رنگ تیره‌ای انتخاب کنید که متن سفید روی آن خوانا باشد. سایه‌های روشن و تیره خودکار ساخته می‌شوند.","en":"Pick a dark enough color for white text. Lighter and darker shades are made automatically.","ar":"اختر لوناً داكناً يقرأ عليه النص الأبيض. تُنشأ الدرجات تلقائياً."}', 10),
  ('theme.highlight', 'theme', 'color', null, null, null, null,
   '{"fa":"رنگ برجسته (رنگ لوگو، نوارها و گرادیان‌ها)","en":"Highlight color (logo, bands, gradients)","ar":"لون التمييز (الشعار والأشرطة)"}', null, 20),
  ('theme.accent', 'theme', 'color', null, null, null, null,
   '{"fa":"رنگ مکمل (عنوان بخش‌ها و نشان‌ها)","en":"Accent color (section titles, badges)","ar":"اللون المكمل (عناوين الأقسام)"}', null, 30),
  ('theme.logo', 'theme', 'enum',
   '[{"value":"image","label":{"fa":"تصویر لوگو","en":"Logo image","ar":"صورة الشعار"}},{"value":"text","label":{"fa":"نام دوروا به‌صورت متن","en":"Dorva name as text","ar":"اسم دوروا نصاً"}}]',
   null, null, null,
   '{"fa":"نمایش لوگو در سربرگ","en":"Logo in the header","ar":"الشعار في الترويسة"}', null, 40),
  ('theme.page_width', 'theme', 'number', null, 1024, 1600, '{"fa":"پیکسل","en":"px","ar":"بكسل"}',
   '{"fa":"حداکثر عرض صفحه","en":"Maximum page width","ar":"أقصى عرض للصفحة"}',
   '{"fa":"روی نمایشگرهای بزرگ، محتوا تا این عرض پهن می‌شود.","en":"On large screens content widens up to this.","ar":"على الشاشات الكبيرة يتسع المحتوى حتى هذا العرض."}', 50),
  ('catalog.low_stock_threshold', 'catalog', 'number', null, 0, 50, '{"fa":"عدد","en":"items","ar":"قطعة"}',
   '{"fa":"هشدار «فقط n عدد باقی مانده»","en":"\"Only n left\" warning","ar":"تنبيه «بقي n فقط»"}',
   '{"fa":"وقتی موجودی داروخانه کمتر یا مساوی این عدد باشد، کنار آن نوشته می‌شود. ۰ = هرگز.","en":"Shown when a pharmacy has this many or fewer. 0 = never.","ar":"يظهر عندما يكون المخزون بهذا العدد أو أقل. 0 = أبداً."}', 120)
on conflict (key) do update set group_code = excluded.group_code, value_type = excluded.value_type, options = excluded.options,
  min_value = excluded.min_value, max_value = excluded.max_value, unit = excluded.unit, label = excluded.label, help = excluded.help;

insert into public.settings (key, scope, value, description_fa) values
  ('theme.primary', 'platform', '"#0e76a8"', 'رنگ اصلی'),
  ('theme.highlight', 'platform', '"#1fbedb"', 'رنگ برجسته'),
  ('theme.accent', 'platform', '"#6b3af7"', 'رنگ مکمل'),
  ('theme.logo', 'platform', '"image"', 'نمایش لوگو'),
  ('theme.page_width', 'platform', '1320', 'حداکثر عرض صفحه'),
  ('catalog.low_stock_threshold', 'platform', '3', 'هشدار موجودی کم')
on conflict do nothing;

-- ---------------------------------------------------------------- product search: relevance
create or replace function app.match_rank(p_text text, p_q text) returns int
language sql immutable parallel safe set search_path = pg_catalog as $$
  -- 3 = whole word, 2 = a word starts with it, 1 = anywhere, 0 = no match (inputs already normalised)
  select case when p_q is null or p_text is null then 0
              when ' ' || p_text || ' ' like '% ' || p_q || ' %' then 3
              when ' ' || p_text like '% ' || p_q || '%' then 2
              when p_text like '%' || p_q || '%' then 1 else 0 end;
$$;

create or replace function public.shop_search(
  p_city int default null, p_query text default null, p_filters jsonb default '{}'::jsonb,
  p_pharmacy uuid default null, p_collection uuid default null,
  p_limit int default 48, p_offset int default 0, p_sort text default null)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, list_price numeric, max_discount numeric,
              pharmacies int, total int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) as q),
  col as (select * from app.collection_def(p_collection)),
  mem as materialized (select x as id from app.collection_product_ids(p_collection) x where p_collection is not null),
  ctx0 as (
    select p_collection is not null as has_col,
           coalesce(p_pharmacy, (select c.pharmacy_id from col c)) as ph,
           coalesce((select c.only_discounted from col c), false) as disc,
           (select c.sort_mode from col c) as mode
  ),
  ctx as (select ctx0.*, app.resolve_sort(p_sort, ctx0.mode, ctx0.ph) as srt from ctx0),
  prods as materialized (
    select p.*,
           greatest(app.match_rank(app.norm_text(p.name_fa), q.q),
                    app.match_rank(app.norm_text(coalesce(p.generic_name, '')), q.q),
                    least(app.match_rank(app.norm_text(p.name_i18n::text), q.q), 2)) as rel
    from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    cross join q cross join ctx
    where p.is_active
      and (q.q is null
           or app.norm_text(p.name_fa) like '%' || q.q || '%'
           or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%'
           or app.norm_text(p.name_i18n::text) like '%' || q.q || '%')
      and app.product_passes(p, p_filters)
      and (not ctx.has_col or p.id in (select m.id from mem m))
  ),
  agg as materialized (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, min(o.list_price) lp,
           max(o.discount_pct) md, count(*)::int n
    from app.offers o
    join prods pp on pp.id = o.product_id
    cross join ctx
    where (p_city is null or o.city_id = p_city)
      and (ctx.ph is null or o.pharmacy_id = ctx.ph)
    group by o.product_id
  ),
  sig as materialized (
    select s.* from ctx, lateral app.product_signals(
      case when ctx.srt in ('bestselling', 'most_viewed', 'popular')
           then (select array_agg(pp.id) from prods pp) else '{}'::uuid[] end) s
  ),
  res as (
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url, p.first_seen_at, p.rel,
           a.mn, a.mx, a.lp, a.md, coalesce(a.n, 0) n,
           coalesce(s.views, 0) views, coalesce(s.sales, 0) sales, coalesce(s.popular, 0) popular
    from prods p left join agg a on a.product_id = p.id left join sig s on s.product_id = p.id cross join ctx
    where ((ctx.ph is null and p_city is null) or a.n is not null)
      and (not ctx.disc or coalesce(a.md, 0) > 0)
  )
  select r.id, r.name_fa, r.name_i18n, r.dispensing_class, r.category_path, r.image_url,
         r.mn, r.mx, r.lp, r.md, r.n, (count(*) over ())::int
  from res r cross join ctx
  order by r.n = 0,
           -- a search the visitor did not sort: whole-word matches first, then Dorva's sort policy
           case when (select q.q from q) is not null and coalesce(p_sort, 'recommended') = 'recommended'
                then r.rel end desc nulls last,
           case when ctx.srt = 'bestselling' then r.sales end desc nulls last,
           case when ctx.srt = 'most_viewed' then r.views end desc nulls last,
           case when ctx.srt = 'popular' then r.popular end desc nulls last,
           case when ctx.srt = 'price_asc' then r.mn end asc nulls last,
           case when ctx.srt = 'newest' then r.first_seen_at end desc nulls last,
           r.md desc nulls last,
           r.name_fa
  limit least(greatest(coalesce(p_limit, 48), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ---------------------------------------------------------------- search suggestions
-- words of active product names that start with what was typed, plus matching brands and categories
create or replace function public.search_suggest(p_query text, p_limit int default 8)
returns table(term text, kind text, hits int)
language sql stable security definer set search_path = public, pg_temp as $$
  with q as (select app.norm_text(trim(p_query)) as q where length(trim(coalesce(p_query, ''))) >= 2),
  prods as (
    select p.name_fa, p.facets, p.category_path from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    where p.is_active and p.dispensing_class <> 'rx'
  ),
  words as (
    select w as term, 'word'::text as kind, count(*)::int hits
    from prods, regexp_split_to_table(regexp_replace(prods.name_fa, '[()،,+/«»"\-]', ' ', 'g'), '\s+') w, q
    where length(w) >= 2 and app.norm_text(w) like q.q || '%' and w !~ '^[0-9۰-۹.]+$'
    group by w
  ),
  brands as (
    select v.name_fa as term, 'brand'::text as kind, count(*)::int hits
    from prods cross join lateral jsonb_array_elements_text(coalesce(prods.facets->'brand', '[]'::jsonb)) code
    join catalog_facet_values v on v.facet_key = 'brand' and v.value_code = code
    cross join q
    where app.norm_text(v.name_fa) like q.q || '%' or app.norm_text(v.name_fa) like '% ' || q.q || '%'
       or app.norm_text(coalesce(v.name_i18n->>'en', '')) like q.q || '%'
    group by v.name_fa
  ),
  cats as (
    select c as term, 'category'::text as kind, count(*)::int hits
    from prods, unnest(prods.category_path) c, q
    where app.norm_text(c) like q.q || '%' or app.norm_text(c) like '% ' || q.q || '%'
    group by c
  )
  select term, kind, hits from (
    select * from cats union all select * from brands union all select * from words
  ) s
  order by case kind when 'category' then 0 when 'brand' then 1 else 2 end, hits desc, length(term)
  limit least(greatest(coalesce(p_limit, 8), 1), 15);
$$;
grant execute on function public.search_suggest(text, int) to anon, authenticated;

-- ---------------------------------------------------------------- pharmacy search: word starts
create or replace function public.search_pharmacies(
  p_query       text    default null,
  p_city        int     default null,
  p_district    int     default null,
  p_insurer     text    default null,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_radius_km   numeric default null,
  p_product_ids uuid[]  default null,
  p_limit       int     default 50)
returns table (
  pharmacy_id uuid, slug citext, name_fa text, name_i18n jsonb,
  city_id int, district_id int, address text, is_virtual boolean,
  distance_km numeric, offers_count int, items_available int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with params as (
    select case when p_lat is null or p_lng is null then null else ll_to_earth(p_lat, p_lng) end as origin,
           least(coalesce(p_radius_km, (app.setting('allocation.initial_radius_km'))::text::numeric, 2),
                 coalesce((app.setting('allocation.max_radius_km'))::text::numeric, 50)) * 1000 as radius_m,
           app.norm_text(nullif(trim(p_query), '')) as q
  )
  select ph.id, ph.slug, ph.name_fa, ph.name_i18n, ph.city_id, ph.district_id, ph.address, ph.is_virtual,
         case when params.origin is null then null
              else round((earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) / 1000)::numeric, 2) end,
         (select count(*) from app.offers o where o.pharmacy_id = ph.id)::int,
         (select count(*) from app.offers o where o.pharmacy_id = ph.id
            and o.product_id = any(coalesce(p_product_ids, '{}')))::int
  from public.pharmacies ph
  cross join params
  left join public.cities c on c.id = ph.city_id
  left join public.districts d on d.id = ph.district_id
  where ph.status = 'active'
    and (p_city is null or ph.city_id = p_city)
    and (p_district is null or ph.district_id = p_district)
    and (p_insurer is null or exists (select 1 from public.pharmacy_insurers pi
                                      where pi.pharmacy_id = ph.id and pi.insurer_code = p_insurer))
    -- a word of the name, address, city or district must start with the query
    and (params.q is null
         or app.match_rank(app.norm_text(ph.name_fa), params.q) >= 2
         or app.match_rank(app.norm_text(coalesce(ph.address, '')), params.q) >= 2
         or app.match_rank(app.norm_text(coalesce(c.name_fa, '')), params.q) >= 2
         or app.match_rank(app.norm_text(coalesce(d.name_fa, '')), params.q) >= 2
         or app.norm_text(ph.name_i18n::text) like '%' || params.q || '%')
    and (params.origin is null
         or earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) <= params.radius_m)
  order by
    case when p_product_ids is null then 0 else -(select count(*) from app.offers o where o.pharmacy_id = ph.id
            and o.product_id = any(p_product_ids)) end,
    case when params.origin is null then 0
         else earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) end,
    case when params.q is null then 0 else -app.match_rank(app.norm_text(ph.name_fa), params.q) end,
    ph.name_fa
  limit least(greatest(p_limit, 1), 200);
$$;

-- ---------------------------------------------------------------- page builder additions
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('pages.ph_features', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"داروخانه: بلوک نوار ویژگی‌ها","en":"Pharmacy: feature strip block","ar":"الصيدلية: شريط المزايا"}', null, 615)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('pages.ph_features', 'platform', 'true', 'داروخانه: بلوک نوار ویژگی‌ها')
on conflict do nothing;

create or replace function app.page_i18n_ok(p jsonb, p_max int) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p is null or (jsonb_typeof(p) = 'object'
    and greatest(length(coalesce(p->>'fa', '')), length(coalesce(p->>'en', '')), length(coalesce(p->>'ar', ''))) <= p_max);
$$;

create or replace function app.page_validate(p_pharmacy uuid, p_blocks jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  b jsonb; s jsonb; it jsonb; k text;
  v_folder text := coalesce(p_pharmacy::text, 'home');
  v_img text;
  v_platform boolean := p_pharmacy is null or app.has_platform_permission('pages.manage');
  v_max int := app.setting_num('pages.max_blocks', 15)::int;
  v_slides int := app.setting_num('pages.max_slides', 5)::int;
  v_ids uuid[];
  v_tones text[] := array['brand', 'accent', 'sky', 'rose', 'amber', 'mint', 'dark'];
  v_icons text[] := array['pill', 'drop', 'bottle', 'baby', 'device', 'leaf', 'sun', 'heart', 'bone', 'shield', 'map',
                          'pharmacist', 'search', 'truck', 'chat', 'rx', 'tooth', 'sparkle', 'vitamin', 'store'];
begin
  if jsonb_typeof(p_blocks) <> 'array' then return 'block'; end if;
  if jsonb_array_length(p_blocks) > v_max then return 'too_many'; end if;
  v_img := '^' || v_folder || '/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$';

  for b in select * from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(b) <> 'object' or coalesce(b->>'id', '') !~ '^[a-z0-9]{2,20}$' then return 'block'; end if;
    k := b->>'type';
    if k not in ('banner', 'products', 'categories', 'text', 'features') then return 'block_type'; end if;
    if p_pharmacy is not null and not v_platform and not app.setting_bool('pages.ph_' || k, true) then return 'block_type'; end if;

    if (b ? 'title' and jsonb_typeof(b->'title') <> 'object') or (b ? 'body' and jsonb_typeof(b->'body') <> 'object') then
      return 'text';
    end if;
    if length(coalesce(b->'title'->>'fa', '') || coalesce(b->'title'->>'en', '') || coalesce(b->'title'->>'ar', '')) > 300 then return 'text'; end if;
    if greatest(length(coalesce(b->'body'->>'fa', '')), length(coalesce(b->'body'->>'en', '')), length(coalesce(b->'body'->>'ar', ''))) > 1500 then return 'text'; end if;

    if k = 'banner' then
      if jsonb_typeof(b->'slides') <> 'array' or jsonb_array_length(b->'slides') not between 1 and v_slides then return 'block'; end if;
      for s in select * from jsonb_array_elements(b->'slides') loop
        -- an uploaded picture, or a designed text slide (title on a colored background)
        if s->>'image' is not null then
          if s->>'image' !~ v_img then return 'image'; end if;
        elsif coalesce(s->'title'->>'fa', '') = '' then
          return 'block';
        end if;
        if not (app.page_i18n_ok(s->'title', 80) and app.page_i18n_ok(s->'subtitle', 160) and app.page_i18n_ok(s->'cta', 30)
                and app.page_i18n_ok(s->'alt', 120)) then return 'text'; end if;
        if s->>'tone' is not null and not (s->>'tone' = any(v_tones)) then return 'block'; end if;
        if app.page_link_ok(s->'link', p_pharmacy) is distinct from 'ok' then return app.page_link_ok(s->'link', p_pharmacy); end if;
      end loop;

    elsif k = 'products' then
      if coalesce(b->>'source', '') not in ('collection', 'bestselling', 'discount', 'newest', 'manual') then return 'block'; end if;
      if coalesce((b->>'limit')::int, 12) not between 4 and 24 then return 'block'; end if;
      if b->>'source' = 'collection' and not exists (
           select 1 from collections c where c.id::text = b->>'collection' and c.status = 'published'
             and (c.pharmacy_id is null or c.pharmacy_id = p_pharmacy)) then
        return 'collection';
      end if;
      if b->>'source' = 'manual' then
        if jsonb_typeof(b->'products') <> 'array' or jsonb_array_length(b->'products') not between 1 and 24 then return 'block'; end if;
        begin
          select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(b->'products') x;
        exception when others then return 'block';
        end;
        if exists (select 1 from catalog_products p where p.id = any(v_ids) and p.dispensing_class = 'rx') then return 'rx'; end if;
      end if;

    elsif k in ('categories', 'features') then
      if jsonb_typeof(b->'items') <> 'array' or jsonb_array_length(b->'items') not between 1 and 12 then return 'block'; end if;
      for it in select * from jsonb_array_elements(b->'items') loop
        if jsonb_typeof(it->'label') <> 'object' or coalesce(it->'label'->>'fa', '') = '' or not app.page_i18n_ok(it->'label', 60) then return 'text'; end if;
        if it->>'image' is not null and it->>'image' !~ v_img then return 'image'; end if;
        if it->>'icon' is not null and not (it->>'icon' = any(v_icons)) then return 'block'; end if;
        if it->>'tone' is not null and not (it->>'tone' = any(v_tones)) then return 'block'; end if;
        if app.page_link_ok(it->'link', p_pharmacy) is distinct from 'ok' then return app.page_link_ok(it->'link', p_pharmacy); end if;
      end loop;

    elsif k = 'text' then
      if coalesce(b->>'style', 'plain') not in ('plain', 'info', 'notice') then return 'block'; end if;
      if coalesce(b->'body'->>'fa', '') = '' and coalesce(b->'title'->>'fa', '') = '' then return 'text'; end if;
    end if;
  end loop;
  return 'ok';
end $$;

create or replace function public.page_editor(p_pharmacy uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r page_layouts;
begin
  if not app.can_edit_page(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from page_layouts where pharmacy_id is not distinct from p_pharmacy;
  return jsonb_build_object(
    'draft', coalesce(r.draft, '[]'::jsonb), 'published', r.published, 'status', coalesce(r.status, 'draft'),
    'review_note', r.review_note, 'updated_at', r.updated_at, 'published_at', r.published_at,
    'needs_approval', p_pharmacy is not null and app.setting_bool('pages.pharmacy_approval', true)
                      and not app.has_platform_permission('pages.manage'),
    'allowed', case when p_pharmacy is null or app.has_platform_permission('pages.manage')
                 then '["banner","features","categories","products","text"]'::jsonb
                 else (select coalesce(jsonb_agg(t), '[]'::jsonb) from unnest(array['banner', 'features', 'categories', 'products', 'text']) t
                       where app.setting_bool('pages.ph_' || t, true)) end,
    'max_blocks', app.setting_num('pages.max_blocks', 15), 'max_slides', app.setting_num('pages.max_slides', 5));
end $$;

-- ---------------------------------------------------------------- default home page
do $$
declare
  v_sup uuid := (select id from collections where slug = 'supplements' and pharmacy_id is null and status = 'published');
  v_beauty uuid := (select id from collections where slug = 'beauty-care' and pharmacy_id is null and status = 'published');
  v_otc uuid := (select id from collections where slug = 'otc' and pharmacy_id is null and status = 'published');
  v_baby uuid := (select id from collections where slug = 'mother-baby' and pharmacy_id is null and status = 'published');
  v_equip uuid := (select id from collections where slug = 'medical-equipment' and pharmacy_id is null and status = 'published');
  v_blocks jsonb := '[]'::jsonb;
  t text;
begin
  if exists (select 1 from page_layouts where pharmacy_id is null) then return; end if;

  v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'hero', 'type', 'banner', 'height', 'l', 'slides', jsonb_build_array(
    jsonb_build_object('tone', 'brand',
      'title', jsonb_build_object('fa', 'مکمل و ویتامین از داروخانه نزدیک شما', 'en', 'Supplements from a pharmacy near you', 'ar', 'المكملات من صيدلية قريبة منك'),
      'subtitle', jsonb_build_object('fa', 'هر سفارش را مسئول فنی همان داروخانه بررسی می‌کند؛ ارسال امروز یا فردا.', 'en', 'Every order is checked by the pharmacy''s pharmacist; delivered today or tomorrow.', 'ar', 'يراجع الصيدلي كل طلب؛ التوصيل اليوم أو غداً.'),
      'cta', jsonb_build_object('fa', 'مشاهده مکمل‌ها', 'en', 'Browse supplements', 'ar', 'تصفح المكملات'),
      'link', case when v_sup is null then jsonb_build_object('kind', 'path', 'value', '/products') else jsonb_build_object('kind', 'collection', 'value', 'supplements') end),
    jsonb_build_object('tone', 'accent',
      'title', jsonb_build_object('fa', 'دارویاب: داروی کمیاب را پیدا کنید', 'en', 'Finder: locate a scarce medicine', 'ar', 'ابحث عن الدواء النادر'),
      'subtitle', jsonb_build_object('fa', 'ببینید کدام داروخانه اعلام کرده آن را دارد و مستقیم تماس بگیرید.', 'en', 'See which pharmacy says it has it and call them directly.', 'ar', 'اعرف أي صيدلية لديها الدواء واتصل بها مباشرة.'),
      'cta', jsonb_build_object('fa', 'جستجو در دارویاب', 'en', 'Open the finder', 'ar', 'افتح البحث'),
      'link', jsonb_build_object('kind', 'path', 'value', '/finder')),
    jsonb_build_object('tone', 'rose',
      'title', jsonb_build_object('fa', 'آرایشی و بهداشتی اصل', 'en', 'Genuine beauty & care', 'ar', 'منتجات تجميل وعناية أصلية'),
      'subtitle', jsonb_build_object('fa', 'از داروخانه‌های واقعی، با قیمت هر داروخانه کنار هم.', 'en', 'From real pharmacies, with each pharmacy''s price side by side.', 'ar', 'من صيدليات حقيقية مع أسعار كل صيدلية.'),
      'cta', jsonb_build_object('fa', 'مشاهده', 'en', 'Browse', 'ar', 'تصفح'),
      'link', case when v_beauty is null then jsonb_build_object('kind', 'path', 'value', '/products') else jsonb_build_object('kind', 'collection', 'value', 'beauty-care') end)
  )));

  v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'why', 'type', 'features', 'items', jsonb_build_array(
    jsonb_build_object('icon', 'map', 'label', jsonb_build_object('fa', 'خرید از نزدیک‌ترین داروخانه', 'en', 'Nearest pharmacy', 'ar', 'أقرب صيدلية'), 'link', jsonb_build_object('kind', 'path', 'value', '/pharmacies')),
    jsonb_build_object('icon', 'pharmacist', 'label', jsonb_build_object('fa', 'بررسی توسط داروساز', 'en', 'Checked by a pharmacist', 'ar', 'مراجعة الصيدلي')),
    jsonb_build_object('icon', 'search', 'label', jsonb_build_object('fa', 'دارویاب داروهای کمیاب', 'en', 'Scarce-medicine finder', 'ar', 'البحث عن الأدوية النادرة'), 'link', jsonb_build_object('kind', 'path', 'value', '/finder')),
    jsonb_build_object('icon', 'shield', 'label', jsonb_build_object('fa', 'پرداخت امن تا تحویل', 'en', 'Payment held until delivery', 'ar', 'دفع آمن حتى التسليم')),
    jsonb_build_object('icon', 'chat', 'label', jsonb_build_object('fa', 'مشاوره داروساز (به‌زودی)', 'en', 'Pharmacist advice (soon)', 'ar', 'استشارة صيدلي (قريباً)')),
    jsonb_build_object('icon', 'rx', 'label', jsonb_build_object('fa', 'ثبت نسخه (به‌زودی)', 'en', 'Prescriptions (soon)', 'ar', 'الوصفات (قريباً)'))
  )));

  v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'cats', 'type', 'categories',
    'title', jsonb_build_object('fa', 'دسته‌بندی‌ها', 'en', 'Categories', 'ar', 'الفئات'), 'items', (
      select jsonb_agg(x.item order by x.n) from (values
        (1, jsonb_build_object('icon', 'vitamin', 'tone', 'brand', 'label', jsonb_build_object('fa', 'مکمل', 'en', 'Supplements', 'ar', 'مكملات'), 'link', jsonb_build_object('kind', 'collection', 'value', 'supplements'))),
        (2, jsonb_build_object('icon', 'sparkle', 'tone', 'rose', 'label', jsonb_build_object('fa', 'آرایشی و بهداشتی', 'en', 'Beauty & care', 'ar', 'تجميل وعناية'), 'link', jsonb_build_object('kind', 'collection', 'value', 'beauty-care'))),
        (3, jsonb_build_object('icon', 'pill', 'tone', 'mint', 'label', jsonb_build_object('fa', 'داروهای بدون نسخه', 'en', 'OTC medicines', 'ar', 'أدوية بدون وصفة'), 'link', jsonb_build_object('kind', 'collection', 'value', 'otc'))),
        (4, jsonb_build_object('icon', 'baby', 'tone', 'amber', 'label', jsonb_build_object('fa', 'مادر و کودک', 'en', 'Mother & baby', 'ar', 'الأم والطفل'), 'link', jsonb_build_object('kind', 'collection', 'value', 'mother-baby'))),
        (5, jsonb_build_object('icon', 'device', 'tone', 'sky', 'label', jsonb_build_object('fa', 'تجهیزات و ملزومات', 'en', 'Medical equipment', 'ar', 'المستلزمات الطبية'), 'link', jsonb_build_object('kind', 'collection', 'value', 'medical-equipment'))),
        (6, jsonb_build_object('icon', 'search', 'tone', 'accent', 'label', jsonb_build_object('fa', 'دارویابی', 'en', 'Medicine finder', 'ar', 'البحث عن دواء'), 'link', jsonb_build_object('kind', 'path', 'value', '/finder')))
      ) x(n, item)
      where (x.item->'link'->>'kind') = 'path'
         or exists (select 1 from collections c where c.slug = x.item->'link'->>'value' and c.status = 'published' and c.pharmacy_id is null))));

  if v_sup is not null then
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'rowsup', 'type', 'products', 'source', 'collection', 'collection', v_sup, 'limit', 12));
  end if;

  v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'vits', 'type', 'categories',
    'title', jsonb_build_object('fa', 'ویتامین‌ها و مواد معدنی', 'en', 'Vitamins & minerals', 'ar', 'الفيتامينات والمعادن'), 'items', (
      select jsonb_agg(jsonb_build_object('icon', 'vitamin', 'tone', x.tone,
               'label', jsonb_build_object('fa', x.fa, 'en', x.en, 'ar', x.ar),
               'link', jsonb_build_object('kind', 'search', 'value', x.fa)) order by x.n)
      from (values (1, 'ویتامین د', 'Vitamin D', 'فيتامين د', 'amber'), (2, 'ویتامین ث', 'Vitamin C', 'فيتامين ج', 'rose'),
                   (3, 'کلسیم', 'Calcium', 'كالسيوم', 'sky'), (4, 'آهن', 'Iron', 'حديد', 'rose'),
                   (5, 'زینک', 'Zinc', 'زنك', 'mint'), (6, 'امگا', 'Omega', 'أوميغا', 'brand')) x(n, fa, en, ar, tone))));

  v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'rowdeal', 'type', 'products', 'source', 'discount', 'limit', 12,
    'title', jsonb_build_object('fa', 'تخفیف‌دارها', 'en', 'On sale', 'ar', 'تخفيضات')));
  foreach t in array array['beauty-care', 'otc', 'mother-baby', 'medical-equipment'] loop
    if exists (select 1 from collections where slug = t and pharmacy_id is null and status = 'published') then
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'row' || replace(t, '-', ''), 'type', 'products', 'source', 'collection',
        'collection', (select id from collections where slug = t and pharmacy_id is null), 'limit', 12));
    end if;
  end loop;
  v_blocks := v_blocks || jsonb_build_array(jsonb_build_object('id', 'rownew', 'type', 'products', 'source', 'newest', 'limit', 12,
    'title', jsonb_build_object('fa', 'تازه‌ها', 'en', 'New arrivals', 'ar', 'وصل حديثاً')));

  if app.page_validate(null, v_blocks) <> 'ok' then
    raise exception 'default home layout invalid: %', app.page_validate(null, v_blocks);
  end if;
  insert into page_layouts (pharmacy_id, draft, published, status, published_at)
  values (null, v_blocks, v_blocks, 'published', now());
end $$;

-- ---------------------------------------------------------------- reserved addresses
-- /pharmacies is now the pharmacy directory; a pharmacy cannot take that address
create or replace function app.pharmacy_slug_guard() returns trigger
language plpgsql as $$
begin
  if new.slug::text in ('holding', 'holdings', 'product', 'products', 'orders', 'staff', 'shipping', 'complements',
                        'signin-link', 'finder', 'darooyabi', 'pharmacies', 'pharmacy', 'account', 'cart', 'checkout',
                        'login', 'admin', 'pages') then
    raise exception 'slug % is reserved', new.slug using errcode = '23514';
  end if;
  return new;
end $$;
