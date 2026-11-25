-- =====================================================================
-- DEV / TEST ONLY: virtual pharmacies in several cities + sample catalog.
-- All names are marked as samples. Never run this on production.
-- =====================================================================

select setseed(0.42);

-- Sample catalog (stands in for the catalog-system sync until its API exists)
insert into public.catalog_products (id, gtin, irc, name_fa, generic_name, dispensing_class,
                                     requires_tech_approval, category_path, catalog_version)
select md5('dorva-sample-product-' || n)::uuid, '62600000' || lpad(n::text, 5, '0'), 'IRC-SAMPLE-' || n,
       name_fa, generic, cls, cls <> 'general', path, 1
from (values
  ( 1, 'پوشک بچه سایز ۴ (نمونه)',          null,            'general',    array['مادر و کودک','پوشک']),
  ( 2, 'شامپو ملایم کودک (نمونه)',         null,            'general',    array['مادر و کودک','بهداشت']),
  ( 3, 'کرم ضدآفتاب SPF50 (نمونه)',        null,            'general',    array['آرایشی و بهداشتی','ضدآفتاب']),
  ( 4, 'مسواک نرم (نمونه)',                null,            'general',    array['بهداشت دهان']),
  ( 5, 'ویتامین D3 هزار واحد (نمونه)',     'cholecalciferol','supplement', array['مکمل','ویتامین']),
  ( 6, 'امگا ۳ (نمونه)',                   'omega-3',       'supplement', array['مکمل','اسید چرب']),
  ( 7, 'مولتی‌ویتامین بزرگسالان (نمونه)',  'multivitamin',  'supplement', array['مکمل','ویتامین']),
  ( 8, 'زینک (نمونه)',                     'zinc',          'supplement', array['مکمل','مواد معدنی']),
  ( 9, 'استامینوفن ۵۰۰ (نمونه)',           'acetaminophen', 'otc',        array['دارو','مسکن']),
  (10, 'ایبوپروفن ۲۰۰ (نمونه)',            'ibuprofen',     'otc',        array['دارو','مسکن']),
  (11, 'قرص مکیدنی گلودرد (نمونه)',        null,            'otc',        array['دارو','سرماخوردگی']),
  (12, 'آموکسی‌سیلین ۵۰۰ (نمونه)',         'amoxicillin',   'rx',         array['دارو','آنتی‌بیوتیک']),
  (13, 'متفورمین ۵۰۰ (نمونه)',             'metformin',     'rx',         array['دارو','دیابت']),
  (14, 'لووتیروکسین ۱۰۰ (نمونه)',          'levothyroxine', 'rx',         array['دارو','تیروئید'])
) as s(n, name_fa, generic, cls, path);

insert into public.product_listings (product_id, is_published, base_price, price_policy)
select p.id, true,
       (array[1850000, 950000, 2400000, 300000, 650000, 1200000, 980000, 420000,
              45000, 60000, 120000, 180000, 90000, 110000])[n],
       case p.dispensing_class when 'general' then 'cap' when 'supplement' then 'cap' else 'fixed' end
from public.catalog_products p
join generate_series(1, 14) n on p.id = md5('dorva-sample-product-' || n)::uuid;

-- Virtual pharmacies: 6 in Tehran, 3 in Isfahan, 2 in Shiraz, 1 in Shahrekord.
insert into public.pharmacies (slug, name_fa, license_no, status, is_virtual, city_id,
                               address, lat, lng, technical_officer_name, approved_at)
select 'test-' || c.slug || '-' || i,
       'داروخانه مجازی ' || c.name_fa || ' ' || translate(i::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
       'VIRTUAL-' || upper(c.slug) || '-' || i,
       'active', true, c.id, 'آدرس آزمایشی',
       c.lat + (random() - 0.5) * 0.06,     -- spread within roughly ±3 km
       c.lng + (random() - 0.5) * 0.07,
       'مسئول فنی آزمایشی', now()
from public.cities c
join (values ('tehran', 6), ('isfahan', 3), ('shiraz', 2), ('shahrekord', 1)) as k(slug, n)
  on k.slug = c.slug
cross join lateral generate_series(1, k.n) i;

-- Every virtual pharmacy accepts the two main insurers
insert into public.pharmacy_insurers (pharmacy_id, insurer_code)
select ph.id, ins from public.pharmacies ph, unnest(array['tamin','salamat']) ins
where ph.is_virtual;

-- Stock: each pharmacy carries roughly two thirds of the catalog,
-- with some items deliberately out of stock to exercise allocation.
insert into public.stock_items (pharmacy_id, product_id, quantity, price, discount_pct, source)
select ph.id, p.id,
       case when random() < 0.15 then 0 else 1 + floor(random() * 20)::int end,
       null,
       case when p.dispensing_class in ('general','supplement') and random() < 0.3 then 5 else 0 end,
       'manual'
from public.pharmacies ph
cross join public.catalog_products p
where ph.is_virtual and random() < 0.67;

-- Translations for sample data
update public.catalog_products p set name_i18n = v.t::jsonb
from (values
  ( 1, '{"en":"Baby diapers size 4 (sample)","ar":"حفاضات أطفال مقاس 4 (عينة)"}'),
  ( 2, '{"en":"Gentle baby shampoo (sample)","ar":"شامبو لطيف للأطفال (عينة)"}'),
  ( 3, '{"en":"Sunscreen SPF50 (sample)","ar":"واقي شمس SPF50 (عينة)"}'),
  ( 4, '{"en":"Soft toothbrush (sample)","ar":"فرشاة أسنان ناعمة (عينة)"}'),
  ( 5, '{"en":"Vitamin D3 1000 IU (sample)","ar":"فيتامين د3 1000 وحدة (عينة)"}'),
  ( 6, '{"en":"Omega-3 (sample)","ar":"أوميغا 3 (عينة)"}'),
  ( 7, '{"en":"Adult multivitamin (sample)","ar":"فيتامينات متعددة للبالغين (عينة)"}'),
  ( 8, '{"en":"Zinc (sample)","ar":"زنك (عينة)"}'),
  ( 9, '{"en":"Acetaminophen 500 (sample)","ar":"أسيتامينوفين 500 (عينة)"}'),
  (10, '{"en":"Ibuprofen 200 (sample)","ar":"إيبوبروفين 200 (عينة)"}'),
  (11, '{"en":"Sore throat lozenges (sample)","ar":"أقراص استحلاب للحلق (عينة)"}'),
  (12, '{"en":"Amoxicillin 500 (sample)","ar":"أموكسيسيلين 500 (عينة)"}'),
  (13, '{"en":"Metformin 500 (sample)","ar":"ميتفورمين 500 (عينة)"}'),
  (14, '{"en":"Levothyroxine 100 (sample)","ar":"ليفوثيروكسين 100 (عينة)"}')
) as v(n, t)
where p.id = md5('dorva-sample-product-' || v.n)::uuid;

update public.pharmacies ph
   set name_i18n = jsonb_build_object(
         'en', 'Virtual pharmacy ' || (c.name_i18n->>'en') || ' ' || split_part(ph.slug::text, '-', 3),
         'ar', 'صيدلية افتراضية ' || (c.name_i18n->>'ar') || ' ' || split_part(ph.slug::text, '-', 3))
  from public.cities c
 where c.id = ph.city_id and ph.is_virtual;

-- Spread Tehran's virtual pharmacies over a few districts
update public.pharmacies ph
   set district_id = d.id
  from public.districts d
 where ph.is_virtual and ph.slug like 'test-tehran-%'
   and d.city_id = ph.city_id
   and d.code = 'd' || (1 + (split_part(ph.slug::text, '-', 3)::int % 3) * 2);

-- Sample catalog facets (codes as the catalog system will send them).
insert into public.catalog_facet_values (facet_key, value_code, name_fa, name_i18n) values
  ('brand',        'SAMPLE-BR-A', 'برند نمونه الف', '{"en":"Sample brand A","ar":"علامة تجريبية أ"}'),
  ('brand',        'SAMPLE-BR-B', 'برند نمونه ب',   '{"en":"Sample brand B","ar":"علامة تجريبية ب"}'),
  ('manufacturer', 'SAMPLE-MF-1', 'تولیدکننده نمونه ۱', '{"en":"Sample maker 1","ar":"مصنّع تجريبي ١"}'),
  ('country',      'IR',          'ایران',          '{"en":"Iran","ar":"إيران"}'),
  ('country',      'DE',          'آلمان',          '{"en":"Germany","ar":"ألمانيا"}');

update public.catalog_products p set facets = f.facets
from (values
  (5, '{"brand":["SAMPLE-BR-A"],"manufacturer":["SAMPLE-MF-1"],"country":["IR"]}'::jsonb),
  (6, '{"brand":["SAMPLE-BR-B"],"manufacturer":["SAMPLE-MF-1"],"country":["DE"]}'::jsonb),
  (7, '{"brand":["SAMPLE-BR-A"],"country":["IR"]}'::jsonb),
  (8, '{"brand":["SAMPLE-BR-B"],"country":["DE"]}'::jsonb)
) as f(n, facets)
where p.id = md5('dorva-sample-product-' || f.n)::uuid;
