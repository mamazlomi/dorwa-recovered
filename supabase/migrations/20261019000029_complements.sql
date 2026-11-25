-- Complementary products ("bought together": toothbrush -> toothpaste).
--
-- Rules, not guesses:
--   * category rules (source category -> target category), managed by Dorva;
--     suggested rules arrive as 'proposed' and are shown only once approved;
--   * product pairs for exceptions;
--   * 'never' rules block a pair in both directions (e.g. iron with calcium,
--     which lower each other's absorption); they win over every suggestion.
-- Never on a prescription product, never suggests a prescription product, and
-- OTC only if allowed. Only products sold by a pharmacy that also has the
-- current product are suggested, so a suggestion does not split the order.

set search_path = public, extensions;

insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('complements.enabled', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"پیشنهاد کالای مکمل در صفحه محصول","en":"Complementary products on the product page","ar":"منتجات مكملة في صفحة المنتج"}',
   '{"fa":"قوانین در «مدیریت › مکمل‌ها» تعریف می‌شود. روی داروی نسخه‌ای هرگز نمایش داده نمی‌شود.","en":"Rules live under Admin › Complements. Never shown on prescription products.","ar":"القواعد في الإدارة › المكملات. لا تظهر أبداً على أدوية الوصفة."}', 900),
  ('complements.allow_otc', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"پیشنهاد داروی بدون نسخه به‌عنوان مکمل","en":"Suggest OTC medicines as complements","ar":"اقتراح أدوية دون وصفة كمكملات"}',
   '{"fa":"پیش‌فرض خاموش: پیشنهاد دارو به مشتری در عمل توصیه درمانی است.","en":"Off by default: suggesting a medicine is effectively medical advice.","ar":"متوقف افتراضياً: اقتراح دواء هو عملياً نصيحة علاجية."}', 910),
  ('complements.same_pharmacy_only', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"فقط کالاهای موجود در همان داروخانه","en":"Only products in the same pharmacy","ar":"فقط منتجات في الصيدلية نفسها"}',
   '{"fa":"مکمل فقط از داروخانه‌ای پیشنهاد شود که کالای اصلی را هم دارد تا سفارش دو داروخانه‌ای نشود.","en":"Suggest only what a pharmacy that has the main product also sells, so the order is not split.","ar":"يُقترح فقط ما تبيعه صيدلية لديها المنتج الأساسي حتى لا يُقسم الطلب."}', 920),
  ('complements.max_items', 'catalog', 'number', null, 1, 24, null,
   '{"fa":"حداکثر تعداد کالای مکمل","en":"Maximum complementary products","ar":"أقصى عدد للمنتجات المكملة"}', null, 930)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('complements.enabled',            'platform', 'true',  'پیشنهاد کالای مکمل در صفحه محصول'),
  ('complements.allow_otc',          'platform', 'false', 'پیشنهاد داروی بدون نسخه به‌عنوان مکمل'),
  ('complements.same_pharmacy_only', 'platform', 'true',  'فقط کالاهای موجود در همان داروخانه'),
  ('complements.max_items',          'platform', '8',     'حداکثر تعداد کالای مکمل')
on conflict do nothing;

create table if not exists public.complement_rules (
  id           uuid primary key default gen_random_uuid(),
  source_path  text[] not null check (cardinality(source_path) between 1 and 3),
  target_path  text[] not null check (cardinality(target_path) between 1 and 3),
  kind         text not null default 'suggest' check (kind in ('suggest', 'never')),
  status       text not null default 'active' check (status in ('proposed', 'active', 'off')),
  sort         int not null default 100,
  note         text,
  origin       text not null default 'admin' check (origin in ('admin', 'ai')),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  unique (source_path, target_path, kind)
);
create table if not exists public.product_complements (
  product_id    uuid not null references public.catalog_products(id) on delete cascade,
  complement_id uuid not null references public.catalog_products(id) on delete cascade,
  kind          text not null default 'suggest' check (kind in ('suggest', 'never')),
  sort          int not null default 100,
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (product_id, complement_id),
  check (product_id <> complement_id)
);
alter table public.complement_rules enable row level security;
alter table public.product_complements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'complement_rules' and policyname = 'manage') then
    create policy manage on public.complement_rules for all
      using (app.has_platform_permission('collections.manage'))
      with check (app.has_platform_permission('collections.manage'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'product_complements' and policyname = 'manage') then
    create policy manage on public.product_complements for all
      using (app.has_platform_permission('collections.manage'))
      with check (app.has_platform_permission('collections.manage'));
  end if;
end $$;
grant select, insert, update, delete on public.complement_rules, public.product_complements to authenticated;

-- does a category path start with the rule path?
create or replace function app.path_under(p_path text[], p_rule text[]) returns boolean
language sql immutable as $$ select cardinality(p_rule) > 0 and p_path[1:cardinality(p_rule)] = p_rule $$;

create or replace function public.product_complements_for(
  p_product uuid, p_city int default null, p_lat double precision default null, p_lng double precision default null,
  p_limit int default null)
returns table(kind text, product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, max_discount numeric, pharmacies int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with me as (
    select p.id, p.category_path, p.dispensing_class from catalog_products p
    where p.id = p_product and p.is_active and p.dispensing_class <> 'rx'
      and app.setting_bool('complements.enabled', true)
  ),
  -- pharmacies that sell the main product (near the customer when we know where)
  host as (
    select o.pharmacy_id from app.offers o join pharmacies ph on ph.id = o.pharmacy_id cross join me
    where o.product_id = me.id and (p_city is null or o.city_id = p_city)
      and (p_lat is null or p_lng is null
           or earth_distance(ll_to_earth(ph.lat, ph.lng), ll_to_earth(p_lat, p_lng)) <= app.ph_reach_km(ph.id) * 1000)
  ),
  cand as (
    -- product pairs first, then approved category rules
    select pc.complement_id id, 0 prio, pc.sort from product_complements pc cross join me
    where pc.product_id = me.id and pc.kind = 'suggest'
    union all
    select p.id, 1, r.sort from complement_rules r cross join me
    join catalog_products p on app.path_under(p.category_path, r.target_path)
    where r.kind = 'suggest' and r.status = 'active' and app.path_under(me.category_path, r.source_path)
  ),
  ok as (
    select c.id, min(c.prio) prio, min(c.sort) sort
    from cand c cross join me
    join catalog_products p on p.id = c.id and p.is_active and p.id <> me.id
    join product_listings l on l.product_id = p.id and l.is_published
    where p.dispensing_class in ('general', 'supplement')
          or (p.dispensing_class = 'otc' and app.setting_bool('complements.allow_otc', false))
    group by c.id
  ),
  allowed as (
    select ok.* from ok cross join me join catalog_products p on p.id = ok.id
    where not exists (select 1 from product_complements x
                      where x.kind = 'never' and ((x.product_id = me.id and x.complement_id = p.id)
                                               or (x.product_id = p.id and x.complement_id = me.id)))
      and not exists (select 1 from complement_rules r
                      where r.kind = 'never' and r.status = 'active'
                        and ((app.path_under(me.category_path, r.source_path) and app.path_under(p.category_path, r.target_path))
                          or (app.path_under(p.category_path, r.source_path) and app.path_under(me.category_path, r.target_path))))
  ),
  agg as (
    select o.product_id, min(o.final_price) mn, max(o.final_price) mx, max(o.discount_pct) md,
           count(distinct o.pharmacy_id)::int n
    from app.offers o join allowed a on a.id = o.product_id
    where case when app.setting_bool('complements.same_pharmacy_only', true)
               then o.pharmacy_id in (select pharmacy_id from host)
               else (p_city is null or o.city_id = p_city) end
    group by o.product_id
  )
  select 'complement', p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.image_url,
         g.mn, g.mx, g.md, g.n
  from allowed a join agg g on g.product_id = a.id join catalog_products p on p.id = a.id
  order by a.prio, a.sort, g.n desc, g.md desc nulls last, md5(p.id::text || current_date::text)
  limit least(greatest(coalesce(p_limit, app.setting_num('complements.max_items', 8)::int), 1), 24);
$$;
grant execute on function public.product_complements_for(uuid, int, double precision, double precision, int) to anon, authenticated;

-- Starting rules proposed by Claude (AI); suggestions stay hidden until an
-- admin approves them. Block rules are active: they only ever hide things.
insert into public.complement_rules (source_path, target_path, kind, status, sort, note, origin) values
  ('{آرایشی و بهداشتی,مسواک}', '{آرایشی و بهداشتی,خمیردندان}', 'suggest', 'proposed', 10, 'مسواک ← خمیردندان', 'ai'),
  ('{آرایشی و بهداشتی,خمیردندان}', '{آرایشی و بهداشتی,مسواک}', 'suggest', 'proposed', 10, 'خمیردندان ← مسواک', 'ai'),
  ('{آرایشی و بهداشتی,ضد لک صورت}', '{آرایشی و بهداشتی,ضدآفتاب}', 'suggest', 'proposed', 10, 'محصول ضدلک بدون ضدآفتاب اثر ندارد', 'ai'),
  ('{آرایشی و بهداشتی,ضد لک صورت}', '{آرایشی و بهداشتی,ضد آفتاب انواع پوست}', 'suggest', 'proposed', 11, null, 'ai'),
  ('{آرایشی و بهداشتی,لایه بردار و اسکراب}', '{آرایشی و بهداشتی,ضدآفتاب}', 'suggest', 'proposed', 10, 'بعد از لایه‌برداری پوست حساس به آفتاب است', 'ai'),
  ('{آرایشی و بهداشتی,لایه بردار و اسکراب}', '{آرایشی و بهداشتی,مرطوب کننده انواع پوست}', 'suggest', 'proposed', 20, null, 'ai'),
  ('{آرایشی و بهداشتی,پاک کننده پوست چرب و آکنه ای}', '{آرایشی و بهداشتی,مرطوب کننده پوست چرب}', 'suggest', 'proposed', 10, null, 'ai'),
  ('{آرایشی و بهداشتی,پاک کننده پوست چرب و آکنه ای}', '{آرایشی و بهداشتی,ضد آفتاب پوست چرب}', 'suggest', 'proposed', 20, null, 'ai'),
  ('{آرایشی و بهداشتی,پاک کننده پوست خشک}', '{آرایشی و بهداشتی,مرطوب کننده پوست خشک}', 'suggest', 'proposed', 10, null, 'ai'),
  ('{آرایشی و بهداشتی,ضد ریزش و تقویتی}', '{مکمل,مکمل پوست مو و ناخن}', 'suggest', 'proposed', 10, null, 'ai'),
  ('{آرایشی و بهداشتی,ضد ریزش و تقویتی}', '{مکمل,بیوتین}', 'suggest', 'proposed', 20, null, 'ai'),
  ('{تجهیزات و ملزومات,چسب گاز باند و پد درمانی}', '{آرایشی و بهداشتی,ضد عفونی کننده}', 'suggest', 'proposed', 10, null, 'ai'),
  ('{تجهیزات و ملزومات,ماسک تنفسی}', '{آرایشی و بهداشتی,ضد عفونی کننده}', 'suggest', 'proposed', 10, null, 'ai'),
  ('{تجهیزات و ملزومات,ماسک تنفسی}', '{تجهیزات و ملزومات,دستکش}', 'suggest', 'proposed', 20, null, 'ai'),
  ('{مادر و کودک,پوشک}', '{مادر و کودک,بهداشت}', 'suggest', 'proposed', 10, null, 'ai'),
  ('{مکمل,آهن}', '{مکمل,ویتامین سی}', 'suggest', 'proposed', 10, 'ویتامین C جذب آهن را بیشتر می‌کند — تأیید مسئول فنی', 'ai'),
  ('{مکمل,ویتامین دی}', '{مکمل,کلسیم}', 'suggest', 'proposed', 10, 'تأیید مسئول فنی', 'ai'),
  ('{مکمل,کلسیم}', '{مکمل,ویتامین دی}', 'suggest', 'proposed', 10, 'تأیید مسئول فنی', 'ai'),
  ('{مکمل,آهن}', '{مکمل,کلسیم}', 'never', 'active', 0, 'کلسیم جذب آهن را کم می‌کند', 'ai'),
  ('{مکمل,آهن}', '{مکمل,زینک}', 'never', 'active', 0, 'رقابت در جذب', 'ai'),
  ('{مکمل,آهن}', '{مکمل,منیزیم}', 'never', 'active', 0, 'منیزیم/آنتی‌اسید جذب آهن را کم می‌کند', 'ai')
on conflict (source_path, target_path, kind) do nothing;
