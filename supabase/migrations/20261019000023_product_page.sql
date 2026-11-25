-- Full product page: pharmacy offers with distance and an estimated delivery
-- day, and two rows of similar products.

set search_path = public, extensions;

-- Delivery day is an estimate until the courier engine exists: "today" when
-- ordered before the cut-off hour and the pharmacy is within the radius.
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('delivery.same_day_cutoff_hour', 'delivery', 'number', null, 0, 24, '{"fa":"ساعت","en":"hour","ar":"ساعة"}',
   '{"fa":"ساعت پایان ارسال همان روز","en":"Same-day cut-off hour","ar":"آخر ساعة للتوصيل في اليوم نفسه"}',
   '{"fa":"سفارش تا این ساعت (به وقت تهران) با برچسب «ارسال امروز» نمایش داده می‌شود؛ بعد از آن «ارسال فردا». تا راه‌اندازی موتور پیک فقط یک تخمین است.","en":"Orders before this hour (Tehran time) show \"delivery today\", later ones \"tomorrow\". An estimate until the courier engine exists.","ar":"الطلبات قبل هذه الساعة (بتوقيت طهران) تظهر «توصيل اليوم» وبعدها «غداً». تقدير حتى تشغيل نظام التوصيل."}', 430),
  ('delivery.same_day_max_km', 'delivery', 'number', null, 0.5, 50, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"حداکثر فاصله برای ارسال همان روز","en":"Same-day maximum distance","ar":"أقصى مسافة للتوصيل في اليوم نفسه"}',
   '{"fa":"داروخانه‌های دورتر از این فاصله «ارسال فردا» نشان می‌دهند.","en":"Pharmacies farther than this show \"delivery tomorrow\".","ar":"الصيدليات الأبعد من هذه المسافة تظهر «توصيل غداً»."}', 440)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('delivery.same_day_cutoff_hour', 'platform', '17', 'ساعت پایان ارسال همان روز'),
  ('delivery.same_day_max_km', 'platform', '8', 'حداکثر فاصله برای ارسال همان روز')
on conflict do nothing;

create or replace function public.product_offers_v2(
  p_product uuid, p_city int default null, p_lat double precision default null, p_lng double precision default null)
returns table(pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, city_fa text, city_i18n jsonb,
              district_fa text, district_i18n jsonb, final_price numeric, list_price numeric,
              discount_pct numeric, max_qty int, distance_km numeric, delivery text)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  with cfg as (
    select coalesce((app.setting('delivery.same_day_cutoff_hour') #>> '{}')::numeric, 17) as cutoff,
           coalesce((app.setting('delivery.same_day_max_km') #>> '{}')::numeric, 8) as max_km,
           coalesce((app.setting('allocation.max_radius_km') #>> '{}')::numeric, 10) as reach_km,
           extract(hour from now() at time zone 'Asia/Tehran') as hr
  ),
  rows as (
    select o.pharmacy_id, ph.slug, ph.name_fa, ph.name_i18n, c.name_fa c_fa, c.name_i18n c_i18n,
           d.name_fa d_fa, d.name_i18n d_i18n, o.final_price, o.list_price, o.discount_pct,
           least(s.quantity, 10)::int qty,
           case when p_lat is null or p_lng is null then null
                else round((earth_distance(ll_to_earth(ph.lat, ph.lng), ll_to_earth(p_lat, p_lng)) / 1000)::numeric, 1) end dist
    from app.offers o
    join pharmacies ph   on ph.id = o.pharmacy_id
    join stock_items s   on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
    left join cities c   on c.id = ph.city_id
    left join districts d on d.id = ph.district_id
    where o.product_id = p_product and (p_city is null or o.city_id = p_city)
  )
  select r.pharmacy_id, r.slug, r.name_fa, r.name_i18n, r.c_fa, r.c_i18n, r.d_fa, r.d_i18n,
         r.final_price, r.list_price, r.discount_pct, r.qty, r.dist,
         -- with a location: today / tomorrow / out of delivery range; without one an
         -- estimate only inside a chosen city (otherwise unknown)
         case when r.dist is not null then
                case when r.dist <= cfg.max_km and cfg.hr < cfg.cutoff then 'today'
                     when r.dist <= cfg.reach_km then 'tomorrow' else 'out' end
              when p_city is not null then
                case when cfg.hr < cfg.cutoff then 'today' else 'tomorrow' end
         end
  from rows r cross join cfg
  -- price first, then distance; equal ones rotate daily (fairness)
  order by r.final_price, r.dist nulls last, md5(r.pharmacy_id::text || current_date::text)
  limit 50;
$$;
grant execute on function public.product_offers_v2(uuid, int, double precision, double precision) to anon, authenticated;

-- Similar products: same active ingredient, then same category (first two levels).
create or replace function public.product_similar(p_product uuid, p_city int default null, p_limit int default 12)
returns table(kind text, product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, max_discount numeric, pharmacies int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with me as (
    select p.id, nullif(app.norm_text(coalesce(p.generic_name, '')), '') g, p.category_path[1:2] cat
    from catalog_products p where p.id = p_product
  ),
  cand as (
    select p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url,
           case when me.g is not null and app.norm_text(coalesce(p.generic_name, '')) = me.g then 'generic'
                when cardinality(me.cat) > 0 and p.category_path[1:2] = me.cat then 'section' end kind
    from catalog_products p
    join product_listings l on l.product_id = p.id and l.is_published
    cross join me
    where p.is_active and p.id <> me.id
  ),
  agg as (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, max(o.discount_pct) md, count(*)::int n
    from app.offers o join cand c on c.id = o.product_id and c.kind is not null
    where p_city is null or o.city_id = p_city
    group by o.product_id
  ),
  ranked as (
    select c.kind, c.id, c.name_fa, c.name_i18n, c.dispensing_class, c.category_path, c.image_url,
           a.mn, a.mx, a.md, coalesce(a.n, 0) n,
           row_number() over (partition by c.kind order by coalesce(a.n, 0) = 0, a.md desc nulls last, c.name_fa) rn
    from cand c left join agg a on a.product_id = c.id
    where c.kind is not null
  )
  select r.kind, r.id, r.name_fa, r.name_i18n, r.dispensing_class, r.category_path, r.image_url,
         r.mn, r.mx, r.md, r.n
  from ranked r
  where r.rn <= least(greatest(coalesce(p_limit, 12), 1), 24)
  order by r.kind = 'section', r.rn;
$$;
grant execute on function public.product_similar(uuid, int, int) to anon, authenticated;
