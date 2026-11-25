-- SEO: technical SEO data for the site (sitemap, per-page overrides, redirects,
-- a quality report) and the settings Dorva edits without code.
--  * Indexing is OFF by default: the pilot has test pharmacies and test prices
--    that must not reach search engines. Dorva switches it on at launch.
--  * Prescription (rx) product pages are not indexed by default: public
--    advertising of prescription medicines is not allowed.

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('seo.indexing', 'seo', 'boolean', null, null, null, null,
   '{"fa":"اجازه ایندکس سایت در موتورهای جستجو","en":"Let search engines index the site","ar":"السماح لمحركات البحث بالفهرسة"}',
   '{"fa":"تا پایان پایلوت خاموش بماند (داروخانه‌ها و قیمت‌های آزمایشی نباید در گوگل بیایند). روشن: robots.txt و نقشه سایت باز می‌شوند.","en":"Keep off during the pilot (test pharmacies and prices must not reach Google).","ar":"أبقه مطفأً خلال المرحلة التجريبية."}', 800),
  ('seo.index_rx', 'seo', 'boolean', null, null, null, null,
   '{"fa":"ایندکس صفحه داروهای نسخه‌ای","en":"Index prescription medicine pages","ar":"فهرسة صفحات أدوية الوصفات"}',
   '{"fa":"پیش‌فرض خاموش: تبلیغ عمومی داروی نسخه‌ای مجاز نیست؛ صفحه‌ها برای کاربر باز است ولی در گوگل نمی‌آید.","en":"Off by default: public advertising of prescription medicines is not allowed.","ar":"مطفأ افتراضيًا."}', 801),
  ('seo.title_suffix', 'seo', 'text', null, null, null, null,
   '{"fa":"پسوند عنوان صفحه‌ها","en":"Page title suffix","ar":"لاحقة عنوان الصفحات"}',
   '{"fa":"مثلاً «دوروا — داروخانه آنلاین». خالی = نام دوروا.","en":"e.g. “Dorva — online pharmacy”. Empty = Dorva.","ar":"فارغ = دوروا."}', 802),
  ('seo.description_fa', 'seo', 'text', null, null, null, null,
   '{"fa":"توضیح پیش‌فرض سایت (فارسی)","en":"Default site description (Persian)","ar":"الوصف الافتراضي (فارسي)"}',
   '{"fa":"۱۲۰ تا ۱۶۰ حرف؛ در نتایج گوگل زیر عنوان می‌آید.","en":"120–160 characters.","ar":"١٢٠–١٦٠ حرفًا."}', 803),
  ('seo.description_en', 'seo', 'text', null, null, null, null,
   '{"fa":"توضیح پیش‌فرض سایت (انگلیسی)","en":"Default site description (English)","ar":"الوصف الافتراضي (إنجليزي)"}', null, 804),
  ('seo.description_ar', 'seo', 'text', null, null, null, null,
   '{"fa":"توضیح پیش‌فرض سایت (عربی)","en":"Default site description (Arabic)","ar":"الوصف الافتراضي (عربي)"}', null, 805),
  ('seo.google_verification', 'seo', 'text', null, null, null, null,
   '{"fa":"کد تأیید Google Search Console","en":"Google Search Console verification code","ar":"رمز التحقق من Google"}',
   '{"fa":"فقط مقدار content تگ meta (نه کل تگ).","en":"Only the content value of the meta tag.","ar":"قيمة content فقط."}', 806),
  ('seo.bing_verification', 'seo', 'text', null, null, null, null,
   '{"fa":"کد تأیید Bing Webmaster","en":"Bing Webmaster verification code","ar":"رمز التحقق من Bing"}', null, 807)
on conflict (key) do nothing;

insert into public.settings (key, scope, value, description_fa) values
  ('seo.indexing', 'platform', 'false', 'ایندکس سایت'),
  ('seo.index_rx', 'platform', 'false', 'ایندکس داروهای نسخه‌ای'),
  ('seo.title_suffix', 'platform', '""', 'پسوند عنوان'),
  ('seo.description_fa', 'platform', '"دوروا، داروخانه آنلاین: خرید دارو، مکمل و محصولات سلامت از داروخانه‌های معتبر نزدیک شما با تأیید داروساز و ارسال سریع."', 'توضیح فارسی'),
  ('seo.description_en', 'platform', '"Dorva online pharmacy: medicines, supplements and health products from licensed pharmacies near you, checked by a pharmacist and delivered fast."', 'توضیح انگلیسی'),
  ('seo.description_ar', 'platform', '"دوروا صيدلية إلكترونية: أدوية ومكملات ومنتجات صحية من صيدليات مرخّصة قريبة منك مع مراجعة الصيدلي وتوصيل سريع."', 'توضیح عربی'),
  ('seo.google_verification', 'platform', '""', 'گوگل'),
  ('seo.bing_verification', 'platform', '""', 'بینگ')
on conflict do nothing;

-- ---------------------------------------------------------------- per-page overrides
-- path without the language prefix: '/', '/products', '/drmazloomi', '/product/<id>'
create table if not exists public.seo_pages (
  path        text primary key check (path ~ '^/[A-Za-z0-9/_.~-]{0,200}$'),
  title       jsonb not null default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb,
  noindex     boolean not null default false,
  og_image    text check (og_image is null or og_image ~ '^https://'),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);
alter table public.seo_pages enable row level security;
revoke all on public.seo_pages from anon, authenticated;

create table if not exists public.seo_redirects (
  from_path  text primary key check (from_path ~ '^/[A-Za-z0-9/_.~%-]{1,250}$'),
  to_path    text not null check (to_path ~ '^(/[A-Za-z0-9/_.~%?=&-]{0,250}|https://[^\s]{3,250})$'),
  permanent  boolean not null default true,
  active     boolean not null default true,
  note       text check (note is null or length(note) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.seo_redirects enable row level security;
revoke all on public.seo_redirects from anon, authenticated;

-- everything a page needs for its metadata (public)
create or replace function public.seo_meta(p_path text default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'indexing', app.setting_bool('seo.indexing', false),
    'index_rx', app.setting_bool('seo.index_rx', false),
    'suffix', coalesce(app.setting('seo.title_suffix') #>> '{}', ''),
    'description', jsonb_build_object('fa', app.setting('seo.description_fa') #>> '{}', 'en', app.setting('seo.description_en') #>> '{}',
                                      'ar', app.setting('seo.description_ar') #>> '{}'),
    'google', nullif(app.setting('seo.google_verification') #>> '{}', ''),
    'bing', nullif(app.setting('seo.bing_verification') #>> '{}', ''),
    'page', (select jsonb_build_object('title', s.title, 'description', s.description, 'noindex', s.noindex, 'og_image', s.og_image)
             from seo_pages s where s.path = p_path));
$$;

create or replace function public.seo_redirect_list() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('f', from_path, 't', to_path, 'p', permanent)), '[]')
  from seo_redirects where active;
$$;

-- what goes into sitemap.xml (empty while indexing is off)
create or replace function public.seo_sitemap() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when not app.setting_bool('seo.indexing', false) then '{}'::jsonb else jsonb_build_object(
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'at', greatest(p.synced_at, l.updated_at)))
      from catalog_products p join product_listings l on l.product_id = p.id and l.is_published
      where p.is_active and (p.dispensing_class <> 'rx' or app.setting_bool('seo.index_rx', false))
        and not exists (select 1 from seo_pages s where s.path = '/product/' || p.id::text and s.noindex)), '[]'),
    'pharmacies', coalesce((select jsonb_agg(jsonb_build_object('slug', ph.slug, 'at', ph.updated_at))
      from pharmacies ph where ph.status = 'active' and not ph.is_virtual
        and not exists (select 1 from seo_pages s where s.path = '/' || ph.slug and s.noindex)), '[]'),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('slug', c.slug, 'at', c.updated_at))
      from collections c where c.pharmacy_id is null and c.status = 'published'), '[]')) end;
$$;

-- ---------------------------------------------------------------- Dorva editing
create or replace function public.seo_admin() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'pages', coalesce((select jsonb_agg(to_jsonb(s) - 'updated_by' order by s.path) from seo_pages s), '[]'),
    'redirects', coalesce((select jsonb_agg(to_jsonb(r) order by r.from_path) from seo_redirects r), '[]'),
    'report', jsonb_build_object(
      'products', (select count(*) from catalog_products p join product_listings l on l.product_id = p.id and l.is_published where p.is_active),
      'rx', (select count(*) from catalog_products p join product_listings l on l.product_id = p.id and l.is_published where p.is_active and p.dispensing_class = 'rx'),
      'no_image', (select count(*) from catalog_products p join product_listings l on l.product_id = p.id and l.is_published
                   where p.is_active and coalesce(p.image_url, '') = ''),
      'no_en', (select count(*) from catalog_products p join product_listings l on l.product_id = p.id and l.is_published
                where p.is_active and coalesce(p.name_i18n->>'en', p.name_en, '') = ''),
      'pharmacies', (select count(*) from pharmacies where status = 'active' and not is_virtual),
      'virtual', (select count(*) from pharmacies where status = 'active' and is_virtual),
      'ph_no_about', (select count(*) from pharmacies where status = 'active' and not is_virtual and coalesce(about_fa, '') = ''),
      'ph_short_about', (select count(*) from pharmacies where status = 'active' and not is_virtual and length(coalesce(about_fa, '')) between 1 and 119),
      'col_no_desc', (select count(*) from collections where pharmacy_id is null and status = 'published' and coalesce(description->>'fa', '') = ''),
      'samples', jsonb_build_object(
        'no_image', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name_fa)) from (
            select p.id, p.name_fa from catalog_products p join product_listings l on l.product_id = p.id and l.is_published
            where p.is_active and coalesce(p.image_url, '') = '' order by p.name_fa limit 20) x), '[]'),
        'ph_no_about', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name_fa)) from (
            select slug, name_fa from pharmacies where status = 'active' and not is_virtual and length(coalesce(about_fa, '')) < 120
            order by name_fa limit 20) x), '[]'))));
end $$;

-- 'ok' | 'path' | 'value'
create or replace function public.seo_page_save(p_path text, p_title jsonb, p_description jsonb, p_noindex boolean, p_og_image text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_path text := '/' || trim(both '/' from lower(coalesce(p_path, '')));
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_path ~ '^/(fa|en|ar)(/|$)' then v_path := '/' || trim(both '/' from substr(v_path, 4)); end if;
  if v_path !~ '^/[a-z0-9/_.~-]{0,200}$' then return 'path'; end if;
  begin
    insert into seo_pages (path, title, description, noindex, og_image, updated_by, updated_at)
    values (v_path, coalesce(p_title, '{}'), coalesce(p_description, '{}'), coalesce(p_noindex, false), nullif(trim(coalesce(p_og_image, '')), ''), auth.uid(), now())
    on conflict (path) do update set title = excluded.title, description = excluded.description, noindex = excluded.noindex,
      og_image = excluded.og_image, updated_by = excluded.updated_by, updated_at = now();
  exception when check_violation then return 'value';
  end;
  return 'ok';
end $$;

create or replace function public.seo_page_delete(p_path text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from seo_pages where path = p_path;
  return 'ok';
end $$;

-- 'ok' | 'path' | 'loop' | 'value'
create or replace function public.seo_redirect_save(p_from text, p_to text, p_permanent boolean, p_active boolean, p_note text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from text := '/' || trim(both '/' from coalesce(p_from, '')); v_to text := trim(coalesce(p_to, ''));
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_from = '/' or v_from ~ '^/(api|_next|auth|admin|pharmacy)(/|$)' or v_from ~ '^/(fa|en|ar)/(api|admin|pharmacy)(/|$)' then return 'path'; end if;
  if v_to = v_from or exists (select 1 from seo_redirects where from_path = v_to and to_path = v_from and active) then return 'loop'; end if;
  begin
    insert into seo_redirects (from_path, to_path, permanent, active, note, updated_at)
    values (v_from, v_to, coalesce(p_permanent, true), coalesce(p_active, true), nullif(trim(coalesce(p_note, '')), ''), now())
    on conflict (from_path) do update set to_path = excluded.to_path, permanent = excluded.permanent, active = excluded.active,
      note = excluded.note, updated_at = now();
  exception when check_violation then return 'value';
  end;
  return 'ok';
end $$;

create or replace function public.seo_redirect_delete(p_from text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.has_platform_permission('settings.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from seo_redirects where from_path = p_from;
  return 'ok';
end $$;

grant execute on function public.seo_meta(text) to anon, authenticated;
grant execute on function public.seo_redirect_list() to anon, authenticated;
grant execute on function public.seo_sitemap() to anon, authenticated;
revoke execute on function public.seo_admin() from anon, public;
revoke execute on function public.seo_page_save(text, jsonb, jsonb, boolean, text) from anon, public;
revoke execute on function public.seo_page_delete(text) from anon, public;
revoke execute on function public.seo_redirect_save(text, text, boolean, boolean, text) from anon, public;
revoke execute on function public.seo_redirect_delete(text) from anon, public;
grant execute on function public.seo_admin() to authenticated;
grant execute on function public.seo_page_save(text, jsonb, jsonb, boolean, text) to authenticated;
grant execute on function public.seo_page_delete(text) to authenticated;
grant execute on function public.seo_redirect_save(text, text, boolean, boolean, text) to authenticated;
grant execute on function public.seo_redirect_delete(text) to authenticated;
