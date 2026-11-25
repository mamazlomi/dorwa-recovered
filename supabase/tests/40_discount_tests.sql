-- Discount caps: most specific rule wins, writes rejected, reads clipped.
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
do $$
declare
  zinc uuid; d3 uuid; ph uuid; cap numeric; src text; disc numeric; price numeric; base numeric;
begin
  select id into zinc from catalog_products where name_fa like 'زینک%';
  select id into d3   from catalog_products where name_fa like 'ویتامین D3%';
  select id into ph   from pharmacies where slug = 'test-tehran-1';

  -- T46 class cap applies when no finer rule exists
  select max_discount_pct, source into cap, src from public.discount_cap(zinc);
  if cap <> (select max_discount_pct from category_policies where dispensing_class = 'supplement') or src <> 'class' then
    raise exception 'TEST FAIL T46: % %', cap, src; end if;
  raise notice 'PASS T46 class cap is the default';

  -- T47 category rule (longer path beats shorter)
  insert into discount_caps (scope, category_path, max_discount_pct) values ('category', array['مکمل'], 12);
  insert into discount_caps (scope, category_path, max_discount_pct) values ('category', array['مکمل','مواد معدنی'], 14);
  if app.max_discount(zinc) <> 14 or app.max_discount(d3) <> 12 then
    raise exception 'TEST FAIL T47: zinc % d3 %', app.max_discount(zinc), app.max_discount(d3); end if;
  raise notice 'PASS T47 deeper category rule wins over its parent';

  -- T48 facet beats category, product beats facet; several facets -> lowest cap
  insert into discount_caps (scope, facet_key, facet_value, max_discount_pct) values ('facet', 'brand', 'SAMPLE-BR-B', 10);
  if app.max_discount(zinc) <> 10 then raise exception 'TEST FAIL T48 facet: %', app.max_discount(zinc); end if;
  insert into discount_caps (scope, facet_key, facet_value, max_discount_pct) values ('facet', 'country', 'DE', 6);
  if app.max_discount(zinc) <> 6 then raise exception 'TEST FAIL T48 lowest facet: %', app.max_discount(zinc); end if;
  delete from discount_caps where scope = 'facet' and facet_key = 'country';
  insert into discount_caps (scope, product_id, max_discount_pct) values ('product', zinc, 15);
  select max_discount_pct, source into cap, src from public.discount_cap(zinc);
  if cap <> 15 or src <> 'product' then raise exception 'TEST FAIL T48 product: % %', cap, src; end if;
  raise notice 'PASS T48 product > facet (lowest of several) > category';

  -- T49 inactive rule is ignored
  update discount_caps set is_active = false where scope = 'product' and product_id = zinc;
  if app.max_discount(zinc) <> 10 then raise exception 'TEST FAIL T49: %', app.max_discount(zinc); end if;
  raise notice 'PASS T49 inactive rule ignored';

  -- T50 write above cap rejected, at cap accepted
  begin
    insert into stock_items (pharmacy_id, product_id, quantity, discount_pct, source)
    values (ph, zinc, 5, 11, 'manual')
    on conflict (pharmacy_id, product_id) do update set discount_pct = 11;
    raise exception 'TEST FAIL T50: 11%% accepted under 10%% cap';
  exception when check_violation then null;
  end;
  insert into stock_items (pharmacy_id, product_id, quantity, discount_pct, source)
  values (ph, zinc, 5, 10, 'manual')
  on conflict (pharmacy_id, product_id) do update set discount_pct = 10, quantity = 5;
  raise notice 'PASS T50 discount above cap rejected on write';

  -- T51 lowering the cap clips live prices immediately
  update discount_caps set max_discount_pct = 4 where scope = 'facet';
  select o.discount_pct, o.final_price, coalesce(s.price, l.base_price) into disc, price, base
    from app.offers o join stock_items s on s.pharmacy_id = o.pharmacy_id and s.product_id = o.product_id
    join product_listings l on l.product_id = o.product_id
   where o.pharmacy_id = ph and o.product_id = zinc;
  if disc <> 4 or price <> round(base * 0.96) then
    raise exception 'TEST FAIL T51: disc % price % base %', disc, price, base; end if;
  raise notice 'PASS T51 lowered cap clips existing discounts in prices';

  -- T52 invalid rule shapes rejected
  begin
    insert into discount_caps (scope, facet_key, facet_value, product_id, max_discount_pct) values ('facet', 'brand', 'X', zinc, 5);
    raise exception 'TEST FAIL T52: mixed target accepted';
  exception when check_violation then null;
  end;
  begin
    insert into discount_caps (scope, facet_key, facet_value, max_discount_pct) values ('facet', 'brand', 'SAMPLE-BR-B', 7);
    raise exception 'TEST FAIL T52: duplicate brand accepted';
  exception when unique_violation then null;
  end;
  raise notice 'PASS T52 rule shape and uniqueness enforced';
end $$;

-- T53 only settings managers may write rules
set role anon;
do $$ begin
  begin
    insert into public.discount_caps (scope, facet_key, facet_value, max_discount_pct) values ('facet', 'brand', 'Other', 5);
    raise exception 'TEST FAIL T53: anon wrote a rule';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS T53 anonymous users cannot write rules';
end $$;
reset role;
\echo ALL DISCOUNT TESTS PASSED
