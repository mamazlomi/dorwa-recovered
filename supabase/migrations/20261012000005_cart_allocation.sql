-- =====================================================================
-- Dorva — settings registry + cart allocation (all rules no-code)
--
-- 1. setting_definitions: every setting declares its type, allowed
--    options / range, unit and labels in fa/en/ar. A trigger rejects any
--    value that does not match, so the admin settings page can never save
--    a broken rule.
-- 2. pharmacy_daily_load / pharmacy_metrics: inputs for fair rotation
--    and quality scoring (filled by the order module).
-- 3. cart_candidates / plan_cart: the allocation engine.
--
-- Allocation order (each step controlled by settings):
--   a. customer's explicit choice (p_force);
--   b. the pharmacy they shopped from, if it has the whole basket
--      [allocation.prefer_shopped_pharmacy];
--   c. find the nearest pharmacy with the whole basket, widening the
--      radius [initial_radius_km → radius_step_km → max_radius_km];
--      every complete pharmacy within equal_band_km of that distance is
--      treated as equally near, and one is picked by
--      [allocation.tiebreak]: round_robin | score | nearest | daily_rotation;
--   d. otherwise split across up to cart.max_pharmacies; a pharmacy is
--      only added if its part is worth at least cart.split_min_subtotal_rial;
--   e. anything still missing is reported, never silently dropped.
-- Rx products never enter a cart plan: they go through prescriptions.
-- =====================================================================
set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- Settings registry
-- ---------------------------------------------------------------------
create table if not exists public.setting_definitions (
  key          text primary key,
  group_code   text not null,
  value_type   text not null check (value_type in ('number','boolean','enum','weights','text')),
  options      jsonb,            -- enum: [{"value":"x","label":{"fa":..,"en":..,"ar":..}}]
  min_value    numeric,
  max_value    numeric,
  unit         jsonb,            -- {"fa":"کیلومتر","en":"km","ar":"كم"}
  label        jsonb not null,   -- {"fa":..,"en":..,"ar":..}
  help         jsonb,
  scopes       text[] not null default array['platform'],
  sort         int not null default 100
);
alter table public.setting_definitions enable row level security;
create policy read_all on public.setting_definitions for select using (true);

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
    else null;
  end case;
  return new;
end $$;
create trigger settings_validate_trg before insert or update on public.settings
  for each row execute function app.validate_setting();

insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('allocation.initial_radius_km', 'allocation', 'number', null, 0.5, 50, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"شعاع اولیه جستجو","en":"Initial search radius","ar":"نطاق البحث الأولي"}',
   '{"fa":"جستجوی داروخانه کامل از این شعاع شروع می‌شود.","en":"The search for a complete pharmacy starts at this radius.","ar":"يبدأ البحث عن صيدلية مكتملة من هذا النطاق."}', 10),
  ('allocation.radius_step_km', 'allocation', 'number', null, 0.5, 20, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"گام گسترش شعاع","en":"Radius step","ar":"خطوة توسيع النطاق"}',
   '{"fa":"اگر داروخانه کامل پیدا نشد، شعاع به این اندازه بزرگ می‌شود.","en":"If no complete pharmacy is found, the radius grows by this much.","ar":"إذا لم توجد صيدلية مكتملة يتسع النطاق بهذا المقدار."}', 20),
  ('allocation.max_radius_km', 'allocation', 'number', null, 1, 100, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"سقف شعاع جستجو","en":"Maximum search radius","ar":"الحد الأقصى للنطاق"}',
   '{"fa":"داروخانه‌های دورتر از این هرگز پیشنهاد نمی‌شوند.","en":"Pharmacies farther than this are never suggested.","ar":"لا تُقترح الصيدليات الأبعد من ذلك أبدًا."}', 30),
  ('allocation.equal_band_km', 'allocation', 'number', null, 0, 10, '{"fa":"کیلومتر","en":"km","ar":"كم"}',
   '{"fa":"محدوده هم‌فاصله (انصاف)","en":"Equal-distance band (fairness)","ar":"نطاق المسافة المتساوية (الإنصاف)"}',
   '{"fa":"داروخانه‌های کاملی که فاصله‌شان تا این مقدار با نزدیک‌ترین فرق دارد، هم‌فاصله حساب می‌شوند و بینشان با روش انتخاب‌شده تقسیم می‌شود. صفر = همیشه نزدیک‌ترین.","en":"Complete pharmacies within this distance of the nearest one count as equally near and share orders by the chosen method. 0 = always the nearest.","ar":"الصيدليات المكتملة ضمن هذه المسافة من الأقرب تُعد متساوية وتتقاسم الطلبات بالطريقة المختارة. 0 = الأقرب دائمًا."}', 40),
  ('allocation.tiebreak', 'allocation', 'enum',
   '[{"value":"round_robin","label":{"fa":"نوبتی (کمترین سفارش امروز)","en":"Round robin (fewest orders today)","ar":"بالتناوب (أقل طلبات اليوم)"}},
     {"value":"score","label":{"fa":"امتیازی (وزن‌های زیر)","en":"Score (weights below)","ar":"بالنقاط (الأوزان أدناه)"}},
     {"value":"nearest","label":{"fa":"همیشه نزدیک‌ترین","en":"Always the nearest","ar":"الأقرب دائمًا"}},
     {"value":"daily_rotation","label":{"fa":"چرخش روزانه تصادفی","en":"Daily random rotation","ar":"تدوير يومي عشوائي"}}]',
   null, null, null,
   '{"fa":"روش انتخاب بین داروخانه‌های هم‌فاصله","en":"How to pick among equally near pharmacies","ar":"طريقة الاختيار بين الصيدليات المتساوية"}',
   '{"fa":"نوبتی ساده و شفاف است؛ امتیازی پس از جمع شدن داده کیفیت معنا پیدا می‌کند.","en":"Round robin is simple and transparent; score becomes meaningful once quality data exists.","ar":"التناوب بسيط وشفاف؛ النقاط تصبح مفيدة بعد تجمع بيانات الجودة."}', 50),
  ('allocation.weights', 'allocation', 'weights',
   '{"distance":{"fa":"فاصله","en":"Distance","ar":"المسافة"},"quality":{"fa":"کیفیت خدمت","en":"Service quality","ar":"جودة الخدمة"},"price":{"fa":"قیمت","en":"Price","ar":"السعر"},"load":{"fa":"سهم کمتر از سفارش امروز","en":"Lower share of today''s orders","ar":"حصة أقل من طلبات اليوم"}}',
   null, null, null,
   '{"fa":"وزن معیارها در روش امتیازی","en":"Weights for the score method","ar":"أوزان طريقة النقاط"}',
   '{"fa":"هر وزن بین ۰ و ۱. فقط وقتی روش «امتیازی» انتخاب شده استفاده می‌شود.","en":"Each weight 0–1. Used only when the score method is selected.","ar":"كل وزن بين 0 و1. يُستخدم فقط مع طريقة النقاط."}', 60),
  ('allocation.prefer_shopped_pharmacy', 'allocation', 'boolean', null, null, null, null,
   '{"fa":"اولویت با داروخانه‌ای که مشتری از آن خرید کرده","en":"Prefer the pharmacy the customer shopped from","ar":"تفضيل الصيدلية التي تسوّق منها العميل"}',
   '{"fa":"اگر همه اقلام را داشته باشد، سفارش به همان داروخانه می‌رود.","en":"If it has every item, the order goes to it.","ar":"إذا توفرت لديها كل الأصناف يذهب الطلب إليها."}', 70),
  ('cart.max_pharmacies', 'cart', 'number', null, 1, 5, null,
   '{"fa":"حداکثر داروخانه در یک سفارش","en":"Max pharmacies per order","ar":"الحد الأقصى للصيدليات في الطلب"}',
   '{"fa":"۱ یعنی سفارش هرگز تقسیم نمی‌شود.","en":"1 means an order is never split.","ar":"1 يعني عدم تقسيم الطلب أبدًا."}', 110),
  ('cart.split_min_subtotal_rial', 'cart', 'number', null, 0, 1000000000, '{"fa":"ریال","en":"IRR","ar":"ريال"}',
   '{"fa":"حداقل مبلغ سهم داروخانه دوم","en":"Minimum value for an extra pharmacy","ar":"الحد الأدنى لقيمة الصيدلية الإضافية"}',
   '{"fa":"اگر سهم داروخانه اضافه کمتر از این باشد، آن اقلام به‌جای تقسیم سفارش «ناموجود» اعلام می‌شوند.","en":"If an extra pharmacy''s part is worth less, those items are reported unavailable instead of splitting.","ar":"إذا كانت حصة الصيدلية الإضافية أقل، تُعلن الأصناف غير متوفرة بدل التقسيم."}', 120),
  ('cart.split_general_from_tech', 'cart', 'boolean', null, null, null, null,
   '{"fa":"ارسال جدای اقلام عمومی در سبد مختلط","en":"Ship general items separately in mixed carts","ar":"شحن الأصناف العامة منفصلة في السلة المختلطة"}', null, 130),
  ('checkout.location_required', 'cart', 'enum',
   '[{"value":"point","label":{"fa":"موقعیت دقیق یا آدرس روی نقشه","en":"Exact location / map address","ar":"موقع دقيق أو عنوان على الخريطة"}},
     {"value":"city","label":{"fa":"فقط شهر","en":"City only","ar":"المدينة فقط"}},
     {"value":"none","label":{"fa":"اجباری نیست","en":"Not required","ar":"غير مطلوب"}}]',
   null, null, null,
   '{"fa":"موقعیت لازم برای پرداخت","en":"Location required for checkout","ar":"الموقع المطلوب للدفع"}',
   '{"fa":"بدون موقعیت دقیق، انتخاب منصفانه بر اساس فاصله ممکن نیست.","en":"Without an exact location, distance-based fairness is impossible.","ar":"بدون موقع دقيق لا يمكن الإنصاف حسب المسافة."}', 140),
  ('prescription.accept_window_min', 'prescription', 'number', null, 1, 120, '{"fa":"دقیقه","en":"min","ar":"دقيقة"}',
   '{"fa":"مهلت پذیرش نسخه توسط داروخانه","en":"Pharmacy window to accept a prescription","ar":"مهلة قبول الوصفة"}', null, 210),
  ('prescription.allow_partial', 'prescription', 'boolean', null, null, null, null,
   '{"fa":"اجازه پیچیدن بخشی از نسخه","en":"Allow partial dispensing","ar":"السماح بصرف جزئي للوصفة"}', null, 220),
  ('tech_approval.window_min', 'prescription', 'number', null, 1, 240, '{"fa":"دقیقه","en":"min","ar":"دقيقة"}',
   '{"fa":"مهلت پاسخ مسئول فنی","en":"Technical officer response window","ar":"مهلة رد المسؤول الفني"}', null, 230),
  ('tech_approval.on_timeout', 'prescription', 'enum',
   '[{"value":"reassign","label":{"fa":"ارجاع به داروخانه بعدی","en":"Reassign to next pharmacy","ar":"إحالة إلى الصيدلية التالية"}},
     {"value":"cancel","label":{"fa":"لغو و بازپرداخت","en":"Cancel and refund","ar":"إلغاء واسترداد"}}]',
   null, null, null,
   '{"fa":"اقدام پس از پایان مهلت مسئول فنی","en":"Action when the officer does not respond","ar":"الإجراء عند عدم رد المسؤول"}', null, 240),
  ('payment.refund_window_days', 'payment', 'number', null, 0, 30, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"مهلت بازپرداخت","en":"Refund window","ar":"مهلة الاسترداد"}', null, 310),
  ('delivery.code_ttl_hours', 'delivery', 'number', null, 1, 168, '{"fa":"ساعت","en":"hours","ar":"ساعة"}',
   '{"fa":"اعتبار کد تحویل","en":"Delivery code validity","ar":"صلاحية رمز التسليم"}', null, 410),
  ('delivery.require_courier_location', 'delivery', 'boolean', null, null, null, null,
   '{"fa":"ثبت موقعیت پیک هنگام ورود کد","en":"Record courier location on code entry","ar":"تسجيل موقع المندوب عند إدخال الرمز"}', null, 420)
on conflict (key) do update set
  group_code = excluded.group_code, value_type = excluded.value_type, options = excluded.options,
  min_value = excluded.min_value, max_value = excluded.max_value, unit = excluded.unit,
  label = excluded.label, help = excluded.help, sort = excluded.sort;

-- where each rule may be overridden: Dorva-wide rules allow province overrides;
-- a few operational timings may also be tuned per pharmacy.
update public.setting_definitions set scopes = array['platform','province']
 where key not in ('tech_approval.window_min', 'delivery.code_ttl_hours');
update public.setting_definitions set scopes = array['platform','province','pharmacy']
 where key in ('tech_approval.window_min', 'delivery.code_ttl_hours');

-- new / changed platform defaults
update public.settings set value = '{"distance":0.4,"quality":0.3,"price":0.15,"load":0.15}'
 where key = 'allocation.weights' and scope = 'platform' and not (value ? 'load');
insert into public.settings (key, scope, value, description_fa) values
  ('allocation.equal_band_km',           'platform', '1',              'محدوده هم‌فاصله (کیلومتر)'),
  ('allocation.tiebreak',                'platform', '"round_robin"',  'روش انتخاب بین داروخانه‌های هم‌فاصله'),
  ('allocation.prefer_shopped_pharmacy', 'platform', 'true',           'اولویت داروخانه‌ای که مشتری از آن خرید کرده'),
  ('cart.split_min_subtotal_rial',       'platform', '500000',         'حداقل مبلغ سهم داروخانه دوم (ریال)'),
  ('checkout.location_required',         'platform', '"point"',        'موقعیت لازم برای پرداخت')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Fairness inputs (written by the order module; private)
-- ---------------------------------------------------------------------
create table if not exists public.pharmacy_daily_load (
  pharmacy_id uuid not null references public.pharmacies(id),
  day         date not null default current_date,
  orders      int  not null default 0 check (orders >= 0),
  primary key (pharmacy_id, day)
);
create table if not exists public.pharmacy_metrics (
  pharmacy_id      uuid primary key references public.pharmacies(id),
  acceptance_rate  numeric check (acceptance_rate between 0 and 1),
  avg_response_min numeric check (avg_response_min >= 0),
  rating           numeric check (rating between 0 and 5),
  updated_at       timestamptz not null default now()
);
alter table public.pharmacy_daily_load enable row level security;
alter table public.pharmacy_metrics    enable row level security;
create policy platform_read on public.pharmacy_daily_load for select using (app.has_platform_permission('pharmacy.read_all'));
create policy read_own_or_platform on public.pharmacy_metrics for select
  using (app.has_platform_permission('pharmacy.read_all') or app.is_pharmacy_member(pharmacy_id));

-- ---------------------------------------------------------------------
-- Basket helpers
-- ---------------------------------------------------------------------
create or replace function app.cart_lines(p_items jsonb)
returns table (product_id uuid, qty int, dispensing_class text)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select x.product_id, least(greatest(sum(x.qty), 1), 99)::int, p.dispensing_class
  from (
    select (e->>'product_id')::uuid as product_id, coalesce((e->>'qty')::int, 1) as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where e ? 'product_id'
  ) x
  join public.catalog_products p on p.id = x.product_id and p.is_active
  join public.product_listings l on l.product_id = x.product_id and l.is_published
  group by x.product_id, p.dispensing_class;
$$;

-- Pharmacies that can serve at least one non-Rx line of the basket.
create or replace function public.cart_candidates(
  p_items jsonb,
  p_city  int default null,
  p_lat   double precision default null,
  p_lng   double precision default null,
  p_limit int default 20)
returns table (
  pharmacy_id uuid, slug citext, name_fa text, name_i18n jsonb, city_id int, district_id int,
  distance_km numeric, covered int, total int, subtotal numeric)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with lines as (select * from app.cart_lines(p_items) where dispensing_class <> 'rx'),
  params as (
    select case when p_lat is null or p_lng is null then null else ll_to_earth(p_lat, p_lng) end as origin,
           coalesce((app.setting('allocation.max_radius_km'))::text::numeric, 10) * 1000 as max_m
  ),
  ph as (
    select ph.*, case when params.origin is null then null
                      else earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) end as dist_m
    from public.pharmacies ph cross join params
    where ph.status = 'active' and (p_city is null or ph.city_id = p_city)
  ),
  avail as (
    select o.pharmacy_id, l.product_id, l.qty, o.final_price
    from lines l
    join app.offers o on o.product_id = l.product_id
    join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = l.product_id
    where s.quantity >= l.qty
  )
  select ph.id, ph.slug, ph.name_fa, ph.name_i18n, ph.city_id, ph.district_id,
         round((ph.dist_m / 1000)::numeric, 2),
         count(a.product_id)::int,
         (select count(*) from lines)::int,
         sum(a.final_price * a.qty)
  from avail a
  join ph on ph.id = a.pharmacy_id
  where ph.dist_m is null or ph.dist_m <= (select max_m from params)
  group by ph.id, ph.slug, ph.name_fa, ph.name_i18n, ph.city_id, ph.district_id, ph.dist_m
  order by count(a.product_id) desc, coalesce(ph.dist_m, 0), md5(ph.id::text || current_date::text)
  limit least(greatest(p_limit, 1), 100);
$$;

-- ---------------------------------------------------------------------
-- The allocation engine (works on in-memory arrays: no temp tables)
-- ---------------------------------------------------------------------
do $$ begin
  if to_regtype('app.cart_cand') is null then
    create type app.cart_cand as (pharmacy_id uuid, distance_km numeric, covered int, subtotal numeric,
                                  rnk int, load int, quality numeric);
  end if;
  if to_regtype('app.cart_avail') is null then
    create type app.cart_avail as (pharmacy_id uuid, product_id uuid, qty int, final_price numeric,
                                   list_price numeric, discount_pct numeric);
  end if;
end $$;

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
           coalesce((select dl.orders from public.pharmacy_daily_load dl
                      where dl.pharmacy_id = c.pharmacy_id and dl.day = current_date), 0),
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

grant execute on function public.cart_candidates(jsonb, int, double precision, double precision, int) to anon, authenticated;
grant execute on function public.plan_cart(jsonb, int, double precision, double precision, uuid, uuid) to anon, authenticated;
