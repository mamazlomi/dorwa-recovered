-- Search normalisation: digits, Arabic letters, ZWNJ.
\set QUIET on
\set ON_ERROR_STOP 1
reset role;
set role anon;
do $$
declare n int;
begin
  select count(*) into n from public.search_pharmacies(p_query => 'تهران 3');
  if n <> 1 then raise exception 'TEST FAIL T44: latin digit found %', n; end if;
  select count(*) into n from public.search_pharmacies(p_query => 'تهران ۳');
  if n <> 1 then raise exception 'TEST FAIL T44: persian digit found %', n; end if;
  select count(*) into n from public.search_pharmacies(p_query => 'داروخانه مجازي تهران');
  if n < 6 then raise exception 'TEST FAIL T45: arabic ye found %', n; end if;
  select count(*) into n from public.search_pharmacies(p_query => 'شيراز');
  if n <> 2 then raise exception 'TEST FAIL T45: arabic ye in city name found %', n; end if;
  raise notice 'PASS T44 digits match in any script (3 = ۳)';
  raise notice 'PASS T45 Arabic ي/ك match Persian ی/ک';
end $$;
reset role;
\echo ALL SEARCH TESTS PASSED
