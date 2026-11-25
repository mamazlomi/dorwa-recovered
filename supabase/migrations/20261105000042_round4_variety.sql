-- Round 4:
--  * category names in English and Arabic (the catalog stores Persian paths only);
--  * new theme keys: footer divider, back-to-top button, reading progress, installable-app options;
--  * page builder: per-device visibility, section bands and dividers, banner shapes and
--    display modes, display modes and sizes for tiles/features/products, and a "tabs" block.

set search_path = public, extensions;

-- ---------------------------------------------------------------- category names
create table if not exists public.category_names (
  name_fa    text primary key check (length(trim(name_fa)) between 1 and 80),
  name_i18n  jsonb not null default '{}'::jsonb check (jsonb_typeof(name_i18n) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.category_names enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'category_names' and policyname = 'read') then
    create policy read on public.category_names for select using (true);
  end if;
end $$;
grant select on public.category_names to anon, authenticated;

insert into public.category_names (name_fa, name_i18n) values
  ('آرامبخش ضد اضطراب و ضد افسردگی', jsonb_build_object('en', 'Calming, anti-anxiety & mood', 'ar', 'مهدئات ومضادات القلق والاكتئاب')),
  ('آرایشی و بهداشتی', jsonb_build_object('en', 'Beauty & personal care', 'ar', 'التجميل والعناية الشخصية')),
  ('آرژنین', jsonb_build_object('en', 'Arginine', 'ar', 'أرجينين')),
  ('آمینو', jsonb_build_object('en', 'Amino acids', 'ar', 'أحماض أمينية')),
  ('آنتی‌بیوتیک', jsonb_build_object('en', 'Antibiotics', 'ar', 'مضادات حيوية')),
  ('آهن', jsonb_build_object('en', 'Iron', 'ar', 'حديد')),
  ('اسید چرب', jsonb_build_object('en', 'Fatty acids', 'ar', 'أحماض دهنية')),
  ('اشک مصنوعی', jsonb_build_object('en', 'Artificial tears', 'ar', 'دموع اصطناعية')),
  ('افزایش وزن', jsonb_build_object('en', 'Weight gain', 'ar', 'زيادة الوزن')),
  ('ال کارنیتین', jsonb_build_object('en', 'L-carnitine', 'ar', 'إل-كارنيتين')),
  ('الاژیک اسید ( عصاره انار )', jsonb_build_object('en', 'Ellagic acid (pomegranate extract)', 'ar', 'حمض الإيلاجيك (مستخلص الرمان)')),
  ('امگا 3 و روغن ماهی', jsonb_build_object('en', 'Omega-3 & fish oil', 'ar', 'أوميغا 3 وزيت السمك')),
  ('انواع مو', jsonb_build_object('en', 'All hair types', 'ar', 'جميع أنواع الشعر')),
  ('بهبود باروری آقایان', jsonb_build_object('en', 'Men''s fertility', 'ar', 'خصوبة الرجال')),
  ('بهبود باروری بانوان', jsonb_build_object('en', 'Women''s fertility', 'ar', 'خصوبة النساء')),
  ('بهداشت', jsonb_build_object('en', 'Hygiene', 'ar', 'النظافة الشخصية')),
  ('بهداشت بانوان', jsonb_build_object('en', 'Feminine hygiene', 'ar', 'النظافة النسائية')),
  ('بهداشت دهان', jsonb_build_object('en', 'Oral care', 'ar', 'العناية بالفم')),
  ('بیوتین', jsonb_build_object('en', 'Biotin', 'ar', 'بيوتين')),
  ('پاک کننده انواع پوست', jsonb_build_object('en', 'Cleanser, all skin types', 'ar', 'منظف لجميع أنواع البشرة')),
  ('پاک کننده بدن', jsonb_build_object('en', 'Body wash', 'ar', 'غسول الجسم')),
  ('پاک کننده پوست چرب و آکنه ای', jsonb_build_object('en', 'Cleanser, oily & acne-prone skin', 'ar', 'منظف للبشرة الدهنية والمعرضة لحب الشباب')),
  ('پاک کننده پوست خشک', jsonb_build_object('en', 'Cleanser, dry skin', 'ar', 'منظف للبشرة الجافة')),
  ('پد درمانی', jsonb_build_object('en', 'Medical pads', 'ar', 'ضمادات طبية')),
  ('پروبیوتیک', jsonb_build_object('en', 'Probiotics', 'ar', 'بروبيوتيك')),
  ('پروبیوتیک کودکان', jsonb_build_object('en', 'Children''s probiotics', 'ar', 'بروبيوتيك للأطفال')),
  ('پروتئین وی', jsonb_build_object('en', 'Whey protein', 'ar', 'بروتين مصل اللبن')),
  ('پروستات', jsonb_build_object('en', 'Prostate', 'ar', 'البروستاتا')),
  ('پوشک', jsonb_build_object('en', 'Diapers', 'ar', 'حفاضات')),
  ('تجهیزات ضد درد', jsonb_build_object('en', 'Pain relief devices', 'ar', 'أجهزة تخفيف الألم')),
  ('تجهیزات و ملزومات', jsonb_build_object('en', 'Medical equipment & supplies', 'ar', 'المعدات واللوازم الطبية')),
  ('ترازو دیجیتالی', jsonb_build_object('en', 'Digital scales', 'ar', 'موازين رقمية')),
  ('ترمیم زخم و سوختگی', jsonb_build_object('en', 'Wound & burn care', 'ar', 'علاج الجروح والحروق')),
  ('ترمیم کننده زخم، سوختگی و اسکار', jsonb_build_object('en', 'Wound, burn & scar repair', 'ar', 'مرمم للجروح والحروق والندبات')),
  ('تشکچه برقی', jsonb_build_object('en', 'Electric heating pads', 'ar', 'وسادات تدفئة كهربائية')),
  ('تصفیه هوا', jsonb_build_object('en', 'Air purifiers', 'ar', 'منقيات الهواء')),
  ('تقویت تخمدان', jsonb_build_object('en', 'Ovarian support', 'ar', 'دعم المبيض')),
  ('تقویت جنسی آقایان', jsonb_build_object('en', 'Men''s sexual health', 'ar', 'الصحة الجنسية للرجال')),
  ('تقویت جنسی آقایان و بانوان', jsonb_build_object('en', 'Sexual health for men & women', 'ar', 'الصحة الجنسية للرجال والنساء')),
  ('تقویت جنسی بانوان', jsonb_build_object('en', 'Women''s sexual health', 'ar', 'الصحة الجنسية للنساء')),
  ('تقویت حافظه و تمرکز', jsonb_build_object('en', 'Memory & focus', 'ar', 'الذاكرة والتركيز')),
  ('تقویت سیستم ایمنی کودکان', jsonb_build_object('en', 'Children''s immunity', 'ar', 'مناعة الأطفال')),
  ('تقویت و رشد استخوان کودکان', jsonb_build_object('en', 'Children''s bone growth', 'ar', 'نمو عظام الأطفال')),
  ('تقویت و رشد کودکان', jsonb_build_object('en', 'Children''s growth', 'ar', 'نمو الأطفال')),
  ('تنظیم خواب', jsonb_build_object('en', 'Sleep support', 'ar', 'تنظيم النوم')),
  ('تیروئید', jsonb_build_object('en', 'Thyroid', 'ar', 'الغدة الدرقية')),
  ('جلبک ها', jsonb_build_object('en', 'Algae', 'ar', 'الطحالب')),
  ('چربی خون', jsonb_build_object('en', 'Blood lipids', 'ar', 'دهون الدم')),
  ('چسب گاز باند و پد درمانی', jsonb_build_object('en', 'Tapes, gauze, bandages & pads', 'ar', 'لاصقات وشاش وضمادات')),
  ('چشم و بینایی', jsonb_build_object('en', 'Eye & vision', 'ar', 'العين والرؤية')),
  ('حافظه و تمرکز کودکان', jsonb_build_object('en', 'Children''s memory & focus', 'ar', 'ذاكرة وتركيز الأطفال')),
  ('حالت دهنده', jsonb_build_object('en', 'Hair styling', 'ar', 'تصفيف الشعر')),
  ('خمیردندان', jsonb_build_object('en', 'Toothpaste', 'ar', 'معجون الأسنان')),
  ('خواب آور کودکان', jsonb_build_object('en', 'Children''s sleep aids', 'ar', 'مساعدات نوم للأطفال')),
  ('دارو', jsonb_build_object('en', 'Medicines', 'ar', 'الأدوية')),
  ('دستکش', jsonb_build_object('en', 'Gloves', 'ar', 'قفازات')),
  ('دستگاه بخور', jsonb_build_object('en', 'Vaporizers', 'ar', 'أجهزة البخار')),
  ('دستگاه پایش و تست قند خون', jsonb_build_object('en', 'Blood glucose meters & strips', 'ar', 'أجهزة قياس السكر وشرائطها')),
  ('دستگاه گوارش کودکان', jsonb_build_object('en', 'Children''s digestion', 'ar', 'هضم الأطفال')),
  ('دماسنج دهانی', jsonb_build_object('en', 'Oral thermometers', 'ar', 'موازين حرارة فموية')),
  ('دماسنج گوش و پیشانی', jsonb_build_object('en', 'Ear & forehead thermometers', 'ar', 'موازين حرارة للأذن والجبهة')),
  ('دیابت', jsonb_build_object('en', 'Diabetes', 'ar', 'السكري')),
  ('روغن ماهی و امگا 3 کودکان', jsonb_build_object('en', 'Children''s fish oil & omega-3', 'ar', 'زيت السمك وأوميغا 3 للأطفال')),
  ('زینک', jsonb_build_object('en', 'Zinc', 'ar', 'زنك')),
  ('سرماخوردگی', jsonb_build_object('en', 'Colds', 'ar', 'نزلات البرد')),
  ('سرماخوردگی و سرفه', jsonb_build_object('en', 'Cold & cough', 'ar', 'البرد والسعال')),
  ('سلنیوم', jsonb_build_object('en', 'Selenium', 'ar', 'سيلينيوم')),
  ('سنگ کلیه و عفونت ادراری', jsonb_build_object('en', 'Kidney stones & urinary infection', 'ar', 'حصى الكلى والتهاب المسالك البولية')),
  ('سوزن قلم انسولین', jsonb_build_object('en', 'Insulin pen needles', 'ar', 'إبر أقلام الإنسولين')),
  ('سی ال ای', jsonb_build_object('en', 'CLA', 'ar', 'حمض اللينوليك المترافق (CLA)')),
  ('سیستم ایمنی', jsonb_build_object('en', 'Immune system', 'ar', 'جهاز المناعة')),
  ('شیر افزا', jsonb_build_object('en', 'Lactation support', 'ar', 'مدرّات الحليب')),
  ('شیکر', jsonb_build_object('en', 'Shakers', 'ar', 'خلاطات يدوية')),
  ('ضد آفتاب انواع پوست', jsonb_build_object('en', 'Sunscreen, all skin types', 'ar', 'واقي شمس لجميع أنواع البشرة')),
  ('ضد آفتاب پوست چرب', jsonb_build_object('en', 'Sunscreen, oily skin', 'ar', 'واقي شمس للبشرة الدهنية')),
  ('ضد تهوع', jsonb_build_object('en', 'Anti-nausea', 'ar', 'مضادات الغثيان')),
  ('ضد ریزش و تقویتی', jsonb_build_object('en', 'Anti-hair-loss & strengthening', 'ar', 'مضاد للتساقط ومقوٍّ')),
  ('ضد شوره و خارش', jsonb_build_object('en', 'Anti-dandruff & itch', 'ar', 'مضاد للقشرة والحكة')),
  ('ضد عفونی کننده', jsonb_build_object('en', 'Disinfectants', 'ar', 'مطهرات')),
  ('ضد لک صورت', jsonb_build_object('en', 'Anti-dark-spot (face)', 'ar', 'مضاد للتصبغات')),
  ('ضد یبوست', jsonb_build_object('en', 'Laxatives', 'ar', 'ملينات')),
  ('ضدآفتاب', jsonb_build_object('en', 'Sunscreen', 'ar', 'واقي الشمس')),
  ('ضدچروک دور چشم و لب', jsonb_build_object('en', 'Anti-wrinkle, eyes & lips', 'ar', 'مضاد للتجاعيد حول العين والشفاه')),
  ('ضدچروک صورت', jsonb_build_object('en', 'Anti-wrinkle, face', 'ar', 'مضاد لتجاعيد الوجه')),
  ('غضروف ساز', jsonb_build_object('en', 'Joint cartilage support', 'ar', 'دعم الغضاريف')),
  ('فشار سنج مچی دیجیتالی', jsonb_build_object('en', 'Digital wrist blood pressure monitors', 'ar', 'أجهزة ضغط رقمية للمعصم')),
  ('فشارسنج بازویی دیجیتالی', jsonb_build_object('en', 'Digital upper-arm blood pressure monitors', 'ar', 'أجهزة ضغط رقمية للذراع')),
  ('فولیک اسید', jsonb_build_object('en', 'Folic acid', 'ar', 'حمض الفوليك')),
  ('قاعدگی', jsonb_build_object('en', 'Menstruation', 'ar', 'الدورة الشهرية')),
  ('قرص استخوان و مفاصل', jsonb_build_object('en', 'Bone & joint tablets', 'ar', 'أقراص العظام والمفاصل')),
  ('قرص چربی سوز', jsonb_build_object('en', 'Fat burners', 'ar', 'حارقات الدهون')),
  ('کاهش اشتها', jsonb_build_object('en', 'Appetite control', 'ar', 'تقليل الشهية')),
  ('کاهش وزن', jsonb_build_object('en', 'Weight loss', 'ar', 'إنقاص الوزن')),
  ('کبد و صفرا', jsonb_build_object('en', 'Liver & gallbladder', 'ar', 'الكبد والمرارة')),
  ('کراتین', jsonb_build_object('en', 'Creatine', 'ar', 'كرياتين')),
  ('کلسیم', jsonb_build_object('en', 'Calcium', 'ar', 'كالسيوم')),
  ('کم خونی کودکان', jsonb_build_object('en', 'Children''s anaemia', 'ar', 'فقر الدم عند الأطفال')),
  ('کنترل کننده چربی', jsonb_build_object('en', 'Oil control', 'ar', 'التحكم بالدهون')),
  ('کورکومین ( زردچوبه )', jsonb_build_object('en', 'Curcumin (turmeric)', 'ar', 'كركمين (الكركم)')),
  ('کیسه آب گرم', jsonb_build_object('en', 'Hot water bottles', 'ar', 'قِرب الماء الساخن')),
  ('کیوتن', jsonb_build_object('en', 'CoQ10', 'ar', 'كيو 10')),
  ('گلوتامین', jsonb_build_object('en', 'Glutamine', 'ar', 'جلوتامين')),
  ('گینر', jsonb_build_object('en', 'Mass gainers', 'ar', 'مكملات زيادة الكتلة')),
  ('لاک', jsonb_build_object('en', 'Nail polish', 'ar', 'طلاء الأظافر')),
  ('لایه بردار و اسکراب', jsonb_build_object('en', 'Exfoliators & scrubs', 'ar', 'مقشرات')),
  ('مادر و کودک', jsonb_build_object('en', 'Mother & baby', 'ar', 'الأم والطفل')),
  ('ماسک', jsonb_build_object('en', 'Masks', 'ar', 'أقنعة')),
  ('ماسک تنفسی', jsonb_build_object('en', 'Respiratory masks', 'ar', 'كمامات تنفسية')),
  ('محافظ شست و مچ', jsonb_build_object('en', 'Thumb & wrist supports', 'ar', 'دعامات الإبهام والمعصم')),
  ('مخمر', jsonb_build_object('en', 'Yeast', 'ar', 'خميرة')),
  ('مراقبت پوست ضد چروک و جوان کننده', jsonb_build_object('en', 'Anti-ageing skin care', 'ar', 'العناية المضادة للشيخوخة')),
  ('مراقبت مو', jsonb_build_object('en', 'Hair care', 'ar', 'العناية بالشعر')),
  ('مرطوب کننده انواع پوست', jsonb_build_object('en', 'Moisturiser, all skin types', 'ar', 'مرطب لجميع أنواع البشرة')),
  ('مرطوب کننده پوست چرب', jsonb_build_object('en', 'Moisturiser, oily skin', 'ar', 'مرطب للبشرة الدهنية')),
  ('مرطوب کننده پوست خشک', jsonb_build_object('en', 'Moisturiser, dry skin', 'ar', 'مرطب للبشرة الجافة')),
  ('مرطوب کننده پوست معمولی و مختلط', jsonb_build_object('en', 'Moisturiser, normal & combination skin', 'ar', 'مرطب للبشرة العادية والمختلطة')),
  ('مرطوب کننده دست و ناخن', jsonb_build_object('en', 'Hand & nail cream', 'ar', 'مرطب اليدين والأظافر')),
  ('مسکن', jsonb_build_object('en', 'Pain relievers', 'ar', 'مسكنات')),
  ('مسواک', jsonb_build_object('en', 'Toothbrushes', 'ar', 'فرش الأسنان')),
  ('مکمل', jsonb_build_object('en', 'Supplements', 'ar', 'المكملات')),
  ('مکمل پوست مو و ناخن', jsonb_build_object('en', 'Skin, hair & nail supplements', 'ar', 'مكملات البشرة والشعر والأظافر')),
  ('مکمل ترمیم کننده زخم', jsonb_build_object('en', 'Wound healing supplements', 'ar', 'مكملات التئام الجروح')),
  ('منیزیم', jsonb_build_object('en', 'Magnesium', 'ar', 'مغنيسيوم')),
  ('مواد معدنی', jsonb_build_object('en', 'Minerals', 'ar', 'المعادن')),
  ('مولتی ویتامین آقایان', jsonb_build_object('en', 'Men''s multivitamins', 'ar', 'فيتامينات متعددة للرجال')),
  ('مولتی ویتامین بانوان', jsonb_build_object('en', 'Women''s multivitamins', 'ar', 'فيتامينات متعددة للنساء')),
  ('مولتی ویتامین دوران بارداری و شیردهی', jsonb_build_object('en', 'Pregnancy & breastfeeding multivitamins', 'ar', 'فيتامينات الحمل والرضاعة')),
  ('مولتی ویتامین‌ سالمندان', jsonb_build_object('en', 'Seniors'' multivitamins', 'ar', 'فيتامينات متعددة لكبار السن')),
  ('مولتی ویتامین عمومی', jsonb_build_object('en', 'General multivitamins', 'ar', 'فيتامينات متعددة عامة')),
  ('مولتی ویتامین ورزشی', jsonb_build_object('en', 'Sports multivitamins', 'ar', 'فيتامينات متعددة للرياضيين')),
  ('موی چرب', jsonb_build_object('en', 'Oily hair', 'ar', 'الشعر الدهني')),
  ('موی خشک', jsonb_build_object('en', 'Dry hair', 'ar', 'الشعر الجاف')),
  ('موی خشک، رنگ شده و آسیب دیده', jsonb_build_object('en', 'Dry, coloured & damaged hair', 'ar', 'الشعر الجاف والمصبوغ والتالف')),
  ('موی رنگ شده', jsonb_build_object('en', 'Coloured hair', 'ar', 'الشعر المصبوغ')),
  ('نفخ و سوء هاضمه', jsonb_build_object('en', 'Bloating & indigestion', 'ar', 'الانتفاخ وعسر الهضم')),
  ('نگهداری دارو', jsonb_build_object('en', 'Medicine storage', 'ar', 'حفظ الأدوية')),
  ('همورویید و واریس', jsonb_build_object('en', 'Haemorrhoids & varicose veins', 'ar', 'البواسير والدوالي')),
  ('ویتامین', jsonb_build_object('en', 'Vitamins', 'ar', 'الفيتامينات')),
  ('ویتامین ای', jsonb_build_object('en', 'Vitamin E', 'ar', 'فيتامين هـ')),
  ('ویتامین ب12', jsonb_build_object('en', 'Vitamin B12', 'ar', 'فيتامين ب12')),
  ('ویتامین ب2', jsonb_build_object('en', 'Vitamin B2', 'ar', 'فيتامين ب2')),
  ('ویتامین دی', jsonb_build_object('en', 'Vitamin D', 'ar', 'فيتامين د')),
  ('ویتامین سی', jsonb_build_object('en', 'Vitamin C', 'ar', 'فيتامين ج')),
  ('ویتامین‌های ب کمپلکس', jsonb_build_object('en', 'B-complex vitamins', 'ar', 'فيتامينات ب المركبة')),
  ('یائسگی', jsonb_build_object('en', 'Menopause', 'ar', 'سن اليأس'))
on conflict (name_fa) do nothing;

-- every category in the catalog, with its translations (empty when missing)
create or replace function public.category_names_admin() returns table (name_fa text, name_i18n jsonb, products int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select x.n, coalesce(c.name_i18n, '{}'::jsonb), count(*)::int
    from (select unnest(p.category_path) n from catalog_products p) x
    left join category_names c on c.name_fa = x.n
    group by x.n, c.name_i18n order by x.n;
end $$;

create or replace function public.category_name_save(p_fa text, p_en text, p_ar text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(trim(coalesce(p_fa, ''))) not between 1 and 80 then return 'name'; end if;
  if length(coalesce(p_en, '')) > 80 or length(coalesce(p_ar, '')) > 80 then return 'name'; end if;
  insert into category_names (name_fa, name_i18n, updated_at)
  values (trim(p_fa), jsonb_strip_nulls(jsonb_build_object('en', nullif(trim(p_en), ''), 'ar', nullif(trim(p_ar), ''))), now())
  on conflict (name_fa) do update set name_i18n = excluded.name_i18n, updated_at = now();
  return 'ok';
end $$;
grant execute on function public.category_names_admin() to authenticated;
grant execute on function public.category_name_save(text, text, text) to authenticated;

-- ---------------------------------------------------------------- theme keys (same list as src/lib/themeSpec.json)
create or replace function app.theme_spec() returns jsonb
language sql immutable set search_path = pg_catalog as $$ select '{"colors.primary":{"t":"color"},"colors.highlight":{"t":"color"},"colors.accent":{"t":"color"},"colors.background":{"t":"color"},"colors.surface":{"t":"color"},"colors.text":{"t":"color"},"colors.muted":{"t":"color"},"colors.border":{"t":"color"},"colors.sale":{"t":"color"},"mode":{"t":"enum","v":["light","dark"]},"font.body":{"t":"enum","v":["vazirmatn","plex","kufi","readex","naskh"]},"font.heading":{"t":"enum","v":["same","vazirmatn","plex","kufi","readex","lalezar"]},"font.size":{"t":"num","min":13,"max":18},"font.headingWeight":{"t":"enum","v":["600","700","800","900"]},"shape.radius":{"t":"num","min":0,"max":28},"shape.button":{"t":"enum","v":["solid","soft","outline","pill","gradient"]},"shape.shadow":{"t":"enum","v":["none","soft","medium","strong"]},"shape.borders":{"t":"bool"},"layout.width":{"t":"num","min":1024,"max":1600},"layout.density":{"t":"enum","v":["compact","normal","spacious"]},"layout.background":{"t":"enum","v":["plain","soft","dots","gradient"]},"logo.mode":{"t":"enum","v":["image","text","both"]},"logo.height":{"t":"num","min":24,"max":64},"logo.image":{"t":"image"},"logo.text":{"t":"i18n","max":30},"header.style":{"t":"enum","v":["classic","compact","centered","stacked"]},"header.sticky":{"t":"bool"},"header.deliverTo":{"t":"bool"},"header.language":{"t":"bool"},"header.categories":{"t":"bool"},"header.finder":{"t":"bool"},"header.announce.on":{"t":"bool"},"header.announce.text":{"t":"i18n","max":160},"header.announce.link":{"t":"path"},"header.announce.tone":{"t":"enum","v":["brand","accent","dark","amber","rose"]},"footer.style":{"t":"enum","v":["full","simple","minimal"]},"footer.features":{"t":"bool"},"footer.about":{"t":"i18n","max":600},"footer.phone":{"t":"text","max":30},"footer.email":{"t":"text","max":80},"footer.address":{"t":"i18n","max":200},"footer.hours":{"t":"i18n","max":80},"footer.social.instagram":{"t":"url"},"footer.social.telegram":{"t":"url"},"footer.social.whatsapp":{"t":"url"},"footer.social.linkedin":{"t":"url"},"footer.social.aparat":{"t":"url"},"footer.social.eitaa":{"t":"url"},"footer.divider":{"t":"enum","v":["none","wave","curve","bump","zigzag","tilt"]},"card.style":{"t":"enum","v":["classic","minimal","bordered","compact","elevated"]},"card.image":{"t":"enum","v":["square","portrait","landscape"]},"card.titleLines":{"t":"num","min":1,"max":3},"card.category":{"t":"bool"},"card.pharmacies":{"t":"bool"},"card.discount":{"t":"bool"},"card.quickAdd":{"t":"enum","v":["full","icon","none"]},"card.price":{"t":"enum","v":["ink","brand","accent"]},"card.align":{"t":"enum","v":["start","center"]},"grid.mobile":{"t":"num","min":1,"max":2},"grid.desktop":{"t":"num","min":2,"max":5},"grid.view":{"t":"enum","v":["grid","list"]},"grid.toggle":{"t":"bool"},"grid.filters":{"t":"enum","v":["side","top"]},"rows.size":{"t":"enum","v":["s","m","l"]},"rows.arrows":{"t":"bool"},"product.layout":{"t":"enum","v":["side","stacked","compact"]},"product.offers":{"t":"enum","v":["list","cards","table"]},"product.specs":{"t":"enum","v":["after","before"]},"product.stickyBuy":{"t":"bool"},"pharmacy.hero":{"t":"enum","v":["card","cover","minimal"]},"pharmacy.list":{"t":"enum","v":["grid","list"]},"cart.summary":{"t":"enum","v":["side","bottom"]},"extras.toTop":{"t":"enum","v":["none","circle","square","pill","ring","tab"]},"extras.toTopSide":{"t":"enum","v":["end","start","center"]},"extras.toBottom":{"t":"bool"},"extras.progress":{"t":"bool"},"app.bottomNav":{"t":"enum","v":["off","mobile","app"]},"app.quickGrid":{"t":"enum","v":["off","mobile","app"]},"app.install":{"t":"bool"}}'::jsonb $$;

-- ---------------------------------------------------------------- page builder
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('pages.ph_tabs', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"داروخانه: بلوک تب محصولات","en":"Pharmacy: product tabs block","ar":"الصيدلية: كتلة تبويبات المنتجات"}', null, 616)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('pages.ph_tabs', 'platform', 'true', 'داروخانه: بلوک تب محصولات')
on conflict do nothing;

-- a product source (products block or one tab): 'ok' or the problem
create or replace function app.page_source_ok(b jsonb, p_pharmacy uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  if coalesce(b->>'source', '') not in ('collection', 'bestselling', 'discount', 'newest', 'manual') then return 'block'; end if;
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
  return 'ok';
end $$;

create or replace function app.page_validate(p_pharmacy uuid, p_blocks jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  b jsonb; s jsonb; it jsonb; k text; r text;
  v_folder text := coalesce(p_pharmacy::text, 'home');
  v_img text;
  v_platform boolean := p_pharmacy is null or app.has_platform_permission('pages.manage');
  v_max int := app.setting_num('pages.max_blocks', 15)::int;
  v_slides int := app.setting_num('pages.max_slides', 5)::int;
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
    if k not in ('banner', 'products', 'categories', 'text', 'features', 'tabs') then return 'block_type'; end if;
    if p_pharmacy is not null and not v_platform and not app.setting_bool('pages.ph_' || k, true) then return 'block_type'; end if;

    -- options every block may have
    if b ? 'devices' and (jsonb_typeof(b->'devices') <> 'array' or jsonb_array_length(b->'devices') not between 1 and 3
        or exists (select 1 from jsonb_array_elements(b->'devices') d where jsonb_typeof(d) <> 'string' or d #>> '{}' not in ('mobile', 'tablet', 'desktop'))
        or (select count(distinct d) from jsonb_array_elements(b->'devices') d) <> jsonb_array_length(b->'devices')) then
      return 'block';
    end if;
    if coalesce(b->>'band', 'none') not in ('none', 'soft', 'brand', 'accent', 'dark', 'gradient') then return 'block'; end if;
    if coalesce(b->>'divider', 'none') not in ('none', 'wave', 'curve', 'zigzag', 'tilt', 'bump') then return 'block'; end if;

    if (b ? 'title' and jsonb_typeof(b->'title') <> 'object') or (b ? 'body' and jsonb_typeof(b->'body') <> 'object') then
      return 'text';
    end if;
    if length(coalesce(b->'title'->>'fa', '') || coalesce(b->'title'->>'en', '') || coalesce(b->'title'->>'ar', '')) > 300 then return 'text'; end if;
    if greatest(length(coalesce(b->'body'->>'fa', '')), length(coalesce(b->'body'->>'en', '')), length(coalesce(b->'body'->>'ar', ''))) > 1500 then return 'text'; end if;

    if k = 'banner' then
      if coalesce(b->>'height', 'm') not in ('xs', 's', 'm', 'l', 'xl') then return 'block'; end if;
      if coalesce(b->>'shape', 'rounded') not in ('rounded', 'soft', 'square', 'pill', 'arch', 'tilt', 'wave') then return 'block'; end if;
      if coalesce(b->>'display', 'slider') not in ('slider', 'peek', 'grid', 'bento', 'stack') then return 'block'; end if;
      if jsonb_typeof(b->'slides') <> 'array' or jsonb_array_length(b->'slides') not between 1 and v_slides then return 'block'; end if;
      for s in select * from jsonb_array_elements(b->'slides') loop
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
      if coalesce((b->>'limit')::int, 12) not between 4 and 24 then return 'block'; end if;
      if coalesce(b->>'display', 'row') not in ('row', 'grid', 'list', 'bento') then return 'block'; end if;
      r := app.page_source_ok(b, p_pharmacy);
      if r <> 'ok' then return r; end if;

    elsif k = 'tabs' then
      if coalesce((b->>'limit')::int, 12) not between 4 and 24 then return 'block'; end if;
      if coalesce(b->>'display', 'row') not in ('row', 'grid') then return 'block'; end if;
      if coalesce(b->>'look', 'pills') not in ('pills', 'underline', 'boxed') then return 'block'; end if;
      if jsonb_typeof(b->'tabs') <> 'array' or jsonb_array_length(b->'tabs') not between 2 and 5 then return 'block'; end if;
      for it in select * from jsonb_array_elements(b->'tabs') loop
        if jsonb_typeof(it) <> 'object' or jsonb_typeof(it->'title') <> 'object' or coalesce(it->'title'->>'fa', '') = ''
           or not app.page_i18n_ok(it->'title', 40) then return 'text'; end if;
        r := app.page_source_ok(it, p_pharmacy);
        if r <> 'ok' then return r; end if;
      end loop;

    elsif k in ('categories', 'features') then
      if k = 'categories' and coalesce(b->>'display', 'row') not in ('row', 'grid', 'circles', 'cards', 'chips', 'masonry', 'bento') then return 'block'; end if;
      if k = 'features' and coalesce(b->>'display', 'strip') not in ('strip', 'cards', 'icons', 'list') then return 'block'; end if;
      if coalesce(b->>'size', 'm') not in ('s', 'm', 'l') then return 'block'; end if;
      if jsonb_typeof(b->'items') <> 'array' or jsonb_array_length(b->'items') not between 1 and 12 then return 'block'; end if;
      for it in select * from jsonb_array_elements(b->'items') loop
        if jsonb_typeof(it->'label') <> 'object' or coalesce(it->'label'->>'fa', '') = '' or not app.page_i18n_ok(it->'label', 60) then return 'text'; end if;
        if it->>'image' is not null and it->>'image' !~ v_img then return 'image'; end if;
        if it->>'icon' is not null and not (it->>'icon' = any(v_icons)) then return 'block'; end if;
        if it->>'tone' is not null and not (it->>'tone' = any(v_tones)) then return 'block'; end if;
        if app.page_link_ok(it->'link', p_pharmacy) is distinct from 'ok' then return app.page_link_ok(it->'link', p_pharmacy); end if;
      end loop;

    elsif k = 'text' then
      if coalesce(b->>'style', 'plain') not in ('plain', 'info', 'notice', 'quote', 'highlight') then return 'block'; end if;
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
                 then '["banner","features","categories","products","tabs","text"]'::jsonb
                 else (select coalesce(jsonb_agg(t), '[]'::jsonb) from unnest(array['banner', 'features', 'categories', 'products', 'tabs', 'text']) t
                       where app.setting_bool('pages.ph_' || t, true)) end,
    'max_blocks', app.setting_num('pages.max_blocks', 15), 'max_slides', app.setting_num('pages.max_slides', 5));
end $$;
