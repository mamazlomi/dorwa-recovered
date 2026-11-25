-- T94-T96: shipping fees and the intercity option
do $$
declare p uuid; teh int; isf int; v jsonb; f uuid;
begin
  select id into teh from public.cities where slug = 'tehran';
  select id into isf from public.cities where slug = 'isfahan';
  -- a product sold in Tehran but not in Isfahan
  select o.product_id into p from app.offers o join public.catalog_products cp on cp.id = o.product_id
  where o.city_id = teh and cp.dispensing_class <> 'rx'
    and not exists (select 1 from app.offers x where x.product_id = o.product_id and x.city_id = isf)
  limit 1;
  if p is null then raise notice 'SKIP T94-T96: no Tehran-only product in seed'; return; end if;

  -- T94: local plan in Tehran carries a shipping fee and totals add up
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), teh, 35.70, 51.40);
  if jsonb_array_length(v->'pharmacies') = 0 or (v->'pharmacies'->0->>'shipping')::numeric <= 0 then
    raise exception 'TEST FAIL T94: %', v;
  end if;
  if (v->>'grand_total')::numeric <> (v->>'total')::numeric + (v->>'shipping_total')::numeric then
    raise exception 'TEST FAIL T94: totals';
  end if;

  -- T95: in Isfahan the item is missing locally, so Tehran is offered at intercity cost
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), isf, 32.65, 51.67);
  if jsonb_array_length(v->'intercity_options') = 0 then raise exception 'TEST FAIL T95: no intercity option %', v; end if;
  f := (v->'intercity_options'->0->>'pharmacy_id')::uuid;
  if (v->'intercity_options'->0->>'shipping')::numeric <= (public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), teh, 35.70, 51.40)->'pharmacies'->0->>'shipping')::numeric then
    raise exception 'TEST FAIL T95: intercity not dearer than local';
  end if;

  -- T96: choosing it gives an intercity plan with the item
  v := public.plan_cart_v2(jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), isf, 32.65, 51.67, null, f);
  if v->>'strategy' <> 'intercity' or jsonb_array_length(v->'unavailable') <> 0
     or v->'pharmacies'->0->>'kind' <> 'intercity' then
    raise exception 'TEST FAIL T96: %', v;
  end if;
  raise notice 'PASS T94-T96 shipping fee, intercity offer and choice';
end $$;
-- anon may call the planner
set role anon;
select (public.plan_cart_v2('[]'::jsonb)->>'strategy') is not null as anon_ok \gset
reset role;
