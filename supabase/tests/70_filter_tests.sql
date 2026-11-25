-- Configurable, multi-select catalog filters.
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
set role anon;
do $$
declare n int; t int; r record; ph uuid;
begin
  -- T60: several values in one filter = OR
  select count(*) into n from public.catalog_search(p_filters => '{"brand":["SAMPLE-BR-A"]}');
  if n <> 2 then raise exception 'TEST FAIL T60: brand A %', n; end if;
  select count(*) into n from public.catalog_search(p_filters => '{"brand":["SAMPLE-BR-A","SAMPLE-BR-B"]}');
  if n <> 4 then raise exception 'TEST FAIL T60: brand A or B %', n; end if;
  raise notice 'PASS T60 several values in one filter combine with OR';

  -- T61: different filters = AND
  select count(*) into n from public.catalog_search(p_filters => '{"brand":["SAMPLE-BR-A","SAMPLE-BR-B"],"sub":["ویتامین"]}');
  if n <> 2 then raise exception 'TEST FAIL T61: brand(A|B) and sub=vitamin %', n; end if;
  select count(*) into n from public.catalog_search(p_filters => '{"section":["مکمل"],"country":["DE"]}');
  if n <> 2 then raise exception 'TEST FAIL T61: supplements made in DE %', n; end if;
  raise notice 'PASS T61 different filters combine with AND';

  -- T62: options ignore their own selection, respect the others
  select products into n from public.catalog_filter_options(p_filters => '{"brand":["SAMPLE-BR-A"]}')
   where facet_key = 'brand' and value_code = 'SAMPLE-BR-B';
  if n is distinct from 2 then raise exception 'TEST FAIL T62: brand B still offered with count 2, got %', n; end if;
  select count(*) into n from public.catalog_filter_options(p_filters => '{"brand":["SAMPLE-BR-A"]}')
   where facet_key = 'sub';
  if n <> 1 then raise exception 'TEST FAIL T62: brand A narrows categories to 1, got %', n; end if;
  select count(*) into n from public.catalog_filter_options() where facet_key = 'manufacturer';
  if n <> 0 then raise exception 'TEST FAIL T62: disabled filter must not return options, got %', n; end if;
  raise notice 'PASS T62 options count under other filters, disabled filters hidden';

  -- T63: pharmacy scope lists only that pharmacy's offers
  select id into ph from public.pharmacies where slug = 'test-tehran-1';
  select count(*), min(s.pharmacies) into n, t from public.catalog_search(p_pharmacy => ph, p_limit => 200) s;
  if n = 0 or t <> 1 then raise exception 'TEST FAIL T63: pharmacy scope rows % min %', n, t; end if;
  raise notice 'PASS T63 pharmacy page shows only its own offers';

  -- T64: total is the full count, not the page size
  select total into t from public.catalog_search(p_limit => 3) limit 1;
  select count(*) into n from public.catalog_search(p_limit => 200);
  if t <> n then raise exception 'TEST FAIL T64: total % vs %', t, n; end if;
  raise notice 'PASS T64 paging reports the full total';
end $$;

-- T65: filter settings are read-only without settings.manage
do $$
declare n int;
begin
  begin
    update public.catalog_filters set enabled = false where facet_key = 'brand';
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0;
  end;
  if n <> 0 then raise exception 'TEST FAIL T65: anon changed filter settings'; end if;
  raise notice 'PASS T65 filter settings protected';
end $$;
reset role;
\echo ALL FILTER TESTS PASSED
