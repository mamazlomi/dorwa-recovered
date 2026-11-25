-- Dorva-mode catalog browsing.
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
insert into public.catalog_facet_values (facet_key, value_code, name_fa)
values ('brand', 'UNUSED-BR', 'برند بدون کالا') on conflict do nothing;
set role anon;
do $$
declare n int; r record; tehran int; prev numeric := 0;
begin
  select id into tehran from public.cities where slug = 'tehran';
  select * into r from public.catalog_browse(p_city => tehran, p_query => 'زينك');
  if r.product_id is null or r.pharmacies < 1 or r.min_price is null then
    raise exception 'TEST FAIL T56: zinc in Tehran %', r; end if;
  raise notice 'PASS T56 browse finds a product (Arabic ي spelling) with its Tehran price range';

  select count(*) into n from public.catalog_browse(p_class => 'rx');
  if n <> 3 then raise exception 'TEST FAIL T57: rx count %', n; end if;
  select count(*) into n from public.catalog_browse(p_facet_key => 'brand', p_facet_value => 'SAMPLE-BR-A');
  if n <> 2 then raise exception 'TEST FAIL T57: brand A count %', n; end if;
  raise notice 'PASS T57 class and facet filters';

  for r in select * from public.product_pharmacy_offers(md5('dorva-sample-product-8')::uuid, tehran) loop
    if r.final_price < prev then raise exception 'TEST FAIL T58: not sorted by price'; end if;
    prev := r.final_price;
  end loop;
  if prev = 0 then raise exception 'TEST FAIL T58: no offers'; end if;
  raise notice 'PASS T58 offers listed cheapest first';
  -- T59: filter options only list values carried by at least one product
  select count(*) into n from public.catalog_facet_counts('brand');
  if n <> 2 then raise exception 'TEST FAIL T59: brand options %', n; end if;
  select products into n from public.catalog_facet_counts('brand') where value_code = 'SAMPLE-BR-A';
  if n <> 2 then raise exception 'TEST FAIL T59: brand A count %', n; end if;
  select count(*) into n from public.catalog_facet_counts('brand', p_class => 'rx');
  if n <> 0 then raise exception 'TEST FAIL T59: rx should have no brand options, got %', n; end if;
  raise notice 'PASS T59 filter options limited to values in use, with counts';
end $$;
reset role;
\echo ALL CATALOG TESTS PASSED
