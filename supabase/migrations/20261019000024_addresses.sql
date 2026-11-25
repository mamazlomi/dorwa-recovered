-- Customer delivery addresses (address book, like Snapp) and map settings.
-- Guests keep one temporary address in a cookie; signed-in customers keep
-- several here and pick one in the "deliver to" selector.

set search_path = public, extensions;

create table if not exists public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label        text not null check (length(trim(label)) between 1 and 40),
  recipient    text check (recipient is null or length(recipient) <= 80),
  phone        text check (phone is null or phone ~ '^[0-9+ ]{7,16}$'),
  city_id      int references public.cities(id),
  address_line text check (address_line is null or length(address_line) <= 300),
  plaque       text check (plaque is null or length(plaque) <= 20),
  unit         text check (unit is null or length(unit) <= 20),
  lat          double precision not null check (lat between 24 and 40.5),
  lng          double precision not null check (lng between 44 and 63.5),
  created_at   timestamptz not null default now()
);
create index if not exists customer_addresses_user on public.customer_addresses(user_id);

alter table public.customer_addresses enable row level security;
create policy customer_addresses_own_select on public.customer_addresses for select to authenticated using (user_id = auth.uid());
create policy customer_addresses_own_insert on public.customer_addresses for insert to authenticated with check (user_id = auth.uid());
create policy customer_addresses_own_update on public.customer_addresses for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy customer_addresses_own_delete on public.customer_addresses for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.customer_addresses to authenticated;

-- at most 20 addresses per customer; city filled from the map point
create or replace function app.address_before_write() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if tg_op = 'INSERT' and (select count(*) from public.customer_addresses where user_id = new.user_id) >= 20 then
    raise exception 'address book full' using errcode = 'check_violation';
  end if;
  if new.city_id is null then
    new.city_id := (select id from public.nearest_city(new.lat, new.lng));
  end if;
  return new;
end $$;

-- nearest city centre within 80 km (null when the point is far from every city)
create or replace function public.nearest_city(p_lat double precision, p_lng double precision)
returns table(id int, slug text, name_fa text, name_i18n jsonb, km numeric)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select c.id, c.slug::text, c.name_fa,
         c.name_i18n,
         round((earth_distance(ll_to_earth(c.lat, c.lng), ll_to_earth(p_lat, p_lng)) / 1000)::numeric, 1)
  from public.cities c
  where p_lat is not null and p_lng is not null
    and earth_distance(ll_to_earth(c.lat, c.lng), ll_to_earth(p_lat, p_lng)) < 80000
  order by earth_distance(ll_to_earth(c.lat, c.lng), ll_to_earth(p_lat, p_lng))
  limit 1;
$$;
grant execute on function public.nearest_city(double precision, double precision) to anon, authenticated;

create trigger customer_addresses_before_write before insert or update on public.customer_addresses
  for each row execute function app.address_before_write();

-- Active pharmacies as map markers (public business locations), so testers can
-- drop a pin near or far from them.
create or replace function public.map_pharmacies(p_city int default null)
returns table(id uuid, slug text, name_fa text, name_i18n jsonb, lat double precision, lng double precision, is_virtual boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select ph.id, ph.slug::text, ph.name_fa, ph.name_i18n, ph.lat, ph.lng, ph.is_virtual
  from public.pharmacies ph
  where ph.status = 'active' and ph.lat is not null and ph.lng is not null
    and (p_city is null or ph.city_id = p_city)
  order by ph.name_fa
  limit 500;
$$;
grant execute on function public.map_pharmacies(int) to anon, authenticated;

-- Map provider is a setting so OpenStreetMap can later be swapped for Neshan or Map.ir without code.
insert into public.setting_definitions (key, group_code, value_type, options, label, help, sort) values
  ('map.tile_url', 'map', 'text', null,
   '{"fa":"آدرس کاشی‌های نقشه","en":"Map tile URL","ar":"عنوان بلاطات الخريطة"}',
   '{"fa":"قالب آدرس کاشی‌ها با {z}/{x}/{y}. پیش‌فرض OpenStreetMap رایگان است؛ برای نشان یا Map.ir آدرس سرویس آن‌ها را بگذارید.","en":"Tile URL template with {z}/{x}/{y}. Default is the free OpenStreetMap; use Neshan or Map.ir URLs to switch.","ar":"قالب عنوان البلاطات مع {z}/{x}/{y}. الافتراضي OpenStreetMap المجاني."}', 510),
  ('map.attribution', 'map', 'text', null,
   '{"fa":"متن منبع نقشه","en":"Map attribution","ar":"نص مصدر الخريطة"}',
   '{"fa":"نام ارائه‌دهنده نقشه که گوشه نقشه نمایش داده می‌شود (الزام مجوز OpenStreetMap).","en":"Provider credit shown in the map corner (required by the OpenStreetMap licence).","ar":"اسم مزود الخريطة في زاويتها (يشترطه ترخيص OpenStreetMap)."}', 520),
  ('map.search_url', 'map', 'text', null,
   '{"fa":"سرویس جستجوی آدرس","en":"Address search service","ar":"خدمة البحث عن العنوان"}',
   '{"fa":"آدرس سرویس جستجوی Nominatim. خالی بگذارید تا جعبه جستجو پنهان شود.","en":"Nominatim-compatible search URL. Leave empty to hide the search box.","ar":"عنوان خدمة بحث متوافقة مع Nominatim. اتركه فارغاً لإخفاء البحث."}', 530)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('map.tile_url', 'platform', '"https://tile.openstreetmap.org/{z}/{x}/{y}.png"', 'آدرس کاشی‌های نقشه'),
  ('map.attribution', 'platform', '"© OpenStreetMap"', 'متن منبع نقشه'),
  ('map.search_url', 'platform', '"https://nominatim.openstreetmap.org"', 'سرویس جستجوی آدرس')
on conflict do nothing;
