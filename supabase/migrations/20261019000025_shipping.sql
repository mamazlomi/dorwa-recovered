-- Shipping: delivery fees for local orders and an intercity option when the
-- customer's city cannot serve the basket. Every rule is a setting.
--
-- plan_cart_v2 wraps plan_cart (local allocation, unchanged) and adds:
--   * shipping fee and delivery estimate per pharmacy;
--   * intercity_options: pharmacies in other cities that can send the missing
--     items, with fee and delivery days, offered by shipping.intercity_offer;
--   * when the customer picks one of them (p_force), an intercity plan.

set search_path = public, extensions;

insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('shipping.local_base_fee_rial', 'shipping', 'number', null, 0, 100000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"هزینه پایه ارسال درون‌شهری","en":"Local delivery base fee","ar":"رسوم التوصيل المحلي الأساسية"}',
   '{"fa":"برای هر داروخانه در سفارش جداگانه حساب می‌شود.","en":"Charged once per pharmacy in the order.","ar":"تُحسب لكل صيدلية في الطلب."}', 510),
  ('shipping.local_per_km_rial', 'shipping', 'number', null, 0, 10000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"هزینه هر کیلومتر درون‌شهری","en":"Local fee per km","ar":"الرسوم لكل كم محلياً"}',
   '{"fa":"به هزینه پایه اضافه می‌شود؛ فاصله از داروخانه تا آدرس مشتری.","en":"Added to the base fee; distance from pharmacy to the customer address.","ar":"تضاف إلى الرسوم الأساسية؛ المسافة من الصيدلية إلى العنوان."}', 520),
  ('shipping.local_free_over_rial', 'shipping', 'number', null, 0, 10000000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"ارسال درون‌شهری رایگان از مبلغ","en":"Free local delivery from","ar":"توصيل محلي مجاني ابتداءً من"}',
   '{"fa":"اگر سهم یک داروخانه از این مبلغ بیشتر باشد ارسالش رایگان است. صفر = خاموش.","en":"A pharmacy share above this ships free. 0 = off.","ar":"إذا تجاوزت حصة الصيدلية هذا المبلغ فالتوصيل مجاني. 0 = متوقف."}', 530),
  ('shipping.intercity_enabled', 'shipping', 'boolean', null, null, null, null,
   '{"fa":"ارسال از شهرهای دیگر","en":"Ship from other cities","ar":"الشحن من مدن أخرى"}',
   '{"fa":"اگر شهر مشتری کالا را نداشت، داروخانه‌های شهرهای دیگر با هزینه و زمان بیشتر پیشنهاد شوند.","en":"When the customer''s city lacks an item, offer pharmacies in other cities at a higher fee and time.","ar":"عند عدم توفر الصنف في مدينة العميل تُقترح صيدليات مدن أخرى بتكلفة ووقت أكبر."}', 540),
  ('shipping.intercity_offer', 'shipping', 'enum',
   '[{"value":"when_unavailable","label":{"fa":"فقط وقتی کالا در شهر مشتری نیست","en":"Only when the city lacks items","ar":"فقط عند عدم التوفر في المدينة"}},
     {"value":"always","label":{"fa":"همیشه به‌عنوان گزینه","en":"Always as an option","ar":"دائماً كخيار"}}]',
   null, null, null,
   '{"fa":"چه زمانی ارسال بین‌شهری پیشنهاد شود","en":"When to offer intercity shipping","ar":"متى يُعرض الشحن بين المدن"}', null, 550),
  ('shipping.intercity_pick', 'shipping', 'enum',
   '[{"value":"cheapest_total","label":{"fa":"ارزان‌ترین (کالا + ارسال)","en":"Cheapest (items + shipping)","ar":"الأرخص (الأصناف + الشحن)"}},
     {"value":"nearest","label":{"fa":"نزدیک‌ترین شهر","en":"Nearest city","ar":"أقرب مدينة"}}]',
   null, null, null,
   '{"fa":"ترتیب پیشنهاد داروخانه‌های شهرهای دیگر","en":"Order of other-city pharmacies","ar":"ترتيب صيدليات المدن الأخرى"}', null, 560),
  ('shipping.intercity_base_fee_rial', 'shipping', 'number', null, 0, 100000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"هزینه پایه ارسال بین‌شهری","en":"Intercity base fee","ar":"رسوم الشحن بين المدن الأساسية"}', null, 570),
  ('shipping.intercity_per_km_rial', 'shipping', 'number', null, 0, 1000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"هزینه هر کیلومتر بین‌شهری","en":"Intercity fee per km","ar":"الرسوم لكل كم بين المدن"}', null, 580),
  ('shipping.intercity_free_over_rial', 'shipping', 'number', null, 0, 10000000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"ارسال بین‌شهری رایگان از مبلغ","en":"Free intercity shipping from","ar":"شحن مجاني بين المدن ابتداءً من"}',
   '{"fa":"صفر = خاموش.","en":"0 = off.","ar":"0 = متوقف."}', 590),
  ('shipping.intercity_min_days', 'shipping', 'number', null, 0, 30, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"حداقل روز ارسال بین‌شهری","en":"Intercity delivery, minimum days","ar":"أقل أيام الشحن بين المدن"}', null, 600),
  ('shipping.intercity_max_days', 'shipping', 'number', null, 0, 30, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"حداکثر روز ارسال بین‌شهری","en":"Intercity delivery, maximum days","ar":"أكثر أيام الشحن بين المدن"}', null, 610),
  ('shipping.intercity_max_km', 'shipping', 'number', null, 10, 3000, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"حداکثر فاصله ارسال بین‌شهری","en":"Intercity maximum distance","ar":"أقصى مسافة للشحن بين المدن"}', null, 620),
  ('shipping.intercity_allow_general', 'shipping', 'boolean', null, null, null, null,
   '{"fa":"ارسال بین‌شهری کالای عمومی","en":"Intercity for general products","ar":"الشحن بين المدن للمنتجات العامة"}', null, 630),
  ('shipping.intercity_allow_supplement', 'shipping', 'boolean', null, null, null, null,
   '{"fa":"ارسال بین‌شهری مکمل","en":"Intercity for supplements","ar":"الشحن بين المدن للمكملات"}', null, 640),
  ('shipping.intercity_allow_otc', 'shipping', 'boolean', null, null, null, null,
   '{"fa":"ارسال بین‌شهری داروی بدون نسخه","en":"Intercity for OTC medicines","ar":"الشحن بين المدن للأدوية دون وصفة"}',
   '{"fa":"داروی نسخه‌ای هرگز از سبد ارسال نمی‌شود.","en":"Prescription medicines never ship from the cart.","ar":"أدوية الوصفة لا تُشحن من السلة أبداً."}', 650)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
  ('shipping.local_base_fee_rial',       'platform', '300000',            'هزینه پایه ارسال درون‌شهری'),
  ('shipping.local_per_km_rial',         'platform', '50000',             'هزینه هر کیلومتر درون‌شهری'),
  ('shipping.local_free_over_rial',      'platform', '0',                 'ارسال درون‌شهری رایگان از مبلغ'),
  ('shipping.intercity_enabled',         'platform', 'true',              'ارسال از شهرهای دیگر'),
  ('shipping.intercity_offer',           'platform', '"when_unavailable"','چه زمانی ارسال بین‌شهری پیشنهاد شود'),
  ('shipping.intercity_pick',            'platform', '"cheapest_total"',  'ترتیب پیشنهاد داروخانه‌های شهرهای دیگر'),
  ('shipping.intercity_base_fee_rial',   'platform', '1500000',           'هزینه پایه ارسال بین‌شهری'),
  ('shipping.intercity_per_km_rial',     'platform', '3000',              'هزینه هر کیلومتر بین‌شهری'),
  ('shipping.intercity_free_over_rial',  'platform', '0',                 'ارسال بین‌شهری رایگان از مبلغ'),
  ('shipping.intercity_min_days',        'platform', '2',                 'حداقل روز ارسال بین‌شهری'),
  ('shipping.intercity_max_days',        'platform', '4',                 'حداکثر روز ارسال بین‌شهری'),
  ('shipping.intercity_max_km',          'platform', '1200',              'حداکثر فاصله ارسال بین‌شهری'),
  ('shipping.intercity_allow_general',   'platform', 'true',              'ارسال بین‌شهری کالای عمومی'),
  ('shipping.intercity_allow_supplement','platform', 'true',              'ارسال بین‌شهری مکمل'),
  ('shipping.intercity_allow_otc',       'platform', 'true',              'ارسال بین‌شهری داروی بدون نسخه')
on conflict do nothing;

-- numeric / boolean setting with a default
create or replace function app.setting_num(p_key text, p_default numeric) returns numeric
language sql stable as $$ select coalesce((app.setting(p_key) #>> '{}')::numeric, p_default) $$;
create or replace function app.setting_bool(p_key text, p_default boolean) returns boolean
language sql stable as $$ select coalesce((app.setting(p_key) #>> '{}')::boolean, p_default) $$;

-- may this product class travel between cities?
create or replace function app.intercity_allowed(p_class text) returns boolean
language sql stable as $$
  select case p_class
    when 'general'    then app.setting_bool('shipping.intercity_allow_general', true)
    when 'supplement' then app.setting_bool('shipping.intercity_allow_supplement', true)
    when 'otc'        then app.setting_bool('shipping.intercity_allow_otc', true)
    else false end
$$;

create or replace function app.shipping_fee(p_kind text, p_km numeric, p_subtotal numeric) returns numeric
language sql stable as $$
  select case
    when p_kind = 'intercity' then
      case when app.setting_num('shipping.intercity_free_over_rial', 0) > 0
                and p_subtotal >= app.setting_num('shipping.intercity_free_over_rial', 0) then 0
           else round(app.setting_num('shipping.intercity_base_fee_rial', 1500000)
                      + app.setting_num('shipping.intercity_per_km_rial', 3000) * coalesce(p_km, 0), -4) end
    else
      case when app.setting_num('shipping.local_free_over_rial', 0) > 0
                and p_subtotal >= app.setting_num('shipping.local_free_over_rial', 0) then 0
           else round(app.setting_num('shipping.local_base_fee_rial', 300000)
                      + app.setting_num('shipping.local_per_km_rial', 50000) * coalesce(p_km, 0), -4) end
  end
$$;

-- local delivery estimate, same rule as the product page
create or replace function app.local_eta(p_km numeric) returns text
language sql stable as $$
  select case
    when p_km is not null and p_km <= app.setting_num('delivery.same_day_max_km', 8)
         and extract(hour from now() at time zone 'Asia/Tehran') < app.setting_num('delivery.same_day_cutoff_hour', 17)
      then 'today'
    else 'tomorrow' end
$$;

-- Pharmacies beyond local delivery range (usually other cities) that can send (part of) the basket.
create or replace function public.intercity_candidates(
  p_items jsonb, p_city int default null, p_lat double precision default null, p_lng double precision default null,
  p_limit int default 3)
returns table (pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, city_fa text, city_i18n jsonb,
               distance_km numeric, covered int, total int, subtotal numeric, shipping numeric,
               min_days int, max_days int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with origin as (
    select coalesce(
             case when p_lat is not null and p_lng is not null then ll_to_earth(p_lat, p_lng) end,
             (select ll_to_earth(c.lat, c.lng) from public.cities c where c.id = p_city)) as pt
  ),
  lines as (
    select * from app.cart_lines(p_items) where dispensing_class <> 'rx' and app.intercity_allowed(dispensing_class)
  ),
  ph as (
    select ph.*, round((earth_distance(ll_to_earth(ph.lat, ph.lng), o.pt) / 1000)::numeric, 1) km
    from public.pharmacies ph cross join origin o
    where o.pt is not null and ph.status = 'active'
      and earth_distance(ll_to_earth(ph.lat, ph.lng), o.pt) > app.setting_num('allocation.max_radius_km', 10) * 1000
      and earth_distance(ll_to_earth(ph.lat, ph.lng), o.pt) <= app.setting_num('shipping.intercity_max_km', 1200) * 1000
  ),
  avail as (
    select o.pharmacy_id, l.product_id, l.qty, o.final_price
    from lines l
    join app.offers o on o.product_id = l.product_id
    join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = l.product_id
    where s.quantity >= l.qty
  ),
  agg as (
    select ph.id, ph.slug::text slug, ph.name_fa, ph.name_i18n, c.name_fa city_fa, c.name_i18n city_i18n, ph.km,
           count(a.product_id)::int covered, (select count(*) from app.cart_lines(p_items) where dispensing_class <> 'rx')::int total,
           sum(a.final_price * a.qty) subtotal
    from avail a join ph on ph.id = a.pharmacy_id
    left join public.cities c on c.id = ph.city_id
    group by ph.id, ph.slug, ph.name_fa, ph.name_i18n, c.name_fa, c.name_i18n, ph.km
  )
  select g.id, g.slug, g.name_fa, g.name_i18n, g.city_fa, g.city_i18n, g.km, g.covered, g.total, g.subtotal,
         app.shipping_fee('intercity', g.km, g.subtotal),
         app.setting_num('shipping.intercity_min_days', 2)::int, app.setting_num('shipping.intercity_max_days', 4)::int
  from agg g
  where app.setting_bool('shipping.intercity_enabled', true)
  order by g.covered desc,
           case when coalesce(app.setting('shipping.intercity_pick') #>> '{}', 'cheapest_total') = 'nearest' then g.km
                else g.subtotal + app.shipping_fee('intercity', g.km, g.subtotal) end,
           md5(g.id::text || current_date::text)
  limit least(greatest(coalesce(p_limit, 3), 1), 20);
$$;
grant execute on function public.intercity_candidates(jsonb, int, double precision, double precision, int) to anon, authenticated;

-- The cart plan with shipping. Same arguments as plan_cart.
create or replace function public.plan_cart_v2(
  p_items jsonb, p_city int default null, p_lat double precision default null, p_lng double precision default null,
  p_preferred uuid default null, p_force uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_plan jsonb;
  v_ic   record;
  v_items jsonb;
  v_sub  numeric;
  v_offer text := coalesce(app.setting('shipping.intercity_offer') #>> '{}', 'when_unavailable');
  v_enabled boolean := app.setting_bool('shipping.intercity_enabled', true);
  v_ph   jsonb;
begin
  v_plan := public.plan_cart(p_items, p_city, p_lat, p_lng, p_preferred, p_force);

  -- the customer picked a pharmacy in another city
  if p_force is not null and v_plan->>'strategy' <> 'chosen' and v_enabled then
    select * into v_ic from public.intercity_candidates(p_items, p_city, p_lat, p_lng, 20) c where c.pharmacy_id = p_force;
    if found then
      select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'qty', l.qty, 'unit_price', o.final_price,
               'list_price', o.list_price, 'discount_pct', o.discount_pct, 'line_total', o.final_price * l.qty)
               order by l.product_id),
             sum(o.final_price * l.qty)
        into v_items, v_sub
      from app.cart_lines(p_items) l
      join app.offers o on o.product_id = l.product_id and o.pharmacy_id = p_force
      join public.stock_items s on s.pharmacy_id = p_force and s.product_id = l.product_id
      where l.dispensing_class <> 'rx' and app.intercity_allowed(l.dispensing_class) and s.quantity >= l.qty;

      v_plan := v_plan || jsonb_build_object(
        'strategy', 'intercity',
        'pharmacies', jsonb_build_array(jsonb_build_object(
          'pharmacy_id', v_ic.pharmacy_id, 'slug', v_ic.slug, 'name_fa', v_ic.name_fa, 'name_i18n', v_ic.name_i18n,
          'city_fa', v_ic.city_fa, 'city_i18n', v_ic.city_i18n, 'distance_km', v_ic.distance_km,
          'items', coalesce(v_items, '[]'::jsonb), 'subtotal', coalesce(v_sub, 0))),
        'total', coalesce(v_sub, 0),
        'unavailable', coalesce((
          select jsonb_agg(l.product_id) from app.cart_lines(p_items) l
          where l.dispensing_class <> 'rx'
            and l.product_id not in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) e)),
          '[]'::jsonb));
    end if;
  end if;

  -- shipping fee and delivery estimate per pharmacy
  select coalesce(jsonb_agg(
           p || jsonb_build_object(
             'kind', case when v_plan->>'strategy' = 'intercity' then 'intercity' else 'local' end,
             'shipping', app.shipping_fee(case when v_plan->>'strategy' = 'intercity' then 'intercity' else 'local' end,
                                          (p->>'distance_km')::numeric, (p->>'subtotal')::numeric),
             'eta', case when v_plan->>'strategy' = 'intercity' then 'days' else app.local_eta((p->>'distance_km')::numeric) end,
             'min_days', app.setting_num('shipping.intercity_min_days', 2)::int,
             'max_days', app.setting_num('shipping.intercity_max_days', 4)::int)
           order by ord), '[]'::jsonb)
    into v_ph
  from jsonb_array_elements(v_plan->'pharmacies') with ordinality as x(p, ord);

  v_plan := v_plan || jsonb_build_object(
    'pharmacies', v_ph,
    'shipping_total', coalesce((select sum((e->>'shipping')::numeric) from jsonb_array_elements(v_ph) e), 0),
    'grand_total', (v_plan->>'total')::numeric
                   + coalesce((select sum((e->>'shipping')::numeric) from jsonb_array_elements(v_ph) e), 0));

  -- other cities as an option
  if v_enabled and v_plan->>'strategy' <> 'intercity'
     and (v_offer = 'always' or jsonb_array_length(v_plan->'unavailable') > 0 or jsonb_array_length(v_ph) = 0) then
    v_plan := v_plan || jsonb_build_object('intercity_options', coalesce((
      select jsonb_agg(to_jsonb(c)) from public.intercity_candidates(p_items, p_city, p_lat, p_lng, 3) c
      where not exists (select 1 from jsonb_array_elements(v_ph) e where (e->>'pharmacy_id')::uuid = c.pharmacy_id)), '[]'::jsonb));
  else
    v_plan := v_plan || jsonb_build_object('intercity_options', '[]'::jsonb);
  end if;
  return v_plan;
end $$;
grant execute on function public.plan_cart_v2(jsonb, int, double precision, double precision, uuid, uuid) to anon, authenticated;
