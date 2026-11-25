-- =====================================================================
-- Security hardening after Supabase advisor review
-- 1. The public offers read model moves out of the API schema; customers
--    reach it only through a narrow function (no raw stock, no quantities).
-- 2. Every function gets a fixed search_path.
-- =====================================================================

set search_path = public, extensions;

-- Non-destructive: move the read model out of the API-exposed schema.
alter view public.product_offers rename to offers;
alter view public.offers set schema app;
revoke all on app.offers from public, anon, authenticated;

-- Offers for one pharmacy or one city (at least one filter required).
create or replace function public.list_offers(p_pharmacy uuid default null, p_city int default null)
returns table (pharmacy_id uuid, product_id uuid, city_id int,
               final_price numeric, list_price numeric, discount_pct numeric)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select o.pharmacy_id, o.product_id, o.city_id, o.final_price, o.list_price, o.discount_pct
  from app.offers o
  where (p_pharmacy is not null or p_city is not null)
    and (p_pharmacy is null or o.pharmacy_id = p_pharmacy)
    and (p_city is null or o.city_id = p_city);
$$;

create or replace function public.nearest_pharmacies(
  p_lat double precision, p_lng double precision,
  p_product_ids uuid[] default null,
  p_radius_km numeric default null,
  p_limit int default 20)
returns table (
  pharmacy_id uuid, slug citext, name_fa text, distance_km numeric,
  items_available int, items_requested int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with params as (
    select least(coalesce(p_radius_km, (app.setting('allocation.initial_radius_km'))::text::numeric, 2),
                 coalesce((app.setting('allocation.max_radius_km'))::text::numeric, 50)) * 1000 as radius_m,
           ll_to_earth(p_lat, p_lng) as origin
  ),
  candidates as (
    select ph.id, ph.slug, ph.name_fa,
           earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) as dist_m
    from public.pharmacies ph, params
    where ph.status = 'active'
      and earth_box(params.origin, params.radius_m) @> ll_to_earth(ph.lat, ph.lng)
      and earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) <= params.radius_m
  )
  select c.id, c.slug, c.name_fa, round((c.dist_m / 1000)::numeric, 2),
         coalesce((select count(*) from app.offers o
                    where o.pharmacy_id = c.id
                      and o.product_id = any(p_product_ids))::int, 0),
         coalesce(cardinality(p_product_ids), 0)
  from candidates c
  order by 5 desc, c.dist_m
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.list_offers(uuid, int) to anon, authenticated;
grant execute on function public.nearest_pharmacies(double precision, double precision, uuid[], numeric, int) to anon, authenticated;

alter function app.check_membership()          set search_path = public, extensions, pg_temp;
alter function app.check_role_permission()     set search_path = public, extensions, pg_temp;
alter function app.check_stock_policy()        set search_path = public, extensions, pg_temp;
alter function app.guard_pharmacy_update()     set search_path = public, extensions, pg_temp;
alter function app.effective_price(text, numeric, numeric, numeric) set search_path = public, extensions, pg_temp;

comment on table public.catalog_sync_state is
  'Written only by the catalog sync job using the service role; intentionally no client policies.';
