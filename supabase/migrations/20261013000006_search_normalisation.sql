-- =====================================================================
-- Dorva — search normalisation for Persian input
-- Users type the same word many ways: Persian/Arabic/Latin digits, Arabic
-- ي/ك vs Persian ی/ک, zero-width non-joiners, upper/lower case. Search
-- compares a normalised form of both sides so all of them match.
-- =====================================================================
set search_path = public, extensions;

create or replace function app.norm_text(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select lower(translate(p,
    '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يكةۀأإآ' || chr(8204),
    '01234567890123456789یکههااا'))
$$;

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
           app.norm_text(nullif(trim(p_query), '')) as q
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
         or app.norm_text(ph.name_fa) like '%' || params.q || '%'
         or app.norm_text(ph.address) like '%' || params.q || '%'
         or app.norm_text(ph.name_i18n::text) like '%' || params.q || '%')
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
