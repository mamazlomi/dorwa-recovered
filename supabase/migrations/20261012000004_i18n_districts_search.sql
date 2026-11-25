-- =====================================================================
-- Multilingual content + city districts + one search function for lists.
-- Persian stays in name_fa (source of truth); other languages live in
-- name_i18n = {"en": "...", "ar": "..."}. A new language needs no schema change.
-- =====================================================================

set search_path = public, extensions;

alter table public.provinces        add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.cities           add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.insurers         add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.roles            add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.catalog_products add column if not exists name_i18n jsonb not null default '{}'::jsonb;
alter table public.pharmacies       add column if not exists name_i18n jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Districts (municipal regions) per city
-- ---------------------------------------------------------------------
create table if not exists public.districts (
  id        serial primary key,
  city_id   int not null references public.cities(id) on delete cascade,
  code      text not null,
  name_fa   text not null,
  name_i18n jsonb not null default '{}'::jsonb,
  unique (city_id, code)
);
alter table public.districts enable row level security;
create policy read_all on public.districts for select using (true);

alter table public.pharmacies add column if not exists district_id int references public.districts(id);
create index if not exists pharmacies_district_idx on public.pharmacies (district_id);

-- a pharmacy's district must belong to its city
create or replace function app.check_pharmacy_district() returns trigger
language plpgsql set search_path = public, extensions, pg_temp as $$
begin
  if new.district_id is not null and not exists (
       select 1 from public.districts d where d.id = new.district_id and d.city_id = new.city_id) then
    raise exception 'district does not belong to the pharmacy city' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger pharmacies_district_check before insert or update of district_id, city_id on public.pharmacies
  for each row execute function app.check_pharmacy_district();

-- ---------------------------------------------------------------------
-- Search pharmacies: free text, city, district, insurer, near a point,
-- and basket coverage. Every filter is optional and combinable.
-- ---------------------------------------------------------------------
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
           nullif(trim(p_query), '') as q
  )
  select ph.id, ph.slug, ph.name_fa, ph.name_i18n, ph.city_id, ph.district_id, ph.address, ph.is_virtual,
         case when params.origin is null then null
              else round((earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) / 1000)::numeric, 2) end,
         (select count(*) from app.offers o where o.pharmacy_id = ph.id)::int,
         (select count(*) from app.offers o where o.pharmacy_id = ph.id
            and o.product_id = any(coalesce(p_product_ids, '{}')))::int
  from public.pharmacies ph, params
  where ph.status = 'active'
    and (p_city is null or ph.city_id = p_city)
    and (p_district is null or ph.district_id = p_district)
    and (p_insurer is null or exists (select 1 from public.pharmacy_insurers pi
                                      where pi.pharmacy_id = ph.id and pi.insurer_code = p_insurer))
    and (params.q is null
         or ph.name_fa ilike '%' || params.q || '%'
         or ph.address ilike '%' || params.q || '%'
         or ph.name_i18n::text ilike '%' || params.q || '%')
    and (params.origin is null
         or earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) <= params.radius_m)
  order by
    case when p_product_ids is null then 0 else -(select count(*) from app.offers o where o.pharmacy_id = ph.id
            and o.product_id = any(p_product_ids)) end,
    case when params.origin is null then 0
         else earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) end,
    ph.name_fa
  limit least(greatest(p_limit, 1), 200);
$$;
grant execute on function public.search_pharmacies(text, int, int, text, double precision, double precision, numeric, uuid[], int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Translations for existing reference data
-- ---------------------------------------------------------------------
update public.provinces p set name_i18n = v.t::jsonb from (values
  ('tehran',          '{"en":"Tehran","ar":"طهران"}'),
  ('isfahan',         '{"en":"Isfahan","ar":"أصفهان"}'),
  ('fars',            '{"en":"Fars","ar":"فارس"}'),
  ('chaharmahal',     '{"en":"Chaharmahal and Bakhtiari","ar":"جهارمحال وبختياري"}'),
  ('razavi_khorasan', '{"en":"Razavi Khorasan","ar":"خراسان رضوي"}'),
  ('east_azerbaijan', '{"en":"East Azerbaijan","ar":"أذربيجان الشرقية"}')
) as v(code, t) where p.code = v.code;

update public.cities c set name_i18n = v.t::jsonb from (values
  ('tehran',     '{"en":"Tehran","ar":"طهران"}'),
  ('isfahan',    '{"en":"Isfahan","ar":"أصفهان"}'),
  ('shiraz',     '{"en":"Shiraz","ar":"شيراز"}'),
  ('shahrekord', '{"en":"Shahrekord","ar":"شهركرد"}'),
  ('mashhad',    '{"en":"Mashhad","ar":"مشهد"}'),
  ('tabriz',     '{"en":"Tabriz","ar":"تبريز"}')
) as v(slug, t) where c.slug = v.slug;

update public.insurers i set name_i18n = v.t::jsonb from (values
  ('tamin',         '{"en":"Social Security (Tamin)","ar":"الضمان الاجتماعي"}'),
  ('salamat',       '{"en":"Iran Health Insurance (Salamat)","ar":"تأمين سلامت"}'),
  ('armed',         '{"en":"Armed Forces Insurance","ar":"تأمين القوات المسلحة"}'),
  ('imam_khomeini', '{"en":"Imam Khomeini Relief Committee","ar":"لجنة الإمداد"}'),
  ('supplementary', '{"en":"Supplementary insurance","ar":"تأمين تكميلي"}')
) as v(code, t) where i.code = v.code;

update public.roles r set name_i18n = v.t::jsonb from (values
  ('super_admin',       '{"en":"Dorva super admin","ar":"المدير العام لدوروا"}'),
  ('catalog_operator',  '{"en":"Catalog operator","ar":"مشغّل الكتالوج"}'),
  ('support',           '{"en":"Support","ar":"الدعم"}'),
  ('finance',           '{"en":"Finance","ar":"المالية"}'),
  ('content_moderator', '{"en":"Content moderator","ar":"مشرف المحتوى"}'),
  ('owner',             '{"en":"Pharmacy owner","ar":"مالك الصيدلية"}'),
  ('technical_officer', '{"en":"Responsible pharmacist","ar":"الصيدلي المسؤول"}'),
  ('dispenser',         '{"en":"Dispenser","ar":"موظف الصرف"}'),
  ('inventory_clerk',   '{"en":"Inventory clerk","ar":"أمين المخزن"}'),
  ('courier',           '{"en":"Courier","ar":"مندوب التوصيل"}')
) as v(code, t) where r.code = v.code and r.is_system;

-- Tehran's 22 municipal districts
insert into public.districts (city_id, code, name_fa, name_i18n)
select c.id, 'd' || n, 'منطقه ' || translate(n::text, '0123456789', '۰۱۲۳۴۵۶۷۸۹'),
       jsonb_build_object('en', 'District ' || n,
                          'ar', 'المنطقة ' || translate(n::text, '0123456789', '٠١٢٣٤٥٦٧٨٩'))
from public.cities c, generate_series(1, 22) n
where c.slug = 'tehran'
on conflict (city_id, code) do nothing;
