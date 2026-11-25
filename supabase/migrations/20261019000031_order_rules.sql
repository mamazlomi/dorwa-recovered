-- Remaining order rules:
--   1. split orders: shipping rule when one order has several local deliveries;
--   2. the customer may cancel before the parcel leaves (configurable);
--   3. the technical officer's deadline: on timeout the part is reassigned to
--      another pharmacy (same or lower price) or cancelled and refunded;
--   4. (invitation e-mails are sent by the app, not here).

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('shipping.split_rule', 'shipping', 'enum',
   '[{"value":"each","label":{"fa":"هر ارسال جدا و کامل","en":"Each delivery in full","ar":"كل توصيل كاملاً"}},
     {"value":"max_only","label":{"fa":"فقط گران‌ترین ارسال","en":"Only the dearest delivery","ar":"التوصيل الأغلى فقط"}},
     {"value":"discount_extra","label":{"fa":"تخفیف درصدی روی ارسال‌های بعدی","en":"Discount on the extra deliveries","ar":"خصم على التوصيلات الإضافية"}}]',
   null, null, null,
   '{"fa":"هزینه ارسال در سفارش چند داروخانه‌ای","en":"Shipping in a multi-pharmacy order","ar":"الشحن في طلب متعدد الصيدليات"}',
   '{"fa":"وقتی سبد بین چند داروخانه تقسیم می‌شود. گران‌ترین ارسال همیشه کامل حساب می‌شود.","en":"When a cart is split between pharmacies. The dearest delivery is always charged in full.","ar":"عند تقسيم السلة بين صيدليات. يُحسب التوصيل الأغلى كاملاً دائماً."}', 506),
  ('shipping.split_extra_discount_pct', 'shipping', 'number', null, 0, 100, '{"fa":"٪","en":"%","ar":"٪"}',
   '{"fa":"درصد تخفیف ارسال‌های بعدی","en":"Discount on extra deliveries","ar":"نسبة خصم التوصيلات الإضافية"}',
   '{"fa":"فقط وقتی قانون «تخفیف درصدی» انتخاب شده باشد.","en":"Only with the discount rule.","ar":"فقط مع قاعدة الخصم."}', 507),
  ('shipping.split_subsidy_by', 'shipping', 'enum',
   '[{"value":"dorva","label":{"fa":"دوروا (از کارمزد کم می‌شود)","en":"Dorva (from its commission)","ar":"دوروا (من عمولتها)"}},
     {"value":"provider","label":{"fa":"ارسال‌کننده (پیک یا داروخانه)","en":"The courier (pharmacy or Dorva)","ar":"الموصّل"}}]',
   null, null, null,
   '{"fa":"تخفیف ارسال را چه کسی می‌پردازد","en":"Who pays the shipping discount","ar":"من يتحمل خصم الشحن"}',
   '{"fa":"با «دوروا» پیک مبلغ کامل را می‌گیرد و تفاوت از کارمزد دوروا کم می‌شود.","en":"With Dorva, the courier is paid in full and the difference comes out of Dorva''s fee.","ar":"مع دوروا يحصل الموصّل على المبلغ كاملاً ويُخصم الفرق من عمولة دوروا."}', 508),
  ('order.customer_cancel', 'cart', 'enum',
   '[{"value":"before_ship","label":{"fa":"تا قبل از تحویل به پیک","en":"Until handed to the courier","ar":"حتى التسليم للمندوب"}},
     {"value":"before_tech","label":{"fa":"فقط قبل از تأیید مسئول فنی","en":"Only before technical approval","ar":"فقط قبل الموافقة الفنية"}},
     {"value":"never","label":{"fa":"لغو توسط مشتری ممکن نیست","en":"Customers cannot cancel","ar":"لا يمكن للعميل الإلغاء"}}]',
   null, null, null,
   '{"fa":"لغو سفارش توسط مشتری","en":"Customer cancellation","ar":"إلغاء الطلب من العميل"}',
   '{"fa":"مبلغ کالا و ارسال همان بخش برمی‌گردد و موجودی به داروخانه بازمی‌گردد.","en":"Items and shipping of that part are refunded and restocked.","ar":"تُسترد قيمة الأصناف والشحن ويُعاد المخزون."}', 125),
  ('tech_approval.max_reassign', 'prescription', 'number', null, 0, 10, null,
   '{"fa":"حداکثر ارجاع به داروخانه دیگر","en":"Maximum reassignments","ar":"أقصى عدد للإحالة"}',
   '{"fa":"بعد از این تعداد ارجاع، بخش سفارش لغو و مبلغ برگردانده می‌شود. فقط داروخانه‌ای انتخاب می‌شود که همه اقلام را با قیمت برابر یا کمتر دارد؛ تفاوت قیمت به مشتری برمی‌گردد.","en":"After this many reassignments the part is cancelled and refunded. Only a pharmacy with every item at the same or a lower price is chosen; any difference is refunded.","ar":"بعد هذا العدد يُلغى الجزء ويُسترد المبلغ. تُختار فقط صيدلية لديها كل الأصناف بالسعر نفسه أو أقل؛ ويُعاد الفرق."}', 225)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('shipping.split_rule',              'platform', '"each"',        'هزینه ارسال در سفارش چند داروخانه‌ای'),
  ('shipping.split_extra_discount_pct','platform', '50',            'درصد تخفیف ارسال‌های بعدی'),
  ('shipping.split_subsidy_by',        'platform', '"dorva"',       'تخفیف ارسال را چه کسی می‌پردازد'),
  ('order.customer_cancel',            'platform', '"before_ship"', 'لغو سفارش توسط مشتری'),
  ('tech_approval.max_reassign',       'platform', '2',             'حداکثر ارجاع به داروخانه دیگر')
on conflict do nothing;

alter table public.order_parts add column if not exists shipping_full numeric;
alter table public.order_parts add column if not exists subsidy_by text not null default 'dorva' check (subsidy_by in ('dorva', 'provider'));
alter table public.order_parts add column if not exists cancel_reason text check (cancel_reason in ('customer', 'tech_rejected', 'tech_timeout'));
alter table public.order_parts add column if not exists tech_deadline timestamptz;
alter table public.order_parts add column if not exists reassign_count int not null default 0;
alter table public.order_parts add column if not exists tried_pharmacies uuid[] not null default '{}';

-- ---------------------------------------------------------------- 1. split shipping
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
  v_rule text := coalesce(app.setting('shipping.split_rule') #>> '{}', 'each');
  v_pct  numeric := least(greatest(app.setting_num('shipping.split_extra_discount_pct', 50), 0), 100);
  v_maxi int; v_new jsonb := '[]'::jsonb; v_e jsonb; v_i int := 0; v_full numeric;
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

  -- several local deliveries in one order: the dearest is charged in full, the others by the split rule
  if v_plan->>'strategy' <> 'intercity' and jsonb_array_length(v_ph) > 1 and v_rule <> 'each' then
    select (x.ord - 1)::int into v_maxi from jsonb_array_elements(v_ph) with ordinality as x(e, ord)
    order by (x.e->>'shipping')::numeric desc, x.ord limit 1;
    for v_e in select e from jsonb_array_elements(v_ph) as x(e) loop
      v_full := (v_e->>'shipping')::numeric;
      v_new := v_new || jsonb_build_array(v_e || jsonb_build_object('shipping_full', v_full, 'shipping',
        case when v_i = v_maxi then v_full when v_rule = 'max_only' then 0
             else round(v_full * (100 - v_pct) / 100, -4) end));
      v_i := v_i + 1;
    end loop;
    v_ph := v_new;
  else
    select coalesce(jsonb_agg(e || jsonb_build_object('shipping_full', e->'shipping') order by ord), '[]'::jsonb) into v_ph
    from jsonb_array_elements(v_ph) with ordinality as x(e, ord);
  end if;

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
    insert into public.order_parts (order_id, pharmacy_id, seq, kind, subtotal, shipping_fee, distance_km, eta, min_days, max_days, shipping_provider,
                                    shipping_full, subsidy_by)
    values (v_order, (ph->>'pharmacy_id')::uuid, n, ph->>'kind', (ph->>'subtotal')::numeric, (ph->>'shipping')::numeric,
            (ph->>'distance_km')::numeric, ph->>'eta', (ph->>'min_days')::int, (ph->>'max_days')::int,
            coalesce(ph->>'provider', 'dorva'),
            coalesce((ph->>'shipping_full')::numeric, (ph->>'shipping')::numeric),
            coalesce(app.setting('shipping.split_subsidy_by') #>> '{}', 'dorva'))
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

create or replace function app.refresh_settlement(p_part uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_items numeric; v_dorva numeric; p public.order_parts; v_logi numeric; v_sub numeric;
begin
  select coalesce(sum(i.line_total), 0), coalesce(sum(round(i.line_total * app.commission_pct(i.dispensing_class) / 100, -3)), 0)
    into v_items, v_dorva
  from public.order_items i where i.part_id = p_part and i.tech_status <> 'rejected';
  select * into p from public.order_parts where id = p_part;
  -- the courier gets the full fee; a split-order discount is paid by Dorva or by the courier (snapshot on the part)
  v_sub := greatest(coalesce(p.shipping_full, p.shipping_fee) - p.shipping_fee, 0);
  if p.status = 'cancelled' then v_logi := 0; v_sub := 0;
  elsif p.subsidy_by = 'provider' then v_logi := p.shipping_fee; v_sub := 0;
  else v_logi := coalesce(p.shipping_full, p.shipping_fee); end if;
  if p.status = 'cancelled' then v_items := 0; v_dorva := 0; end if;
  insert into public.settlements (part_id, pharmacy_amount, dorva_amount, logistics_amount, logistics_payee)
  values (p_part, v_items - v_dorva, v_dorva - v_sub, v_logi, p.shipping_provider)
  on conflict (part_id) do update set pharmacy_amount = excluded.pharmacy_amount,
    dorva_amount = excluded.dorva_amount, logistics_amount = excluded.logistics_amount, logistics_payee = excluded.logistics_payee;
end $$;

-- ---------------------------------------------------------------- shared: cancel one part and refund it
create or replace function app.cancel_part(p_part uuid, p_reason text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.order_parts; v_refund numeric;
begin
  select * into p from public.order_parts where id = p_part for update;
  if p.status in ('cancelled', 'delivered', 'shipped', 'awaiting_payment') then return; end if;
  -- items not yet rejected go back to stock and are refunded with the shipping
  update public.stock_items s set quantity = s.quantity + i.qty
  from public.order_items i where i.part_id = p.id and i.tech_status <> 'rejected'
    and s.pharmacy_id = p.pharmacy_id and s.product_id = i.product_id;
  select coalesce(sum(line_total), 0) + p.shipping_fee into v_refund
  from public.order_items where part_id = p.id and tech_status <> 'rejected';
  update public.order_parts set status = 'cancelled', cancel_reason = p_reason where id = p.id;
  perform app.refund(p.order_id, p.id, v_refund, p_note);
  perform app.refresh_settlement(p.id);
  update public.settlements set status = 'refunded' where part_id = p.id;
  perform app.finish_order_if_done(p.order_id);
end $$;

-- ---------------------------------------------------------------- 2. customer cancellation
create or replace function app.customer_can_cancel(p_status text) returns boolean
language sql stable as $$
  select case coalesce(app.setting('order.customer_cancel') #>> '{}', 'before_ship')
    when 'before_ship' then p_status in ('pending_tech', 'preparing')
    when 'before_tech' then p_status = 'pending_tech'
    else false end;
$$;

create or replace function public.order_cancel(p_order uuid, p_part uuid default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders; r record; n int := 0;
begin
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if o.status = 'awaiting_payment' then
    update public.orders set status = 'cancelled' where id = o.id;
    update public.payments set status = 'failed', updated_at = now() where order_id = o.id;
    return 'cancelled';
  end if;
  for r in select id, status from public.order_parts where order_id = o.id and (p_part is null or id = p_part) for update loop
    if app.customer_can_cancel(r.status) then
      perform app.cancel_part(r.id, 'customer', 'cancelled by customer');
      n := n + 1;
    end if;
  end loop;
  return case when n > 0 then 'cancelled' else 'not_allowed' end;
end $$;
grant execute on function public.order_cancel(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 3. technical officer deadline
create or replace function app.tech_deadline(p_part uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p.tech_deadline, o.paid_at + make_interval(mins => app.setting_num('tech_approval.window_min', 15)::int))
  from public.order_parts p join public.orders o on o.id = p.order_id where p.id = p_part;
$$;

-- move a timed-out part to another pharmacy that has every item at the same or a lower total
create or replace function app.reassign_part(p_part uuid) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p public.order_parts; o public.orders; v_items jsonb; v_paid numeric; c record; v_new_sum numeric;
begin
  select * into p from public.order_parts where id = p_part for update;
  select * into o from public.orders where id = p.order_id;
  if p.kind <> 'local' or p.reassign_count >= app.setting_num('tech_approval.max_reassign', 2) then return false; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty)), sum(line_total)
    into v_items, v_paid
  from public.order_items where part_id = p.id and tech_status <> 'rejected';
  if v_items is null then return false; end if;

  select x.pharmacy_id, x.distance_km, x.subtotal into c
  from public.cart_candidates(v_items, o.city_id, (o.address->>'lat')::float8, (o.address->>'lng')::float8, 100) x
  where x.covered = x.total and x.pharmacy_id <> p.pharmacy_id and not (x.pharmacy_id = any(p.tried_pharmacies))
    and x.subtotal <= v_paid
  order by x.distance_km nulls last, x.subtotal
  limit 1;
  if c.pharmacy_id is null then return false; end if;

  -- stock back to the old pharmacy, taken from the new one
  update public.stock_items s set quantity = s.quantity + i.qty
  from public.order_items i where i.part_id = p.id and i.tech_status <> 'rejected'
    and s.pharmacy_id = p.pharmacy_id and s.product_id = i.product_id;
  update public.stock_items s set quantity = s.quantity - i.qty
  from public.order_items i where i.part_id = p.id and i.tech_status <> 'rejected'
    and s.pharmacy_id = c.pharmacy_id and s.product_id = i.product_id;
  -- new prices; every item needing approval waits for the new pharmacy's officer
  update public.order_items i set unit_price = ofr.final_price, list_price = ofr.list_price, discount_pct = ofr.discount_pct,
    line_total = ofr.final_price * i.qty,
    tech_status = case when i.tech_status in ('approved', 'pending') then 'pending' else i.tech_status end,
    tech_note = null, tech_by = null, tech_at = null
  from app.offers ofr where i.part_id = p.id and i.tech_status <> 'rejected'
    and ofr.pharmacy_id = c.pharmacy_id and ofr.product_id = i.product_id;
  select sum(line_total) into v_new_sum from public.order_items where part_id = p.id and tech_status <> 'rejected';
  if v_paid - v_new_sum > 0 then
    perform app.refund(p.order_id, p.id, v_paid - v_new_sum, 'reassigned to a pharmacy with a lower price');
  end if;
  update public.order_parts set pharmacy_id = c.pharmacy_id, distance_km = c.distance_km,
    subtotal = (select sum(line_total) from public.order_items where part_id = p.id),
    shipping_provider = app.ph_ship_provider(c.pharmacy_id, 'local'),
    tried_pharmacies = tried_pharmacies || p.pharmacy_id, reassign_count = reassign_count + 1,
    tech_deadline = now() + make_interval(mins => app.setting_num('tech_approval.window_min', 15)::int),
    status = case when exists (select 1 from public.order_items where part_id = p.id and tech_status = 'pending') then 'pending_tech' else 'preparing' end
  where id = p.id;
  insert into public.pharmacy_daily_load (pharmacy_id, day, orders) values (c.pharmacy_id, current_date, 1)
  on conflict (pharmacy_id, day) do update set orders = public.pharmacy_daily_load.orders + 1;
  perform app.refresh_settlement(p.id);
  return true;
end $$;

-- handle every part whose officer did not answer in time; safe to call often
create or replace function public.tech_timeouts_tick() returns int
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select p.id from public.order_parts p join public.orders o on o.id = p.order_id
           where p.status = 'pending_tech' and app.tech_deadline(p.id) < now()
           for update of p skip locked loop
    if coalesce(app.setting('tech_approval.on_timeout') #>> '{}', 'reassign') = 'reassign' and app.reassign_part(r.id) then
      null;
    else
      perform app.cancel_part(r.id, 'tech_timeout', 'technical officer did not answer in time');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.tech_timeouts_tick() to authenticated;

-- parts cancelled by the technical review carry their reason
create or replace function app.part_cancel_reason() returns trigger
language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.cancel_reason is null then
    new.cancel_reason := 'tech_rejected';
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'part_cancel_reason_trg') then
    create trigger part_cancel_reason_trg before update of status on public.order_parts
      for each row execute function app.part_cancel_reason();
  end if;
end $$;
