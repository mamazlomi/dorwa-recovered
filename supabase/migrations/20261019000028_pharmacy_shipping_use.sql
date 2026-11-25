-- Use the pharmacy delivery settings (migration 27) in the planner, the
-- product page, order placement and settlement.

set search_path = public, extensions;

-- local candidates stop at each pharmacy's own reach
create or replace function public.cart_candidates(
  p_items jsonb,
  p_city  int default null,
  p_lat   double precision default null,
  p_lng   double precision default null,
  p_limit int default 20)
returns table (
  pharmacy_id uuid, slug citext, name_fa text, name_i18n jsonb, city_id int, district_id int,
  distance_km numeric, covered int, total int, subtotal numeric)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with lines as (select * from app.cart_lines(p_items) where dispensing_class <> 'rx'),
  params as (
    select case when p_lat is null or p_lng is null then null else ll_to_earth(p_lat, p_lng) end as origin,
           coalesce((app.setting('allocation.max_radius_km'))::text::numeric, 10) * 1000 as max_m
  ),
  ph as (
    select ph.*, case when params.origin is null then null
                      else earth_distance(ll_to_earth(ph.lat, ph.lng), params.origin) end as dist_m
    from public.pharmacies ph cross join params
    where ph.status = 'active' and (p_city is null or ph.city_id = p_city)
  ),
  avail as (
    select o.pharmacy_id, l.product_id, l.qty, o.final_price
    from lines l
    join app.offers o on o.product_id = l.product_id
    join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = l.product_id
    where s.quantity >= l.qty
  )
  select ph.id, ph.slug, ph.name_fa, ph.name_i18n, ph.city_id, ph.district_id,
         round((ph.dist_m / 1000)::numeric, 2),
         count(a.product_id)::int,
         (select count(*) from lines)::int,
         sum(a.final_price * a.qty)
  from avail a
  join ph on ph.id = a.pharmacy_id
  where ph.dist_m is null or ph.dist_m <= least((select max_m from params), app.ph_reach_km(ph.id) * 1000)
  group by ph.id, ph.slug, ph.name_fa, ph.name_i18n, ph.city_id, ph.district_id, ph.dist_m
  order by count(a.product_id) desc, coalesce(ph.dist_m, 0), md5(ph.id::text || current_date::text)
  limit least(greatest(p_limit, 1), 100);
$$;

-- pharmacies that opted out of intercity orders are not offered
create or replace function public.intercity_candidates(
  p_items jsonb, p_city int default null, p_lat double precision default null, p_lng double precision default null,
  p_limit int default 3)
returns table (pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, city_fa text, city_i18n jsonb,
               distance_km numeric, covered int, total int, subtotal numeric, shipping numeric,
               min_days int, max_days int)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with origin as (
    select coalesce(
             case when p_lat is not null and p_lng is not null then ll_to_earth(p_lat, p_lng) end,
             (select ll_to_earth(c.lat, c.lng) from public.cities c where c.id = p_city)) as pt
  ),
  lines as (
    select * from app.cart_lines(p_items) where dispensing_class <> 'rx' and app.intercity_allowed(dispensing_class)
  ),
  ph as (
    select ph.*, round((earth_distance(ll_to_earth(ph.lat, ph.lng), o.pt) / 1000)::numeric, 1) km
    from public.pharmacies ph cross join origin o
    where o.pt is not null and ph.status = 'active' and app.ph_intercity_ok(ph.id)
      and earth_distance(ll_to_earth(ph.lat, ph.lng), o.pt) > app.setting_num('allocation.max_radius_km', 10) * 1000
      and earth_distance(ll_to_earth(ph.lat, ph.lng), o.pt) <= app.setting_num('shipping.intercity_max_km', 1200) * 1000
  ),
  avail as (
    select o.pharmacy_id, l.product_id, l.qty, o.final_price
    from lines l
    join app.offers o on o.product_id = l.product_id
    join public.stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = l.product_id
    where s.quantity >= l.qty
  ),
  agg as (
    select ph.id, ph.slug::text slug, ph.name_fa, ph.name_i18n, c.name_fa city_fa, c.name_i18n city_i18n, ph.km,
           count(a.product_id)::int covered, (select count(*) from app.cart_lines(p_items) where dispensing_class <> 'rx')::int total,
           sum(a.final_price * a.qty) subtotal
    from avail a join ph on ph.id = a.pharmacy_id
    left join public.cities c on c.id = ph.city_id
    group by ph.id, ph.slug, ph.name_fa, ph.name_i18n, c.name_fa, c.name_i18n, ph.km
  )
  select g.id, g.slug, g.name_fa, g.name_i18n, g.city_fa, g.city_i18n, g.km, g.covered, g.total, g.subtotal,
         app.shipping_fee('intercity', g.km, g.subtotal),
         app.setting_num('shipping.intercity_min_days', 2)::int, app.setting_num('shipping.intercity_max_days', 4)::int
  from agg g
  where app.setting_bool('shipping.intercity_enabled', true)
  order by g.covered desc,
           case when coalesce(app.setting('shipping.intercity_pick') #>> '{}', 'cheapest_total') = 'nearest' then g.km
                else g.subtotal + app.shipping_fee('intercity', g.km, g.subtotal) end,
           md5(g.id::text || current_date::text)
  limit least(greatest(coalesce(p_limit, 3), 1), 20);
$$;

-- fee, estimate and provider per pharmacy
create or replace function public.plan_cart_v2(
  p_items jsonb, p_city int default null, p_lat double precision default null, p_lng double precision default null,
  p_preferred uuid default null, p_force uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_plan jsonb;
  v_ic   record;
  v_items jsonb;
  v_sub  numeric;
  v_offer text := coalesce(app.setting('shipping.intercity_offer') #>> '{}', 'when_unavailable');
  v_enabled boolean := app.setting_bool('shipping.intercity_enabled', true);
  v_ph   jsonb;
begin
  v_plan := public.plan_cart(p_items, p_city, p_lat, p_lng, p_preferred, p_force);

  -- the customer picked a pharmacy in another city
  if p_force is not null and v_plan->>'strategy' <> 'chosen' and v_enabled then
    select * into v_ic from public.intercity_candidates(p_items, p_city, p_lat, p_lng, 20) c where c.pharmacy_id = p_force;
    if found then
      select jsonb_agg(jsonb_build_object('product_id', l.product_id, 'qty', l.qty, 'unit_price', o.final_price,
               'list_price', o.list_price, 'discount_pct', o.discount_pct, 'line_total', o.final_price * l.qty)
               order by l.product_id),
             sum(o.final_price * l.qty)
        into v_items, v_sub
      from app.cart_lines(p_items) l
      join app.offers o on o.product_id = l.product_id and o.pharmacy_id = p_force
      join public.stock_items s on s.pharmacy_id = p_force and s.product_id = l.product_id
      where l.dispensing_class <> 'rx' and app.intercity_allowed(l.dispensing_class) and s.quantity >= l.qty;

      v_plan := v_plan || jsonb_build_object(
        'strategy', 'intercity',
        'pharmacies', jsonb_build_array(jsonb_build_object(
          'pharmacy_id', v_ic.pharmacy_id, 'slug', v_ic.slug, 'name_fa', v_ic.name_fa, 'name_i18n', v_ic.name_i18n,
          'city_fa', v_ic.city_fa, 'city_i18n', v_ic.city_i18n, 'distance_km', v_ic.distance_km,
          'items', coalesce(v_items, '[]'::jsonb), 'subtotal', coalesce(v_sub, 0))),
        'total', coalesce(v_sub, 0),
        'unavailable', coalesce((
          select jsonb_agg(l.product_id) from app.cart_lines(p_items) l
          where l.dispensing_class <> 'rx'
            and l.product_id not in (select (e->>'product_id')::uuid from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) e)),
          '[]'::jsonb));
    end if;
  end if;

  -- shipping fee and delivery estimate per pharmacy
  select coalesce(jsonb_agg(
           p || jsonb_build_object(
             'kind', case when v_plan->>'strategy' = 'intercity' then 'intercity' else 'local' end,
             'provider', app.ph_ship_provider((p->>'pharmacy_id')::uuid, case when v_plan->>'strategy' = 'intercity' then 'intercity' else 'local' end),
             'shipping', app.shipping_fee_ph((p->>'pharmacy_id')::uuid, case when v_plan->>'strategy' = 'intercity' then 'intercity' else 'local' end,
                                          (p->>'distance_km')::numeric, (p->>'subtotal')::numeric),
             'eta', case when v_plan->>'strategy' = 'intercity' then 'days' else app.local_eta_ph((p->>'pharmacy_id')::uuid, (p->>'distance_km')::numeric) end,
             'min_days', app.setting_num('shipping.intercity_min_days', 2)::int,
             'max_days', app.setting_num('shipping.intercity_max_days', 4)::int)
           order by ord), '[]'::jsonb)
    into v_ph
  from jsonb_array_elements(v_plan->'pharmacies') with ordinality as x(p, ord);

  v_plan := v_plan || jsonb_build_object(
    'pharmacies', v_ph,
    'shipping_total', coalesce((select sum((e->>'shipping')::numeric) from jsonb_array_elements(v_ph) e), 0),
    'grand_total', (v_plan->>'total')::numeric
                   + coalesce((select sum((e->>'shipping')::numeric) from jsonb_array_elements(v_ph) e), 0));

  -- other cities as an option
  if v_enabled and v_plan->>'strategy' <> 'intercity'
     and (v_offer = 'always' or jsonb_array_length(v_plan->'unavailable') > 0 or jsonb_array_length(v_ph) = 0) then
    v_plan := v_plan || jsonb_build_object('intercity_options', coalesce((
      select jsonb_agg(to_jsonb(c)) from public.intercity_candidates(p_items, p_city, p_lat, p_lng, 3) c
      where not exists (select 1 from jsonb_array_elements(v_ph) e where (e->>'pharmacy_id')::uuid = c.pharmacy_id)), '[]'::jsonb));
  else
    v_plan := v_plan || jsonb_build_object('intercity_options', '[]'::jsonb);
  end if;
  return v_plan;
end $$;

-- product page: delivery estimate and reach per pharmacy
create or replace function public.product_offers_v2(
  p_product uuid, p_city int default null, p_lat double precision default null, p_lng double precision default null)
returns table(pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, city_fa text, city_i18n jsonb,
              district_fa text, district_i18n jsonb, final_price numeric, list_price numeric,
              discount_pct numeric, max_qty int, distance_km numeric, delivery text)
language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  with cfg as (
    select coalesce((app.setting('delivery.same_day_cutoff_hour') #>> '{}')::numeric, 17) as cutoff,
           coalesce((app.setting('delivery.same_day_max_km') #>> '{}')::numeric, 8) as max_km,
           coalesce((app.setting('allocation.max_radius_km') #>> '{}')::numeric, 10) as reach_km,
           extract(hour from now() at time zone 'Asia/Tehran') as hr
  ),
  rows as (
    select o.pharmacy_id, ph.slug, ph.name_fa, ph.name_i18n, c.name_fa c_fa, c.name_i18n c_i18n,
           d.name_fa d_fa, d.name_i18n d_i18n, o.final_price, o.list_price, o.discount_pct,
           least(s.quantity, 10)::int qty,
           case when p_lat is null or p_lng is null then null
                else round((earth_distance(ll_to_earth(ph.lat, ph.lng), ll_to_earth(p_lat, p_lng)) / 1000)::numeric, 1) end dist
    from app.offers o
    join pharmacies ph   on ph.id = o.pharmacy_id
    join stock_items s   on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
    left join cities c   on c.id = ph.city_id
    left join districts d on d.id = ph.district_id
    where o.product_id = p_product and (p_city is null or o.city_id = p_city)
  )
  select r.pharmacy_id, r.slug, r.name_fa, r.name_i18n, r.c_fa, r.c_i18n, r.d_fa, r.d_i18n,
         r.final_price, r.list_price, r.discount_pct, r.qty, r.dist,
         -- with a location: today / tomorrow / out of delivery range; without one an
         -- estimate only inside a chosen city (otherwise unknown)
         case when r.dist is not null then
                case when r.dist > app.ph_reach_km(r.pharmacy_id) then 'out'
                     when app.local_eta_ph(r.pharmacy_id, r.dist) = 'today' then 'today'
                     else 'tomorrow' end
              when p_city is not null then
                case when cfg.hr < cfg.cutoff then 'today' else 'tomorrow' end
         end
  from rows r cross join cfg
  -- price first, then distance; equal ones rotate daily (fairness)
  order by r.final_price, r.dist nulls last, md5(r.pharmacy_id::text || current_date::text)
  limit 50;
$$;

-- order parts remember who delivers
create or replace function public.place_order(p_items jsonb, p_address uuid, p_preferred uuid default null, p_force uuid default null)
returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  a public.customer_addresses;
  v_plan jsonb; ph jsonb; it jsonb;
  v_order uuid; v_part uuid; n int := 0;
begin
  if v_uid is null then raise exception 'login required' using errcode = '42501'; end if;
  select * into a from public.customer_addresses where id = p_address and user_id = v_uid;
  if not found then raise exception 'address not found' using errcode = 'P0002'; end if;

  v_plan := public.plan_cart_v2(p_items, a.city_id, a.lat, a.lng, p_preferred, p_force);
  if jsonb_array_length(v_plan->'pharmacies') = 0 then raise exception 'nothing to order' using errcode = 'P0001'; end if;

  insert into public.orders (order_no, user_id, address, city_id, items_total, shipping_total, grand_total, expires_at)
  values ('D' || to_char(now() at time zone 'Asia/Tehran', 'YYMMDD') || '-' || lpad(nextval('public.order_no_seq')::text, 5, '0'),
          v_uid,
          jsonb_build_object('id', a.id, 'label', a.label, 'recipient', a.recipient, 'phone', a.phone,
                             'address_line', a.address_line, 'plaque', a.plaque, 'unit', a.unit, 'lat', a.lat, 'lng', a.lng),
          a.city_id, (v_plan->>'total')::numeric, (v_plan->>'shipping_total')::numeric, (v_plan->>'grand_total')::numeric,
          now() + make_interval(mins => app.setting_num('payment.pay_window_min', 30)::int))
  returning id into v_order;

  for ph in select * from jsonb_array_elements(v_plan->'pharmacies') loop
    n := n + 1;
    insert into public.order_parts (order_id, pharmacy_id, seq, kind, subtotal, shipping_fee, distance_km, eta, min_days, max_days, shipping_provider)
    values (v_order, (ph->>'pharmacy_id')::uuid, n, ph->>'kind', (ph->>'subtotal')::numeric, (ph->>'shipping')::numeric,
            (ph->>'distance_km')::numeric, ph->>'eta', (ph->>'min_days')::int, (ph->>'max_days')::int,
            coalesce(ph->>'provider', 'dorva'))
    returning id into v_part;
    for it in select * from jsonb_array_elements(ph->'items') loop
      insert into public.order_items (part_id, product_id, name_fa, dispensing_class, qty, unit_price, list_price, discount_pct, line_total, tech_status)
      select v_part, p.id, p.name_fa, p.dispensing_class, (it->>'qty')::int, (it->>'unit_price')::numeric,
             (it->>'list_price')::numeric, coalesce((it->>'discount_pct')::numeric, 0), (it->>'line_total')::numeric,
             case when p.requires_tech_approval or p.dispensing_class in ('otc','supplement') then 'pending' else 'na' end
      from public.catalog_products p where p.id = (it->>'product_id')::uuid;
    end loop;
  end loop;

  insert into public.payments (order_id, gateway, amount)
  values (v_order, coalesce(app.setting('payment.gateway') #>> '{}', 'test'), (v_plan->>'grand_total')::numeric);
  return v_order;
end $$;

-- the shipping share goes to whoever delivered
create or replace function app.refresh_settlement(p_part uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_items numeric; v_dorva numeric; v_ship numeric; v_status text; v_payee text;
begin
  select coalesce(sum(i.line_total), 0), coalesce(sum(round(i.line_total * app.commission_pct(i.dispensing_class) / 100, -3)), 0)
    into v_items, v_dorva
  from public.order_items i where i.part_id = p_part and i.tech_status <> 'rejected';
  select shipping_fee, status, shipping_provider into v_ship, v_status, v_payee from public.order_parts where id = p_part;
  insert into public.settlements (part_id, pharmacy_amount, dorva_amount, logistics_amount, logistics_payee)
  values (p_part, v_items - v_dorva, v_dorva, case when v_status = 'cancelled' then 0 else v_ship end, v_payee)
  on conflict (part_id) do update set pharmacy_amount = excluded.pharmacy_amount,
    dorva_amount = excluded.dorva_amount, logistics_amount = excluded.logistics_amount, logistics_payee = excluded.logistics_payee;
end $$;
