-- Orders, escrow-style payment (test gateway for now), technical approval,
-- delivery code and settlement.
--
-- Flow (payment model decided by the owner):
--   place_order        cart -> order (awaiting_payment); prices are recomputed here, never trusted from the browser
--   test_gateway_complete  money is HELD by the bank (here: simulated); stock is taken
--   tech_review        the technical officer approves/rejects supplement & OTC lines;
--                      rejected lines are refunded and returned to stock
--   part_ship / part_deliver  the courier enters the customer's delivery code;
--                      only then the held money is released and split
--                      (pharmacy / Dorva commission / logistics)
-- All writes go through these functions; tables are read-only to clients.

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('payment.gateway', 'payment', 'enum',
   '[{"value":"test","label":{"fa":"درگاه آزمایشی (بدون پول واقعی)","en":"Test gateway (no real money)","ar":"بوابة تجريبية (دون مال حقيقي)"}}]',
   null, null, null,
   '{"fa":"درگاه پرداخت","en":"Payment gateway","ar":"بوابة الدفع"}',
   '{"fa":"تا اتصال بانک، پرداخت شبیه‌سازی می‌شود: پول «نزد بانک نگه داشته» و پس از ورود کد تحویل آزاد می‌شود.","en":"Until the bank is connected, payment is simulated: money is held and released after the delivery code.","ar":"حتى ربط البنك يُحاكى الدفع: يُحجز المال ويُحرر بعد رمز التسليم."}', 320),
  ('payment.pay_window_min', 'payment', 'number', null, 5, 1440, '{"fa":"دقیقه","en":"min","ar":"دقيقة"}',
   '{"fa":"مهلت پرداخت سفارش","en":"Time to pay an order","ar":"مهلة دفع الطلب"}',
   '{"fa":"سفارش پرداخت‌نشده پس از این مدت باطل می‌شود.","en":"Unpaid orders expire after this.","ar":"تنتهي الطلبات غير المدفوعة بعد ذلك."}', 330),
  ('commission.general_pct', 'payment', 'number', null, 0, 50, '{"fa":"درصد","en":"%","ar":"٪"}',
   '{"fa":"کارمزد دوروا: کالای عمومی","en":"Dorva commission: general","ar":"عمولة دوروا: عام"}', null, 340),
  ('commission.supplement_pct', 'payment', 'number', null, 0, 50, '{"fa":"درصد","en":"%","ar":"٪"}',
   '{"fa":"کارمزد دوروا: مکمل","en":"Dorva commission: supplements","ar":"عمولة دوروا: مكملات"}', null, 350),
  ('commission.otc_pct', 'payment', 'number', null, 0, 50, '{"fa":"درصد","en":"%","ar":"٪"}',
   '{"fa":"کارمزد دوروا: داروی بدون نسخه","en":"Dorva commission: OTC","ar":"عمولة دوروا: دون وصفة"}', null, 360),
  ('delivery.code_max_attempts', 'delivery', 'number', null, 1, 20, null,
   '{"fa":"حداکثر تلاش برای کد تحویل","en":"Delivery code attempts","ar":"محاولات رمز التسليم"}',
   '{"fa":"پس از این تعداد کد اشتباه، کد قفل می‌شود و پشتیبانی باید بررسی کند.","en":"After this many wrong codes the code locks for support review.","ar":"بعد هذا العدد من الأخطاء يُقفل الرمز للمراجعة."}', 430)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('payment.gateway', 'platform', '"test"', 'درگاه پرداخت'),
  ('payment.pay_window_min', 'platform', '30', 'مهلت پرداخت سفارش'),
  ('commission.general_pct', 'platform', '5', 'کارمزد کالای عمومی'),
  ('commission.supplement_pct', 'platform', '5', 'کارمزد مکمل'),
  ('commission.otc_pct', 'platform', '2', 'کارمزد داروی بدون نسخه'),
  ('delivery.code_max_attempts', 'platform', '5', 'حداکثر تلاش کد تحویل')
on conflict do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('delivery.code_ttl_hours', 'platform', '72', 'اعتبار کد تحویل')
on conflict do nothing;

-- ---------------------------------------------------------------- tables
create sequence if not exists public.order_no_seq;

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       text not null unique,
  user_id        uuid not null references auth.users(id),
  status         text not null default 'awaiting_payment'
                 check (status in ('awaiting_payment','paid','completed','cancelled','expired')),
  address        jsonb not null,
  city_id        int references public.cities(id),
  items_total    numeric(14,0) not null,
  shipping_total numeric(14,0) not null,
  grand_total    numeric(14,0) not null,
  refunded_total numeric(14,0) not null default 0,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  paid_at        timestamptz
);
create index if not exists orders_user on public.orders(user_id, created_at desc);

create table if not exists public.order_parts (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  pharmacy_id  uuid not null references public.pharmacies(id),
  seq          int not null,
  kind         text not null check (kind in ('local','intercity')),
  status       text not null default 'awaiting_payment'
               check (status in ('awaiting_payment','pending_tech','preparing','shipped','delivered','cancelled')),
  subtotal     numeric(14,0) not null,
  shipping_fee numeric(14,0) not null,
  distance_km  numeric,
  eta          text,
  min_days     int,
  max_days     int,
  shipped_at   timestamptz,
  delivered_at timestamptz
);
create index if not exists order_parts_pharmacy on public.order_parts(pharmacy_id, status);
create index if not exists order_parts_order on public.order_parts(order_id);

create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  part_id       uuid not null references public.order_parts(id) on delete cascade,
  product_id    uuid not null references public.catalog_products(id),
  name_fa       text not null,
  dispensing_class text not null,
  qty           int not null check (qty > 0),
  unit_price    numeric(14,0) not null,
  list_price    numeric(14,0),
  discount_pct  numeric(5,2) not null default 0,
  line_total    numeric(14,0) not null,
  tech_status   text not null check (tech_status in ('na','pending','approved','rejected')),
  tech_note     text check (tech_note is null or length(tech_note) <= 300),
  tech_by       uuid references auth.users(id),
  tech_at       timestamptz
);
create index if not exists order_items_part on public.order_items(part_id);

-- the delivery code is the customer's secret: only they can read it
create table if not exists public.order_delivery_codes (
  part_id    uuid primary key references public.order_parts(id) on delete cascade,
  code       text not null,
  expires_at timestamptz not null,
  attempts   int not null default 0
);

create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null unique references public.orders(id) on delete cascade,
  gateway    text not null,
  amount     numeric(14,0) not null,
  status     text not null default 'initiated'
             check (status in ('initiated','held','partially_refunded','refunded','released','failed')),
  gateway_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id         bigint generated always as identity primary key,
  payment_id uuid not null references public.payments(id) on delete cascade,
  part_id    uuid references public.order_parts(id),
  kind       text not null check (kind in ('hold','refund','release','fail')),
  amount     numeric(14,0) not null,
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.settlements (
  part_id          uuid primary key references public.order_parts(id) on delete cascade,
  pharmacy_amount  numeric(14,0) not null default 0,
  dorva_amount     numeric(14,0) not null default 0,
  logistics_amount numeric(14,0) not null default 0,
  status           text not null default 'pending' check (status in ('pending','released','refunded')),
  released_at      timestamptz
);

-- ---------------------------------------------------------------- access
-- a pharmacy's own staff with the permission; Dorva admins may operate the
-- virtual (test) pharmacies so the whole flow can be tested end to end
create or replace function app.pharmacy_access(p_pharmacy uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_pharmacy_permission(p_pharmacy, p_perm)
      or (app.has_platform_permission('pharmacy.read_all')
          and exists (select 1 from public.pharmacies where id = p_pharmacy and is_virtual));
$$;

create or replace function app.order_owner(p_order uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.orders where id = p_order and user_id = auth.uid());
$$;

create or replace function app.part_visible(p_part uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.order_parts p join public.orders o on o.id = p.order_id
                 where p.id = p_part and (o.user_id = auth.uid() or app.pharmacy_access(p.pharmacy_id, 'order.read')));
$$;

alter table public.orders               enable row level security;
alter table public.order_parts          enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_delivery_codes enable row level security;
alter table public.payments             enable row level security;
alter table public.payment_events       enable row level security;
alter table public.settlements          enable row level security;

create policy orders_read on public.orders for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.order_parts p where p.order_id = orders.id and app.pharmacy_access(p.pharmacy_id, 'order.read')));
create policy order_parts_read on public.order_parts for select to authenticated
  using (app.order_owner(order_id) or app.pharmacy_access(pharmacy_id, 'order.read'));
create policy order_items_read on public.order_items for select to authenticated
  using (app.part_visible(part_id));
create policy codes_owner_read on public.order_delivery_codes for select to authenticated
  using (exists (select 1 from public.order_parts p where p.id = part_id and app.order_owner(p.order_id)));
create policy payments_owner_read on public.payments for select to authenticated
  using (app.order_owner(order_id));
create policy payment_events_owner_read on public.payment_events for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id and app.order_owner(p.order_id)));
create policy settlements_read on public.settlements for select to authenticated
  using (exists (select 1 from public.order_parts p where p.id = part_id and app.pharmacy_access(p.pharmacy_id, 'order.read')));

grant select on public.orders, public.order_parts, public.order_items, public.order_delivery_codes,
                public.payments, public.payment_events, public.settlements to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function app.commission_pct(p_class text) returns numeric
language sql stable as $$
  select case p_class
    when 'general' then app.setting_num('commission.general_pct', 5)
    when 'supplement' then app.setting_num('commission.supplement_pct', 5)
    when 'otc' then app.setting_num('commission.otc_pct', 2)
    else 0 end
$$;

-- recompute a part's settlement from its live (non-rejected) lines
create or replace function app.refresh_settlement(p_part uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_items numeric; v_dorva numeric; v_ship numeric; v_status text;
begin
  select coalesce(sum(i.line_total), 0), coalesce(sum(round(i.line_total * app.commission_pct(i.dispensing_class) / 100, -3)), 0)
    into v_items, v_dorva
  from public.order_items i where i.part_id = p_part and i.tech_status <> 'rejected';
  select shipping_fee, status into v_ship, v_status from public.order_parts where id = p_part;
  insert into public.settlements (part_id, pharmacy_amount, dorva_amount, logistics_amount)
  values (p_part, v_items - v_dorva, v_dorva, case when v_status = 'cancelled' then 0 else v_ship end)
  on conflict (part_id) do update set pharmacy_amount = excluded.pharmacy_amount,
    dorva_amount = excluded.dorva_amount, logistics_amount = excluded.logistics_amount;
end $$;

-- money back to the customer for part of an order
create or replace function app.refund(p_order uuid, p_part uuid, p_amount numeric, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pay public.payments;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  select * into v_pay from public.payments where order_id = p_order for update;
  insert into public.payment_events (payment_id, part_id, kind, amount, note) values (v_pay.id, p_part, 'refund', p_amount, p_note);
  update public.orders set refunded_total = refunded_total + p_amount where id = p_order;
  update public.payments set updated_at = now(),
    status = case when (select refunded_total from public.orders where id = p_order) >= amount then 'refunded' else 'partially_refunded' end
  where id = v_pay.id;
end $$;

-- close the order when every part is finished
create or replace function app.finish_order_if_done(p_order uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.order_parts where order_id = p_order and status not in ('delivered','cancelled')) then
    update public.orders set status = case when exists (select 1 from public.order_parts where order_id = p_order and status = 'delivered')
                                           then 'completed' else 'cancelled' end
    where id = p_order;
    update public.payments set status = case when status in ('held','partially_refunded')
                                               and exists (select 1 from public.order_parts where order_id = p_order and status = 'delivered')
                                             then 'released' else status end,
                               updated_at = now()
    where order_id = p_order;
  end if;
end $$;

-- ---------------------------------------------------------------- 1. place
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
    insert into public.order_parts (order_id, pharmacy_id, seq, kind, subtotal, shipping_fee, distance_km, eta, min_days, max_days)
    values (v_order, (ph->>'pharmacy_id')::uuid, n, ph->>'kind', (ph->>'subtotal')::numeric, (ph->>'shipping')::numeric,
            (ph->>'distance_km')::numeric, ph->>'eta', (ph->>'min_days')::int, (ph->>'max_days')::int)
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

-- ---------------------------------------------------------------- 2. pay (test gateway)
create or replace function public.test_gateway_complete(p_order uuid, p_success boolean)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.orders; v_pay public.payments; r record; v_short int;
begin
  if coalesce(app.setting('payment.gateway') #>> '{}', 'test') <> 'test' then
    raise exception 'test gateway disabled' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order and user_id = auth.uid() for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if o.status <> 'awaiting_payment' then return o.status; end if;
  select * into v_pay from public.payments where order_id = p_order for update;

  if o.expires_at < now() then
    update public.orders set status = 'expired' where id = p_order;
    update public.payments set status = 'failed', updated_at = now() where id = v_pay.id;
    return 'expired';
  end if;
  if not p_success then
    update public.orders set status = 'cancelled' where id = p_order;
    update public.payments set status = 'failed', updated_at = now() where id = v_pay.id;
    insert into public.payment_events (payment_id, kind, amount, note) values (v_pay.id, 'fail', v_pay.amount, 'test gateway: declined');
    return 'failed';
  end if;

  -- take the stock; if anything ran out meanwhile, nothing is charged
  select count(*) into v_short
  from public.order_items i join public.order_parts p on p.id = i.part_id
  join public.stock_items s on s.pharmacy_id = p.pharmacy_id and s.product_id = i.product_id
  where p.order_id = p_order and s.quantity < i.qty;
  if v_short > 0 then
    update public.orders set status = 'cancelled' where id = p_order;
    update public.payments set status = 'failed', updated_at = now() where id = v_pay.id;
    insert into public.payment_events (payment_id, kind, amount, note) values (v_pay.id, 'fail', v_pay.amount, 'stock changed before payment');
    return 'stock';
  end if;
  for r in select p.pharmacy_id, i.product_id, i.qty from public.order_items i join public.order_parts p on p.id = i.part_id
           where p.order_id = p_order loop
    update public.stock_items set quantity = quantity - r.qty where pharmacy_id = r.pharmacy_id and product_id = r.product_id;
    insert into public.product_sales_daily (product_id, day, qty) values (r.product_id, current_date, r.qty)
    on conflict (product_id, day) do update set qty = public.product_sales_daily.qty + excluded.qty;
  end loop;

  update public.payments set status = 'held', gateway_ref = 'TEST-' || upper(substr(md5(random()::text), 1, 10)), updated_at = now()
  where id = v_pay.id;
  insert into public.payment_events (payment_id, kind, amount, note) values (v_pay.id, 'hold', v_pay.amount, 'held by bank until delivery');
  update public.orders set status = 'paid', paid_at = now() where id = p_order;

  update public.order_parts p set status = case when exists (select 1 from public.order_items i where i.part_id = p.id and i.tech_status = 'pending')
                                                then 'pending_tech' else 'preparing' end
  where p.order_id = p_order;
  insert into public.order_delivery_codes (part_id, code, expires_at)
  select p.id, lpad((floor(random() * 1000000))::int::text, 6, '0'),
         now() + make_interval(hours => app.setting_num('delivery.code_ttl_hours', 72)::int)
         + case when p.kind = 'intercity' then make_interval(days => coalesce(p.max_days, 4)) else interval '0' end
  from public.order_parts p where p.order_id = p_order;
  insert into public.pharmacy_daily_load (pharmacy_id, day, orders)
  select pharmacy_id, current_date, 1 from public.order_parts where order_id = p_order
  on conflict (pharmacy_id, day) do update set orders = public.pharmacy_daily_load.orders + 1;
  perform app.refresh_settlement(id) from public.order_parts where order_id = p_order;
  return 'paid';
end $$;

-- ---------------------------------------------------------------- 3. technical approval
create or replace function public.tech_review(p_item uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.order_items; p public.order_parts; v_refund numeric;
begin
  select * into i from public.order_items where id = p_item for update;
  if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
  select * into p from public.order_parts where id = i.part_id for update;
  if not app.pharmacy_access(p.pharmacy_id, 'order.tech_approve') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'pending_tech' or i.tech_status <> 'pending' then return p.status; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'reason required' using errcode = '22023'; end if;

  update public.order_items set tech_status = case when p_approve then 'approved' else 'rejected' end,
    tech_note = nullif(trim(p_note), ''), tech_by = auth.uid(), tech_at = now()
  where id = p_item;
  if not p_approve then
    update public.stock_items set quantity = quantity + i.qty where pharmacy_id = p.pharmacy_id and product_id = i.product_id;
  end if;

  if not exists (select 1 from public.order_items where part_id = p.id and tech_status = 'pending') then
    if not exists (select 1 from public.order_items where part_id = p.id and tech_status <> 'rejected') then
      -- everything rejected: the whole part, shipping included, goes back
      update public.order_parts set status = 'cancelled' where id = p.id;
      select coalesce(sum(line_total), 0) + p.shipping_fee into v_refund from public.order_items where part_id = p.id;
      perform app.refund(p.order_id, p.id, v_refund, 'all items rejected by technical officer');
      update public.settlements set status = 'refunded' where part_id = p.id;
    else
      update public.order_parts set status = 'preparing' where id = p.id;
      select coalesce(sum(line_total), 0) into v_refund from public.order_items where part_id = p.id and tech_status = 'rejected';
      perform app.refund(p.order_id, p.id, v_refund, 'items rejected by technical officer');
    end if;
    perform app.refresh_settlement(p.id);
    perform app.finish_order_if_done(p.order_id);
  end if;
  return (select status from public.order_parts where id = p.id);
end $$;

-- ---------------------------------------------------------------- 4. ship and deliver
create or replace function public.part_ship(p_part uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.order_parts;
begin
  select * into p from public.order_parts where id = p_part for update;
  if not found then raise exception 'part not found' using errcode = 'P0002'; end if;
  if not app.pharmacy_access(p.pharmacy_id, 'delivery.confirm') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'preparing' then return p.status; end if;
  update public.order_parts set status = 'shipped', shipped_at = now() where id = p_part;
  return 'shipped';
end $$;

create or replace function public.part_deliver(p_part uuid, p_code text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.order_parts; c public.order_delivery_codes; v_pay uuid; v_amount numeric;
begin
  select * into p from public.order_parts where id = p_part for update;
  if not found then raise exception 'part not found' using errcode = 'P0002'; end if;
  if not app.pharmacy_access(p.pharmacy_id, 'delivery.confirm') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p.status <> 'shipped' then return p.status; end if;
  select * into c from public.order_delivery_codes where part_id = p_part for update;
  if c.attempts >= app.setting_num('delivery.code_max_attempts', 5) then return 'locked'; end if;
  if c.expires_at < now() then return 'expired'; end if;
  if c.code <> regexp_replace(coalesce(p_code, ''), '\D', '', 'g') then
    update public.order_delivery_codes set attempts = attempts + 1 where part_id = p_part;
    return 'wrong';
  end if;

  update public.order_parts set status = 'delivered', delivered_at = now() where id = p_part;
  update public.settlements set status = 'released', released_at = now() where part_id = p_part;
  select id into v_pay from public.payments where order_id = p.order_id;
  select pharmacy_amount + dorva_amount + logistics_amount into v_amount from public.settlements where part_id = p_part;
  insert into public.payment_events (payment_id, part_id, kind, amount, note)
  values (v_pay, p_part, 'release', v_amount, 'delivery code confirmed; split to pharmacy, Dorva and logistics');
  perform app.finish_order_if_done(p.order_id);
  return 'delivered';
end $$;

grant execute on function public.place_order(jsonb, uuid, uuid, uuid) to authenticated;
grant execute on function public.test_gateway_complete(uuid, boolean) to authenticated;
grant execute on function public.tech_review(uuid, boolean, text) to authenticated;
grant execute on function public.part_ship(uuid) to authenticated;
grant execute on function public.part_deliver(uuid, text) to authenticated;
