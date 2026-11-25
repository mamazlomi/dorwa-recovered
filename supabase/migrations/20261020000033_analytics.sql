-- Management dashboards (Dorva and pharmacy) and the events behind them.
--
-- Behaviour events are anonymous (no user id): product views, searches and
-- cart additions, with time so the dashboard can show when people shop.
-- Customer counts come from orders and are only ever shown in aggregate.

set search_path = public, extensions;

create table if not exists public.activity_events (
  id          bigserial primary key,
  kind        text not null check (kind in ('view', 'search', 'cart_add')),
  product_id  uuid references public.catalog_products(id) on delete cascade,
  query       text,
  results     int,
  city_id     int,
  created_at  timestamptz not null default now()
);
create index if not exists activity_events_kind_time on public.activity_events (kind, created_at);
alter table public.activity_events enable row level security;   -- no policies: written and read only by functions

-- product views keep their daily counter and now also leave a timed event
create or replace function public.track_view(p_product uuid) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into product_views (product_id, day, views)
  select p.id, current_date, 1 from catalog_products p where p.id = p_product and p.is_active
  on conflict (product_id, day) do update set views = product_views.views + 1;
  insert into activity_events (kind, product_id)
  select 'view', p.id from catalog_products p where p.id = p_product and p.is_active;
$$;

create or replace function public.track_event(p_kind text, p_product uuid default null, p_query text default null,
                                              p_results int default null, p_city int default null) returns void
language sql volatile security definer set search_path = public, pg_temp as $$
  insert into activity_events (kind, product_id, query, results, city_id)
  select p_kind, p_product, nullif(left(lower(trim(p_query)), 80), ''), p_results, p_city
  where p_kind in ('search', 'cart_add')
    and (p_kind <> 'search' or coalesce(trim(p_query), '') <> '')
    and (p_product is null or exists (select 1 from catalog_products where id = p_product));
$$;
grant execute on function public.track_event(text, uuid, text, int, int) to anon, authenticated;

-- each user's widget layout per dashboard ('platform' or a pharmacy id)
create table if not exists public.dashboard_layouts (
  user_id     uuid not null references auth.users(id) on delete cascade,
  scope       text not null,
  widgets     jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, scope)
);
alter table public.dashboard_layouts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dashboard_layouts' and policyname = 'own') then
    create policy own on public.dashboard_layouts for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
grant select, insert, update, delete on public.dashboard_layouts to authenticated;

-- ---------------------------------------------------------------- metrics
-- Everything a dashboard shows, for Dorva (p_pharmacy null) or one pharmacy.
create or replace function public.dash_metrics(p_pharmacy uuid default null, p_days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  v_days int := least(greatest(coalesce(p_days, 30), 1), 366);
  v_from timestamptz := date_trunc('day', now() at time zone 'Asia/Tehran') at time zone 'Asia/Tehran' - make_interval(days => v_days - 1);
  v_out jsonb;
begin
  if p_pharmacy is null then
    if not app.has_platform_permission('pharmacy.read_all') then raise exception 'forbidden' using errcode = '42501'; end if;
  elsif not (app.pharmacy_access(p_pharmacy, 'order.read') or app.has_platform_permission('pharmacy.read_all')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  with parts as (
    select op.*, o.user_id, o.paid_at, o.city_id
    from order_parts op join orders o on o.id = op.order_id
    where o.paid_at >= v_from and op.status <> 'awaiting_payment'
      and (p_pharmacy is null or op.pharmacy_id = p_pharmacy)
  ),
  live as (select * from parts where status <> 'cancelled'),
  items as (
    select i.*, l.pharmacy_id, l.paid_at, l.status part_status, p.category_path, p.facets
    from order_items i join live l on l.id = i.part_id join catalog_products p on p.id = i.product_id
    where i.tech_status <> 'rejected'
  ),
  st as (select s.*, p.status part_status from settlements s join parts p on p.id = s.part_id),
  buyers as (select distinct user_id from parts),
  first_order as (
    select o.user_id, min(o.paid_at) first_paid, count(*) n_orders from orders o
    where o.user_id in (select user_id from buyers) and o.paid_at is not null group by o.user_id
  ),
  stock as (
    select s.*, (s.discount_pct > coalesce(c.cap, 0)) clipped from stock_items s
    left join app.product_caps c on c.product_id = s.product_id
    where p_pharmacy is null or s.pharmacy_id = p_pharmacy
  ),
  my_products as (
    select distinct product_id from stock_items where p_pharmacy is not null and pharmacy_id = p_pharmacy
  ),
  views as (
    select v.product_id, sum(v.views)::int n from product_views v
    where v.day >= (v_from at time zone 'Asia/Tehran')::date
      and (p_pharmacy is null or v.product_id in (select product_id from my_products))
    group by v.product_id
  ),
  ev as (
    select e.* from activity_events e where e.created_at >= v_from
      and (p_pharmacy is null or e.product_id in (select product_id from my_products) or e.kind = 'search')
  ),
  tech as (
    select extract(epoch from (i.tech_at - p.paid_at)) / 60 mins, i.tech_status
    from order_items i join parts p on p.id = i.part_id
    where i.tech_status in ('approved', 'rejected') and i.tech_at is not null
  ),
  days as (
    select generate_series((v_from at time zone 'Asia/Tehran')::date, (now() at time zone 'Asia/Tehran')::date, interval '1 day')::date d
  )
  select jsonb_build_object(
    'days', v_days,
    'sales', jsonb_build_object(
      'orders', (select count(distinct order_id) from live),
      'parts', (select count(*) from live),
      'items_total', coalesce((select sum(line_total) from items), 0),
      'units', coalesce((select sum(qty) from items), 0),
      'shipping', coalesce((select sum(shipping_fee) from live), 0),
      'gross', coalesce((select sum(line_total) from items), 0) + coalesce((select sum(shipping_fee) from live), 0),
      'avg_basket', case when (select count(distinct order_id) from live) > 0
        then round((coalesce((select sum(line_total) from items), 0) + coalesce((select sum(shipping_fee) from live), 0))
                   / (select count(distinct order_id) from live), -3) else 0 end),
    'finance', jsonb_build_object(
      'held', coalesce((select sum(pharmacy_amount + dorva_amount + logistics_amount) from st
                        where part_status in ('pending_tech', 'preparing', 'shipped')), 0),
      'released', coalesce((select sum(pharmacy_amount + dorva_amount + logistics_amount) from st where status = 'released'), 0),
      'refunded', coalesce((select sum(e.amount) from payment_events e
                            where e.kind = 'refund' and e.created_at >= v_from
                              and (p_pharmacy is null or e.part_id in (select id from parts))), 0),
      'dorva', coalesce((select sum(dorva_amount) from st where status = 'released'), 0),
      'pharmacy', coalesce((select sum(pharmacy_amount) from st where status = 'released'), 0),
      'logistics', coalesce((select sum(logistics_amount) from st where status = 'released'), 0)),
    'ops', jsonb_build_object(
      'tech_median_min', (select round(percentile_cont(0.5) within group (order by mins)::numeric, 1) from tech),
      'tech_reviewed', (select count(*) from tech),
      'tech_rejected', (select count(*) from tech where tech_status = 'rejected'),
      'cancelled', (select coalesce(jsonb_object_agg(r, n), '{}'::jsonb) from
                     (select coalesce(cancel_reason, 'other') r, count(*) n from parts where status = 'cancelled' group by 1) x),
      'reassigned', (select count(*) from parts where reassign_count > 0),
      'delivered', (select count(*) from parts where status = 'delivered'),
      'delivery_hours', (select round(avg(extract(epoch from (delivered_at - paid_at)) / 3600)::numeric, 1)
                         from parts where status = 'delivered' and delivered_at is not null),
      'wrong_codes', coalesce((select sum(c.attempts) from order_delivery_codes c where c.part_id in (select id from parts)), 0),
      'pending_tech_now', (select count(*) from order_parts op where op.status = 'pending_tech'
                             and (p_pharmacy is null or op.pharmacy_id = p_pharmacy)),
      'overdue_now', (select count(*) from order_parts op where op.status = 'pending_tech'
                        and (p_pharmacy is null or op.pharmacy_id = p_pharmacy) and app.tech_deadline(op.id) < now())),
    'inventory', jsonb_build_object(
      'lines', (select count(*) from stock),
      'out', (select count(*) from stock where quantity = 0),
      'low', (select count(*) from stock where quantity between 1 and 2),
      'clipped', (select count(*) from stock where clipped)),
    'customers', jsonb_build_object(
      'buyers', (select count(*) from buyers),
      'new', (select count(*) from first_order where first_paid >= v_from),
      'repeat', (select count(*) from first_order where n_orders > 1)),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                 'd', d,
                 'orders', (select count(distinct order_id) from live where (paid_at at time zone 'Asia/Tehran')::date = d),
                 'revenue', coalesce((select sum(line_total) from items where (paid_at at time zone 'Asia/Tehran')::date = d), 0)
                            + coalesce((select sum(shipping_fee) from live where (paid_at at time zone 'Asia/Tehran')::date = d), 0),
                 'refunds', coalesce((select sum(e.amount) from payment_events e where e.kind = 'refund'
                                       and (e.created_at at time zone 'Asia/Tehran')::date = d
                                       and (p_pharmacy is null or e.part_id in (select id from parts))), 0))
               order by d), '[]'::jsonb) from days),
    'top_products', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
        select i.name_fa name, sum(i.qty)::int units, sum(i.line_total) revenue from items i
        group by i.product_id, i.name_fa order by sum(i.line_total) desc limit 10) x),
    'top_categories', (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
        select coalesce(category_path[1], '—') name, sum(qty)::int units, sum(line_total) revenue from items
        group by 1 order by 3 desc limit 10) x),
    'top_pharmacies', case when p_pharmacy is null then (select coalesce(jsonb_agg(x order by x.revenue desc), '[]'::jsonb) from (
        select ph.name_fa name, count(distinct l.order_id)::int orders,
               coalesce(sum((select sum(line_total) from order_items i where i.part_id = l.id and i.tech_status <> 'rejected')), 0) revenue
        from live l join pharmacies ph on ph.id = l.pharmacy_id group by ph.id, ph.name_fa order by 3 desc limit 10) x) else '[]'::jsonb end,
    'cities', case when p_pharmacy is null then (select coalesce(jsonb_agg(x order by x.orders desc), '[]'::jsonb) from (
        select coalesce(c.name_fa, '—') name, count(distinct l.order_id)::int orders from live l left join cities c on c.id = l.city_id
        group by c.name_fa order by 2 desc limit 10) x) else '[]'::jsonb end,
    'funnel', jsonb_build_object(
      'views', coalesce((select sum(n) from views), 0),
      'cart_adds', (select count(*) from ev where kind = 'cart_add'),
      'ordered_units', coalesce((select sum(qty) from items), 0),
      'orders', (select count(distinct order_id) from live)),
    'heat_orders', (select coalesce(jsonb_agg(jsonb_build_array(dw, hr, n)), '[]'::jsonb) from (
        select extract(dow from paid_at at time zone 'Asia/Tehran')::int dw, extract(hour from paid_at at time zone 'Asia/Tehran')::int hr,
               count(distinct order_id)::int n from live group by 1, 2) x),
    'heat_views', (select coalesce(jsonb_agg(jsonb_build_array(dw, hr, n)), '[]'::jsonb) from (
        select extract(dow from created_at at time zone 'Asia/Tehran')::int dw, extract(hour from created_at at time zone 'Asia/Tehran')::int hr,
               count(*)::int n from ev where kind = 'view' group by 1, 2) x),
    'taste', (select coalesce(jsonb_agg(x order by x.bought desc, x.viewed desc), '[]'::jsonb) from (
        select cat name,
               coalesce(sum(vw), 0)::int viewed, coalesce(sum(bt), 0)::int bought
        from (
          select coalesce(p.category_path[1], '—') cat, v.n vw, 0 bt from views v join catalog_products p on p.id = v.product_id
          union all
          select coalesce(category_path[1], '—'), 0, qty from items
        ) u group by cat order by 3 desc, 2 desc limit 12) x),
    'brands', (select coalesce(jsonb_agg(x order by x.units desc), '[]'::jsonb) from (
        select coalesce(fv.name_fa, b.code) name, sum(i.qty)::int units
        from items i
        cross join lateral (select jsonb_array_elements_text(case jsonb_typeof(i.facets->'brand') when 'array' then i.facets->'brand'
                                                                   when 'string' then jsonb_build_array(i.facets->'brand') else '[]'::jsonb end) code) b
        left join catalog_facet_values fv on fv.facet_key = 'brand' and fv.value_code = b.code
        group by 1 order by 2 desc limit 10) x),
    'classes', (select coalesce(jsonb_object_agg(dispensing_class, units), '{}'::jsonb) from (
        select dispensing_class, sum(qty)::int units from items group by 1) x),
    'searches', case when p_pharmacy is null then (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select query q, count(*)::int n, max(results) results from ev where kind = 'search' group by query order by 2 desc limit 12) x) else '[]'::jsonb end,
    'no_results', case when p_pharmacy is null then (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from (
        select query q, count(*)::int n from ev where kind = 'search' and coalesce(results, 0) = 0 group by query order by 2 desc limit 12) x) else '[]'::jsonb end
  ) into v_out;
  return v_out;
end $$;
grant execute on function public.dash_metrics(uuid, int) to authenticated;

-- ---------------------------------------------------------------- holding stats fix
-- items of cancelled parts no longer count toward a holding's sales
create or replace function public.holding_stats(p_holding uuid, p_days int default 30)
returns table (pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, orders int, delivered int, cancelled int,
               items_total numeric, shipping_total numeric, dorva_amount numeric, pharmacy_amount numeric,
               tech_reviewed int, tech_rejected int, stock_lines int, out_of_stock int)
language sql stable security definer set search_path = public, pg_temp as $$
  with ph as (
    select p.* from public.holding_links l join public.pharmacies p on p.id = l.pharmacy_id
    where l.holding_id = p_holding and l.status = 'active' and app.holding_member(p_holding)
  ),
  parts as (
    select op.* from public.order_parts op join public.orders o on o.id = op.order_id
    where op.pharmacy_id in (select id from ph) and op.status <> 'awaiting_payment'
      and o.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 366))
  )
  select ph.id, ph.slug::text, ph.name_fa, ph.name_i18n,
         (select count(*) from parts x where x.pharmacy_id = ph.id)::int,
         (select count(*) from parts x where x.pharmacy_id = ph.id and x.status = 'delivered')::int,
         (select count(*) from parts x where x.pharmacy_id = ph.id and x.status = 'cancelled')::int,
         coalesce((select sum(i.line_total) from public.order_items i join parts x on x.id = i.part_id
                   where x.pharmacy_id = ph.id and x.status <> 'cancelled' and i.tech_status <> 'rejected'), 0),
         coalesce((select sum(x.shipping_fee) from parts x where x.pharmacy_id = ph.id and x.status <> 'cancelled'), 0),
         coalesce((select sum(s.dorva_amount) from public.settlements s join parts x on x.id = s.part_id where x.pharmacy_id = ph.id), 0),
         coalesce((select sum(s.pharmacy_amount) from public.settlements s join parts x on x.id = s.part_id where x.pharmacy_id = ph.id), 0),
         (select count(*) from public.order_items i join parts x on x.id = i.part_id
           where x.pharmacy_id = ph.id and i.tech_status in ('approved', 'rejected'))::int,
         (select count(*) from public.order_items i join parts x on x.id = i.part_id
           where x.pharmacy_id = ph.id and i.tech_status = 'rejected')::int,
         (select count(*) from public.stock_items s where s.pharmacy_id = ph.id)::int,
         (select count(*) from public.stock_items s where s.pharmacy_id = ph.id and s.quantity = 0)::int
  from ph order by ph.name_fa;
$$;
