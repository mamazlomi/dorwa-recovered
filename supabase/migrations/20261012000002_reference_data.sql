-- =====================================================================
-- Reference data: permissions, system roles, category policies,
-- default no-code settings, provinces/cities, insurers.
-- Numbers here are starting values, editable from the admin panel.
-- =====================================================================

insert into public.permissions (code, scope, description_fa) values
  -- platform
  ('pharmacy.read_all',     'platform', 'دیدن همه داروخانه‌ها از جمله در انتظار تایید'),
  ('pharmacy.approve',      'platform', 'تایید، رد یا تعلیق داروخانه'),
  ('catalog.publish',       'platform', 'انتشار محصول و تعیین قیمت پایه'),
  ('policy.manage',         'platform', 'تعیین کمیسیون و سقف تخفیف دسته‌ها'),
  ('settings.manage',       'platform', 'تغییر ستینگ‌های پلتفرم'),
  ('platform.roles.manage', 'platform', 'مدیریت نقش‌ها و کاربران پلتفرم'),
  ('inventory.read_all',    'platform', 'دیدن موجودی همه داروخانه‌ها'),
  ('audit.read',            'platform', 'دیدن لاگ‌های حسابرسی'),
  -- pharmacy
  ('pharmacy.update_profile','pharmacy', 'ویرایش مشخصات و ظاهر داروخانه'),
  ('staff.manage',          'pharmacy', 'تعریف نقش و کاربر داروخانه'),
  ('inventory.read',        'pharmacy', 'دیدن موجودی'),
  ('inventory.manage',      'pharmacy', 'ویرایش موجودی، قیمت و تخفیف'),
  ('order.read',            'pharmacy', 'دیدن سفارش‌ها'),
  ('order.tech_approve',    'pharmacy', 'تایید فنی سفارش مکمل و OTC'),
  ('prescription.dispense', 'pharmacy', 'پذیرش و پیچیدن نسخه'),
  ('delivery.confirm',      'pharmacy', 'ثبت کد تحویل'),
  ('pharmacy.settings.manage','pharmacy', 'تغییر ستینگ‌های اختصاصی داروخانه');

insert into public.roles (scope, code, name_fa, is_system) values
  ('platform', 'super_admin',       'مدیر کل دوروا',      true),
  ('platform', 'catalog_operator',  'اپراتور کاتالوگ',    true),
  ('platform', 'support',           'پشتیبانی',           true),
  ('platform', 'finance',           'مالی',               true),
  ('platform', 'content_moderator', 'ناظر محتوا',         true),
  ('pharmacy', 'owner',             'صاحب داروخانه',      true),
  ('pharmacy', 'technical_officer', 'مسئول فنی',          true),
  ('pharmacy', 'dispenser',         'نسخه‌پیچ',           true),
  ('pharmacy', 'inventory_clerk',   'انباردار',           true),
  ('pharmacy', 'courier',           'پیک',                true);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r
join public.permissions p on p.scope = r.scope
where r.is_system and (
     (r.code = 'super_admin')
  or (r.code = 'catalog_operator'  and p.code in ('catalog.publish','pharmacy.read_all'))
  or (r.code = 'support'           and p.code in ('pharmacy.read_all','inventory.read_all'))
  or (r.code = 'finance'           and p.code in ('policy.manage','pharmacy.read_all','audit.read'))
  or (r.code = 'content_moderator' and p.code in ('pharmacy.read_all'))
  or (r.code = 'owner')
  or (r.code = 'technical_officer' and p.code in ('inventory.read','order.read','order.tech_approve','prescription.dispense'))
  or (r.code = 'dispenser'         and p.code in ('inventory.read','order.read','prescription.dispense'))
  or (r.code = 'inventory_clerk'   and p.code in ('inventory.read','inventory.manage'))
  or (r.code = 'courier'           and p.code in ('order.read','delivery.confirm'))
);

-- Commission per user decision: supplements 5%, drugs (OTC, Rx) 2%.
-- General goods: placeholder 5% until decided. Rx discount 0 (regulated price).
insert into public.category_policies (dispensing_class, commission_pct, max_discount_pct) values
  ('general',    5.00, 15.00),
  ('supplement', 5.00, 10.00),
  ('otc',        2.00,  5.00),
  ('rx',         2.00,  0.00);

insert into public.settings (key, scope, value, description_fa) values
  ('allocation.initial_radius_km',     'platform', '2',     'شعاع اولیه جستجوی داروخانه (کیلومتر)'),
  ('allocation.radius_step_km',        'platform', '2',     'گام گسترش شعاع (کیلومتر)'),
  ('allocation.max_radius_km',         'platform', '10',    'سقف شعاع جستجو (کیلومتر)'),
  ('allocation.weights',               'platform', '{"distance":0.5,"basket":0.3,"quality":0.2}', 'وزن معیارهای انصاف'),
  ('cart.max_pharmacies',              'platform', '2',     'حداکثر تعداد داروخانه در یک سفارش'),
  ('cart.split_general_from_tech',     'platform', 'false', 'ارسال جدای اقلام عمومی در سبد مختلط'),
  ('prescription.accept_window_min',   'platform', '10',    'مهلت پذیرش نسخه توسط داروخانه (دقیقه)'),
  ('prescription.allow_partial',       'platform', 'false', 'اجازه پیچیدن بخشی از نسخه'),
  ('tech_approval.window_min',         'platform', '15',    'مهلت پاسخ مسئول فنی (دقیقه)'),
  ('tech_approval.on_timeout',         'platform', '"reassign"', 'اقدام پس از مهلت: reassign یا cancel'),
  ('payment.refund_window_days',       'platform', '3',     'مهلت بازپرداخت (روز)'),
  ('delivery.code_ttl_hours',          'platform', '24',    'اعتبار کد تحویل (ساعت)'),
  ('delivery.require_courier_location','platform', 'true',  'ثبت موقعیت پیک هنگام ورود کد');

insert into public.provinces (code, name_fa, name_en) values
  ('tehran',          'تهران',             'Tehran'),
  ('isfahan',         'اصفهان',            'Isfahan'),
  ('fars',            'فارس',              'Fars'),
  ('chaharmahal',     'چهارمحال و بختیاری', 'Chaharmahal and Bakhtiari'),
  ('razavi_khorasan', 'خراسان رضوی',       'Razavi Khorasan'),
  ('east_azerbaijan', 'آذربایجان شرقی',    'East Azerbaijan');

insert into public.cities (province_id, slug, name_fa, name_en, lat, lng)
select p.id, c.slug, c.name_fa, c.name_en, c.lat, c.lng
from (values
  ('tehran',          'tehran',     'تهران',   'Tehran',     35.6892, 51.3890),
  ('isfahan',         'isfahan',    'اصفهان',  'Isfahan',    32.6546, 51.6680),
  ('fars',            'shiraz',     'شیراز',   'Shiraz',     29.5918, 52.5837),
  ('chaharmahal',     'shahrekord', 'شهرکرد',  'Shahrekord', 32.3256, 50.8644),
  ('razavi_khorasan', 'mashhad',    'مشهد',    'Mashhad',    36.2605, 59.6168),
  ('east_azerbaijan', 'tabriz',     'تبریز',   'Tabriz',     38.0800, 46.2919)
) as c(province_code, slug, name_fa, name_en, lat, lng)
join public.provinces p on p.code = c.province_code;

insert into public.insurers (code, name_fa) values
  ('tamin',    'تامین اجتماعی'),
  ('salamat',  'سلامت ایرانیان'),
  ('armed',    'نیروهای مسلح'),
  ('imam_khomeini', 'کمیته امداد'),
  ('supplementary', 'بیمه تکمیلی');
