-- Round 5:
--  * pharmacy review: a rejection needs a reason, every decision is logged,
--    a rejected pharmacy can correct its details and resubmit for review;
--  * a grouped service catalog Dorva edits (clinical, consultation, health checks,
--    mother & child, equipment, access, social, welfare, specialty) - multi-select;
--  * structured technical-officer profiles with a private resume file, kept
--    across saves (officers were recreated on every save), and a Dorva-only
--    "pharmacist bank" built from them (with the officer's consent flag);
--  * my_pharmacy_access: tells a page whether the viewer is the pharmacy's own
--    staff or Dorva staff, so Dorva-only edit buttons are labelled as such.

set search_path = public, extensions;

-- ---------------------------------------------------------------- review history
create table if not exists public.pharmacy_reviews (
  id          bigserial primary key,
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  action      text not null check (action in ('approved', 'rejected', 'resubmitted', 'reopened')),
  note        text check (note is null or length(note) <= 1000),
  actor       uuid default auth.uid(),
  at          timestamptz not null default now()
);
create index if not exists pharmacy_reviews_ph on public.pharmacy_reviews (pharmacy_id, at desc);
alter table public.pharmacy_reviews enable row level security;
revoke all on public.pharmacy_reviews from anon, authenticated;

-- the resubmit path changes status/license from inside a checked function
create or replace function app.guard_pharmacy_update() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if (new.status, new.approved_at, new.approved_by, new.is_virtual, new.license_no, new.custom_domain)
     is distinct from
     (old.status, old.approved_at, old.approved_by, old.is_virtual, old.license_no, old.custom_domain)
     and auth.uid() is not null
     and coalesce(current_setting('app.pharmacy_resubmit', true), '') <> 'on'
     and not app.has_platform_permission('pharmacy.approve') then
    raise exception 'only platform staff can change status, license or domain'
      using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- a rejection must say why (the pharmacy sees it); every decision is logged
create or replace function public.review_pharmacy(p_pharmacy uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
begin
  if not app.has_platform_permission('pharmacy.approve') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_approve is null then raise exception 'decision required' using errcode = '22023'; end if;
  if not p_approve and length(coalesce(v_note, '')) < 5 then
    raise exception 'reason required' using errcode = '22023';
  end if;
  update public.pharmacies
     set status = case when p_approve then 'active' else 'rejected' end,
         approved_at = case when p_approve then now() end,
         approved_by = case when p_approve then auth.uid() end,
         review_note = v_note
   where id = p_pharmacy;
  if not found then raise exception 'pharmacy not found'; end if;
  insert into public.pharmacy_reviews (pharmacy_id, action, note)
  values (p_pharmacy, case when p_approve then 'approved' else 'rejected' end, v_note);
end $$;

-- Dorva sends a rejected (or suspended) pharmacy back to the queue
create or replace function public.pharmacy_reopen(p_pharmacy uuid, p_note text default null) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not app.has_platform_permission('pharmacy.approve') then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.pharmacies set status = 'pending', approved_at = null, approved_by = null
   where id = p_pharmacy and status in ('rejected', 'suspended');
  if not found then return 'status'; end if;
  insert into public.pharmacy_reviews (pharmacy_id, action, note) values (p_pharmacy, 'reopened', nullif(left(trim(coalesce(p_note, '')), 1000), ''));
  return 'ok';
end $$;

-- the pharmacy corrects its details and asks for another review
-- p: {name_fa, license_no, technical_officer_name, technical_officer_license, message}
-- 'ok' | 'status' | 'license' | 'value' | 'message'
create or replace function public.pharmacy_resubmit(p_pharmacy uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_msg text := nullif(left(trim(coalesce(p->>'message', '')), 1000), '');
begin
  if not app.has_pharmacy_permission(p_pharmacy, 'pharmacy.update_profile') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pharmacies where id = p_pharmacy and status = 'rejected') then return 'status'; end if;
  if length(coalesce(v_msg, '')) < 3 then return 'message'; end if;
  perform set_config('app.pharmacy_resubmit', 'on', true);
  begin
    update public.pharmacies set
      name_fa = coalesce(nullif(trim(p->>'name_fa'), ''), name_fa),
      license_no = coalesce(nullif(trim(p->>'license_no'), ''), license_no),
      technical_officer_name = coalesce(nullif(trim(p->>'technical_officer_name'), ''), technical_officer_name),
      technical_officer_license = coalesce(nullif(trim(p->>'technical_officer_license'), ''), technical_officer_license),
      status = 'pending'
    where id = p_pharmacy;
  exception
    when unique_violation then perform set_config('app.pharmacy_resubmit', 'off', true); return 'license';
    when check_violation or string_data_right_truncation then perform set_config('app.pharmacy_resubmit', 'off', true); return 'value';
  end;
  perform set_config('app.pharmacy_resubmit', 'off', true);
  insert into public.pharmacy_reviews (pharmacy_id, action, note) values (p_pharmacy, 'resubmitted', v_msg);
  return 'ok';
end $$;

-- history for the pharmacy's own managers and for Dorva staff
create or replace function public.pharmacy_review_history(p_pharmacy uuid)
returns table (action text, note text, at timestamptz, by_dorva boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.action, r.note, r.at, r.action in ('approved', 'rejected', 'reopened')
  from public.pharmacy_reviews r
  where r.pharmacy_id = p_pharmacy
    and (app.has_pharmacy_permission(p_pharmacy, 'pharmacy.update_profile') or app.has_platform_permission('pharmacy.read_all'))
  order by r.at desc
  limit 50;
$$;

-- ---------------------------------------------------------------- service catalog
create table if not exists public.pharmacy_service_groups (
  code       text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name_fa    text not null check (length(trim(name_fa)) between 2 and 60),
  name_i18n  jsonb not null default '{}'::jsonb,
  sort       int not null default 100,
  active     boolean not null default true
);
create table if not exists public.pharmacy_service_options (
  code       text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  group_code text not null references public.pharmacy_service_groups(code) on update cascade,
  name_fa    text not null check (length(trim(name_fa)) between 2 and 80),
  name_i18n  jsonb not null default '{}'::jsonb,
  sort       int not null default 100,
  active     boolean not null default true
);
alter table public.pharmacy_service_groups enable row level security;
alter table public.pharmacy_service_options enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'pharmacy_service_groups' and policyname = 'read') then
    create policy read on public.pharmacy_service_groups for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'pharmacy_service_options' and policyname = 'read') then
    create policy read on public.pharmacy_service_options for select using (true);
  end if;
end $$;
grant select on public.pharmacy_service_groups, public.pharmacy_service_options to anon, authenticated;

insert into public.pharmacy_service_groups (code, name_fa, name_i18n, sort) values
  ('clinical',  'خدمات درمانی و دارویی', '{"en":"Clinical & dispensing","ar":"الخدمات العلاجية والدوائية"}', 10),
  ('consult',   'مشاوره', '{"en":"Consultation","ar":"الاستشارات"}', 20),
  ('checks',    'پایش و سنجش سلامت', '{"en":"Health checks","ar":"فحوصات صحية"}', 30),
  ('mother',    'مادر و کودک', '{"en":"Mother & child","ar":"الأم والطفل"}', 40),
  ('equipment', 'تجهیزات پزشکی', '{"en":"Medical equipment","ar":"المعدات الطبية"}', 50),
  ('access',    'دسترسی و تحویل', '{"en":"Access & delivery","ar":"الوصول والتوصيل"}', 60),
  ('social',    'اجتماعی و آموزشی', '{"en":"Community & education","ar":"المجتمع والتثقيف"}', 70),
  ('welfare',   'رفاهی و حمایتی', '{"en":"Welfare & support","ar":"الرفاه والدعم"}', 80),
  ('specialty', 'حوزه‌های تخصصی', '{"en":"Specialties","ar":"التخصصات"}', 90)
on conflict (code) do nothing;

insert into public.pharmacy_service_options (code, group_code, name_fa, name_i18n, sort) values
  ('rx_insurance',   'clinical', 'نسخه‌پیچی بیمه‌ای (کاغذی و الکترونیک)', '{"en":"Insured prescriptions (paper & e-prescription)","ar":"صرف الوصفات بالتأمين"}', 10),
  ('special_meds',   'clinical', 'داروهای خاص و بیماران خاص', '{"en":"Special-disease medicines","ar":"أدوية الأمراض الخاصة"}', 20),
  ('scarce_meds',    'clinical', 'تأمین داروی کمیاب', '{"en":"Sourcing scarce medicines","ar":"توفير الأدوية النادرة"}', 30),
  ('cold_chain',     'clinical', 'داروهای یخچالی با زنجیره سرد', '{"en":"Cold-chain medicines","ar":"أدوية السلسلة الباردة"}', 40),
  ('injection',      'clinical', 'تزریقات', '{"en":"Injections","ar":"الحقن"}', 50),
  ('dressing',       'clinical', 'پانسمان و مراقبت زخم', '{"en":"Wound dressing","ar":"تضميد الجروح"}', 60),
  ('compounding_rx', 'clinical', 'ساخت داروهای ترکیبی', '{"en":"Compounded medicines","ar":"الأدوية المركبة"}', 70),
  ('vaccination',    'clinical', 'تأمین و نگهداری واکسن', '{"en":"Vaccines","ar":"اللقاحات"}', 80),
  ('pharmacist_consult', 'consult', 'مشاوره دارویی با داروساز', '{"en":"Pharmacist medicine advice","ar":"استشارة دوائية مع الصيدلي"}', 10),
  ('med_review',     'consult', 'بررسی تداخل و مرور داروهای بیمار', '{"en":"Medication review & interactions","ar":"مراجعة الأدوية والتداخلات"}', 20),
  ('nutrition',      'consult', 'مشاوره تغذیه و مکمل', '{"en":"Nutrition & supplement advice","ar":"استشارة التغذية والمكملات"}', 30),
  ('skin_hair',      'consult', 'مشاوره پوست و مو', '{"en":"Skin & hair advice","ar":"استشارة البشرة والشعر"}', 40),
  ('smoking',        'consult', 'مشاوره ترک سیگار', '{"en":"Stop-smoking support","ar":"المساعدة على الإقلاع عن التدخين"}', 50),
  ('travel',         'consult', 'مشاوره داروهای سفر', '{"en":"Travel health advice","ar":"استشارة صحة السفر"}', 60),
  ('remote_consult', 'consult', 'مشاوره تلفنی و آنلاین', '{"en":"Phone & online advice","ar":"استشارة هاتفية وعبر الإنترنت"}', 70),
  ('chronic_care',   'consult', 'پیگیری بیماران مزمن (دیابت، فشار، آسم)', '{"en":"Chronic-condition follow-up","ar":"متابعة الأمراض المزمنة"}', 80),
  ('bp_check',       'checks', 'اندازه‌گیری فشار خون', '{"en":"Blood pressure check","ar":"قياس ضغط الدم"}', 10),
  ('glucose_check',  'checks', 'اندازه‌گیری قند خون', '{"en":"Blood glucose check","ar":"قياس سكر الدم"}', 20),
  ('bmi_check',      'checks', 'قد، وزن و شاخص توده بدنی', '{"en":"Height, weight & BMI","ar":"الطول والوزن ومؤشر الكتلة"}', 30),
  ('body_analysis',  'checks', 'آنالیز ترکیب بدن', '{"en":"Body composition analysis","ar":"تحليل تكوين الجسم"}', 40),
  ('rapid_tests',    'checks', 'تست‌های سریع (بارداری، کووید و…)', '{"en":"Rapid tests","ar":"الاختبارات السريعة"}', 50),
  ('breastfeeding',  'mother', 'مشاوره شیردهی', '{"en":"Breastfeeding advice","ar":"استشارة الرضاعة"}', 10),
  ('pregnancy',      'mother', 'مشاوره دوران بارداری', '{"en":"Pregnancy advice","ar":"استشارة الحمل"}', 20),
  ('infant_formula', 'mother', 'شیرخشک و غذای کودک', '{"en":"Infant formula & baby food","ar":"حليب الأطفال وأغذيتهم"}', 30),
  ('child_dosing',   'mother', 'راهنمای مصرف دارو در کودکان', '{"en":"Medicine use in children","ar":"إرشاد أدوية الأطفال"}', 40),
  ('equip_sale',     'equipment', 'فروش تجهیزات پزشکی خانگی', '{"en":"Home medical equipment","ar":"المعدات الطبية المنزلية"}', 10),
  ('equip_rent',     'equipment', 'اجاره تجهیزات (ویلچر، اکسیژن‌ساز…)', '{"en":"Equipment rental","ar":"تأجير المعدات"}', 20),
  ('device_training','equipment', 'آموزش کار با دستگاه (قندسنج، فشارسنج، اسپری)', '{"en":"Device training","ar":"التدريب على الأجهزة"}', 30),
  ('ortho_fitting',  'equipment', 'اندازه‌گیری جوراب واریس و ارتوپدی', '{"en":"Compression & orthopaedic fitting","ar":"قياس الجوارب الضاغطة والأجهزة التقويمية"}', 40),
  ('home_delivery',  'access', 'ارسال به منزل', '{"en":"Home delivery","ar":"التوصيل إلى المنزل"}', 10),
  ('express',        'access', 'تحویل فوری', '{"en":"Express delivery","ar":"التوصيل السريع"}', 20),
  ('rx_reserve',     'access', 'آماده‌سازی نسخه پیش از مراجعه', '{"en":"Prescription ready before you arrive","ar":"تجهيز الوصفة قبل الوصول"}', 30),
  ('wheelchair',     'access', 'دسترسی ویلچر', '{"en":"Wheelchair access","ar":"مدخل للكراسي المتحركة"}', 40),
  ('parking',        'access', 'پارکینگ', '{"en":"Parking","ar":"موقف سيارات"}', 50),
  ('card_payment',   'access', 'پرداخت کارتی و آنلاین', '{"en":"Card & online payment","ar":"الدفع بالبطاقة وعبر الإنترنت"}', 60),
  ('health_talks',   'social', 'آموزش سلامت برای محله و مدارس', '{"en":"Community health education","ar":"التثقيف الصحي للمجتمع"}', 10),
  ('drug_takeback',  'social', 'جمع‌آوری داروهای تاریخ‌گذشته', '{"en":"Expired medicine take-back","ar":"جمع الأدوية منتهية الصلاحية"}', 20),
  ('screening_days', 'social', 'روزهای غربالگری رایگان', '{"en":"Free screening days","ar":"أيام فحص مجانية"}', 30),
  ('charity',        'social', 'همکاری با خیریه‌ها و مراکز حمایتی', '{"en":"Charity partnerships","ar":"التعاون مع الجمعيات الخيرية"}', 40),
  ('loyalty',        'welfare', 'باشگاه مشتریان', '{"en":"Loyalty club","ar":"نادي العملاء"}', 10),
  ('elderly_discount','welfare', 'تخفیف سالمندان', '{"en":"Senior discount","ar":"خصم لكبار السن"}', 20),
  ('patient_support','welfare', 'حمایت از بیماران خاص و کم‌برخوردار', '{"en":"Support for patients in need","ar":"دعم المرضى المحتاجين"}', 30),
  ('waiting_area',   'welfare', 'فضای انتظار و نشیمن', '{"en":"Waiting area","ar":"منطقة انتظار"}', 40),
  ('credit_pay',     'welfare', 'پرداخت اعتباری یا اقساطی', '{"en":"Credit / instalment payment","ar":"الدفع بالتقسيط"}', 50),
  ('cosmetics_pro',  'specialty', 'آرایشی و بهداشتی تخصصی', '{"en":"Specialist cosmetics","ar":"مستحضرات تجميل متخصصة"}', 10),
  ('herbal_trad',    'specialty', 'داروهای گیاهی و طب سنتی', '{"en":"Herbal & traditional medicine","ar":"الأعشاب والطب التقليدي"}', 20),
  ('sports_nutr',    'specialty', 'مکمل‌های ورزشی', '{"en":"Sports nutrition","ar":"المكملات الرياضية"}', 30),
  ('veterinary_meds','specialty', 'داروهای دامپزشکی', '{"en":"Veterinary medicines","ar":"الأدوية البيطرية"}', 40),
  ('oncology_meds',  'specialty', 'داروهای سرطان و شیمی‌درمانی', '{"en":"Oncology medicines","ar":"أدوية الأورام"}', 50)
on conflict (code) do nothing;

alter table public.pharmacies add column if not exists service_codes text[] not null default '{}';

-- 'ok' | 'code' | 'name' | 'group'
create or replace function public.service_option_save(p_kind text, p_code text, p_group text, p_name_fa text,
                                                      p_i18n jsonb default '{}', p_sort int default 100, p_active boolean default true) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_code, '') !~ '^[a-z0-9_]{2,40}$' then return 'code'; end if;
  if length(trim(coalesce(p_name_fa, ''))) not between 2 and 80 then return 'name'; end if;
  if p_kind = 'group' then
    if length(trim(p_name_fa)) > 60 then return 'name'; end if;
    insert into pharmacy_service_groups (code, name_fa, name_i18n, sort, active) values (p_code, trim(p_name_fa), coalesce(p_i18n, '{}'), p_sort, p_active)
    on conflict (code) do update set name_fa = excluded.name_fa, name_i18n = excluded.name_i18n, sort = excluded.sort, active = excluded.active;
  elsif p_kind = 'service' then
    if not exists (select 1 from pharmacy_service_groups where code = p_group) then return 'group'; end if;
    insert into pharmacy_service_options (code, group_code, name_fa, name_i18n, sort, active)
    values (p_code, p_group, trim(p_name_fa), coalesce(p_i18n, '{}'), p_sort, p_active)
    on conflict (code) do update set group_code = excluded.group_code, name_fa = excluded.name_fa, name_i18n = excluded.name_i18n,
                                     sort = excluded.sort, active = excluded.active;
  else
    return 'code';
  end if;
  return 'ok';
end $$;

-- ---------------------------------------------------------------- officer profiles
alter table public.pharmacy_officers add column if not exists profile jsonb not null default '{}'::jsonb;
alter table public.pharmacy_officers add column if not exists resume text;
alter table public.pharmacy_officers add column if not exists updated_at timestamptz not null default now();
alter table public.pharmacy_officers drop constraint if exists pharmacy_officers_bio_check;
alter table public.pharmacy_officers add constraint pharmacy_officers_bio_check check (bio is null or length(bio) <= 1500);
alter table public.pharmacy_officers drop constraint if exists pharmacy_officers_profile_check;
alter table public.pharmacy_officers add constraint pharmacy_officers_profile_check
  check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 40000);
alter table public.pharmacy_officers drop constraint if exists pharmacy_officers_resume_check;
alter table public.pharmacy_officers add constraint pharmacy_officers_resume_check
  check (resume is null or resume ~ '^[0-9a-f-]{36}/resume-[a-z0-9]{8,40}\.(pdf|docx)$');

-- private bucket for resumes: only the pharmacy's profile editors and Dorva staff
create or replace function app.officer_doc_ok(p_folder text, p_read boolean default false) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(p_folder, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    else app.can_edit_profile(p_folder::uuid) or (p_read and app.has_platform_permission('pharmacy.read_all')) end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('officer-docs', 'officer-docs', false, 5242880,
          array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
  on conflict (id) do update set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_docs_insert') then
    create policy officer_docs_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'officer-docs' and app.officer_doc_ok((storage.foldername(name))[1]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_docs_select') then
    create policy officer_docs_select on storage.objects for select to authenticated
      using (bucket_id = 'officer-docs' and app.officer_doc_ok((storage.foldername(name))[1], true));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_docs_delete') then
    create policy officer_docs_delete on storage.objects for delete to authenticated
      using (bucket_id = 'officer-docs' and app.officer_doc_ok((storage.foldername(name))[1]));
  end if;
end $$;

-- ---------------------------------------------------------------- profile get / save / public
create or replace function public.pharmacy_profile_get(p_pharmacy uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.pharmacies;
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.pharmacies where id = p_pharmacy;
  return jsonb_build_object(
    'id', r.id, 'slug', r.slug, 'name_fa', r.name_fa, 'name_i18n', r.name_i18n, 'phone', r.phone, 'address', r.address,
    'lat', r.lat, 'lng', r.lng, 'city_id', r.city_id, 'founder_name', r.founder_name, 'about_fa', r.about_fa,
    'about_i18n', r.about_i18n, 'hours', coalesce(r.opening_hours, '{}'), 'kind_codes', to_jsonb(r.kind_codes),
    'services', to_jsonb(r.services), 'service_codes', to_jsonb(r.service_codes),
    'insurers', coalesce((select jsonb_agg(insurer_code) from pharmacy_insurers where pharmacy_id = r.id), '[]'),
    'officers', coalesce((select jsonb_agg(to_jsonb(o) - 'pharmacy_id' - 'updated_at' order by o.sort)
                          from pharmacy_officers o where o.pharmacy_id = r.id), '[]'));
end $$;

-- officers are matched by id, so their profile and resume survive every save
-- 'ok' | 'location' | 'hours' | 'officer' | 'value'
create or replace function public.pharmacy_profile_save(p_pharmacy uuid, p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb; v_hours jsonb := coalesce(p->'hours', '{}'); n int := 0;
  v_img text := '^' || p_pharmacy::text || '/'; v_doc text := '^' || p_pharmacy::text || '/resume-';
  v_oid uuid; v_keep uuid[] := '{}';
begin
  if not app.can_edit_profile(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p->>'lat', '') !~ '^[0-9.]+$' or coalesce(p->>'lng', '') !~ '^[0-9.]+$'
     or (p->>'lat')::double precision not between 24 and 40.5 or (p->>'lng')::double precision not between 44 and 63.5 then
    return 'location';
  end if;
  if jsonb_typeof(v_hours) <> 'object' or not app.shifts_ok(coalesce(v_hours->'shifts', '[]')) then return 'hours'; end if;
  for o in select * from jsonb_array_elements(coalesce(p->'officers', '[]')) loop
    if length(trim(coalesce(o->>'full_name', ''))) < 2 or not app.shifts_ok(coalesce(o->'shifts', '[]'))
       or (coalesce(o->>'photo', '') <> '' and o->>'photo' !~ v_img)
       or (coalesce(o->>'resume', '') <> '' and o->>'resume' !~ v_doc)
       or (o ? 'profile' and jsonb_typeof(o->'profile') not in ('object', 'null')) then
      return 'officer';
    end if;
  end loop;
  begin
    update public.pharmacies set
      phone = nullif(trim(p->>'phone'), ''), address = nullif(trim(p->>'address'), ''),
      lat = (p->>'lat')::double precision, lng = (p->>'lng')::double precision,
      founder_name = nullif(trim(p->>'founder_name'), ''),
      about_fa = nullif(left(trim(coalesce(p->>'about_fa', '')), 3000), ''),
      about_i18n = coalesce(p->'about_i18n', '{}'),
      opening_hours = jsonb_build_object('always', coalesce((v_hours->>'always')::boolean, false), 'shifts', coalesce(v_hours->'shifts', '[]'),
                                         'note', left(coalesce(v_hours->>'note', ''), 120)),
      kind_codes = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'kind_codes', '[]')) x
                             where x in (select code from pharmacy_kinds where active)), '{}'),
      service_codes = coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(p->'service_codes', '[]')) x
                                where x in (select code from pharmacy_service_options where active)), '{}'),
      services = coalesce((select array_agg(left(x, 60)) from (select x from jsonb_array_elements_text(coalesce(p->'services', '[]')) x
                           where length(trim(x)) > 0 limit 20) s), '{}'),
      technical_officer_name = coalesce((select o2->>'full_name' from jsonb_array_elements(coalesce(p->'officers', '[]')) o2 limit 1), technical_officer_name),
      technical_officer_license = coalesce((select nullif(o2->>'council_no', '') from jsonb_array_elements(coalesce(p->'officers', '[]')) o2 limit 1), technical_officer_license),
      updated_at = now()
    where id = p_pharmacy;
    delete from public.pharmacy_insurers where pharmacy_id = p_pharmacy;
    insert into public.pharmacy_insurers (pharmacy_id, insurer_code)
    select p_pharmacy, x from jsonb_array_elements_text(coalesce(p->'insurers', '[]')) x
    where x in (select code from insurers) on conflict do nothing;
    for o in select * from jsonb_array_elements(coalesce(p->'officers', '[]')) loop
      n := n + 1;
      v_oid := case when coalesce(o->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (o->>'id')::uuid end;
      if v_oid is not null and exists (select 1 from public.pharmacy_officers where id = v_oid and pharmacy_id <> p_pharmacy) then
        v_oid := null;
      end if;
      insert into public.pharmacy_officers (id, pharmacy_id, full_name, council_no, photo, bio, shifts, sort, profile, resume, updated_at)
      values (coalesce(v_oid, gen_random_uuid()), p_pharmacy, trim(o->>'full_name'), nullif(trim(o->>'council_no'), ''), nullif(o->>'photo', ''),
              nullif(trim(o->>'bio'), ''), coalesce(o->'shifts', '[]'), n,
              case when jsonb_typeof(o->'profile') = 'object' then o->'profile' else '{}'::jsonb end,
              nullif(o->>'resume', ''), now())
      on conflict (id) do update set full_name = excluded.full_name, council_no = excluded.council_no, photo = excluded.photo,
        bio = excluded.bio, shifts = excluded.shifts, sort = excluded.sort, profile = excluded.profile, resume = excluded.resume,
        updated_at = now()
      returning id into v_oid;
      v_keep := v_keep || v_oid;
    end loop;
    delete from public.pharmacy_officers where pharmacy_id = p_pharmacy and not (id = any(v_keep));
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range or string_data_right_truncation then
    return 'value';
  end;
  return 'ok';
end $$;

-- the public "about" tab: chosen services by group, officers' public credentials (never the resume)
create or replace function public.pharmacy_about_public(p_pharmacy uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'founder_name', r.founder_name, 'about_fa', r.about_fa, 'about_i18n', r.about_i18n, 'hours', coalesce(r.opening_hours, '{}'),
    'phone', r.phone, 'address', r.address, 'lat', r.lat, 'lng', r.lng, 'services', to_jsonb(r.services),
    'service_groups', coalesce((
      select jsonb_agg(jsonb_build_object('code', g.code, 'name_fa', g.name_fa, 'name_i18n', g.name_i18n,
               'items', (select jsonb_agg(jsonb_build_object('code', s.code, 'name_fa', s.name_fa, 'name_i18n', s.name_i18n) order by s.sort)
                         from pharmacy_service_options s where s.group_code = g.code and s.active and s.code = any(r.service_codes)))
             order by g.sort)
      from pharmacy_service_groups g
      where g.active and exists (select 1 from pharmacy_service_options s where s.group_code = g.code and s.active and s.code = any(r.service_codes))), '[]'),
    'kinds', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name_fa', k.name_fa, 'name_i18n', k.name_i18n) order by k.sort)
                       from pharmacy_kinds k where k.code = any(r.kind_codes) and k.active), '[]'),
    'officers', coalesce((select jsonb_agg(jsonb_build_object('full_name', o.full_name, 'council_no', o.council_no, 'photo', o.photo,
                                                                'bio', o.bio, 'shifts', o.shifts,
                                                                'degree', o.profile->>'degree', 'university', o.profile->>'university',
                                                                'specialty', o.profile->>'specialty', 'years', o.profile->>'years_total',
                                                                'languages', o.profile->>'languages') order by o.sort)
                          from pharmacy_officers o where o.pharmacy_id = r.id), '[]'))
  from public.pharmacies r where r.id = p_pharmacy and (r.status = 'active' or app.can_edit_profile(r.id));
$$;

-- ---------------------------------------------------------------- pharmacist bank (Dorva only)
create or replace function public.pharmacist_bank(p_q text default null, p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not app.has_platform_permission('pharmacy.read_all') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from pharmacy_officers),
    'consented', (select count(*) from pharmacy_officers where coalesce((profile->>'consent')::boolean, false)),
    'rows', coalesce((select jsonb_agg(x order by x->>'full_name') from (
      select jsonb_build_object('id', o.id, 'full_name', o.full_name, 'council_no', o.council_no, 'resume', o.resume,
               'profile', o.profile - 'resume_text', 'has_resume_text', length(coalesce(o.profile->>'resume_text', '')) > 0,
               'pharmacy', jsonb_build_object('id', ph.id, 'slug', ph.slug, 'name_fa', ph.name_fa, 'status', ph.status),
               'city', c.name_fa, 'updated_at', o.updated_at) x
      from pharmacy_officers o
      join pharmacies ph on ph.id = o.pharmacy_id
      left join cities c on c.id = ph.city_id
      where (p_all or coalesce((o.profile->>'consent')::boolean, false))
        and (v_q is null or o.full_name ilike '%' || v_q || '%' or coalesce(o.council_no, '') ilike '%' || v_q || '%'
             or o.profile::text ilike '%' || v_q || '%' or ph.name_fa ilike '%' || v_q || '%' or coalesce(c.name_fa, '') ilike '%' || v_q || '%')
      limit 500) t), '[]'));
end $$;

-- ---------------------------------------------------------------- who is editing
-- 'member' (the pharmacy's own staff), 'staff' (Dorva staff with access), or null
create or replace function public.my_pharmacy_access(p_pharmacy uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from memberships m where m.user_id = auth.uid() and m.pharmacy_id = p_pharmacy and m.status = 'active') then 'member'
    when app.can_manage_collection(p_pharmacy) or app.can_edit_page(p_pharmacy) or app.can_edit_look(p_pharmacy) then 'staff'
  end;
$$;

revoke execute on function public.pharmacy_reopen(uuid, text) from anon, public;
revoke execute on function public.pharmacy_resubmit(uuid, jsonb) from anon, public;
revoke execute on function public.pharmacy_review_history(uuid) from anon, public;
revoke execute on function public.service_option_save(text, text, text, text, jsonb, int, boolean) from anon, public;
revoke execute on function public.pharmacist_bank(text, boolean) from anon, public;
revoke execute on function public.my_pharmacy_access(uuid) from anon, public;
grant execute on function public.pharmacy_reopen(uuid, text) to authenticated;
grant execute on function public.pharmacy_resubmit(uuid, jsonb) to authenticated;
grant execute on function public.pharmacy_review_history(uuid) to authenticated;
grant execute on function public.service_option_save(text, text, text, text, jsonb, int, boolean) to authenticated;
grant execute on function public.pharmacist_bank(text, boolean) to authenticated;
grant execute on function public.my_pharmacy_access(uuid) to authenticated;
grant execute on function public.pharmacy_profile_get(uuid) to authenticated;
grant execute on function public.pharmacy_profile_save(uuid, jsonb) to authenticated;
grant execute on function public.pharmacy_about_public(uuid) to anon, authenticated;
