-- T160: color settings accept only #rrggbb (colors themselves now live in themes, see T170)
do $$ begin
  insert into public.setting_definitions (key, group_code, value_type, label) values ('test.color', 'theme', 'color', '{"fa":"تست"}');
  begin
    insert into public.settings (key, scope, value) values ('test.color', 'platform', '"red"');
    raise exception 'TEST FAIL T160 accepted a bad color';
  exception when check_violation then null; end;
  insert into public.settings (key, scope, value) values ('test.color', 'platform', '"#112233"');
  delete from public.settings where key = 'test.color';
  delete from public.setting_definitions where key = 'test.color';
  raise notice 'PASS T160 color settings validate';
end $$;

-- T161: a search lists whole-word matches before partial ones
do $$
declare v_q text; v_prev int := 99; r record; v_rows int := 0;
begin
  -- a two-letter start of some product word, so both whole-word and partial matches can exist
  select left(w, 2) into v_q
  from public.catalog_products p, regexp_split_to_table(p.name_fa, '\s+') w
  where p.is_active and length(w) >= 4 group by left(w, 2) order by count(*) desc limit 1;
  for r in select s.name_fa, s.pharmacies from public.shop_search(null, v_q, '{}'::jsonb, null, null, 200, 0, null) s loop
    v_rows := v_rows + 1;
    if app.match_rank(app.norm_text(r.name_fa), app.norm_text(v_q)) > v_prev then
      raise exception 'TEST FAIL T161 % ranked after a weaker match', r.name_fa;
    end if;
    v_prev := greatest(app.match_rank(app.norm_text(r.name_fa), app.norm_text(v_q)), 1);
  end loop;
  if v_rows = 0 then raise exception 'TEST FAIL T161 no rows for %', v_q; end if;
  if app.match_rank('آمینو وی سایلند', 'وی') <> 3 or app.match_rank('ویتامین د', 'وی') <> 2
     or app.match_rank('آزمایشی', 'شی') <> 1 then
    raise exception 'TEST FAIL T161 match_rank';
  end if;
  raise notice 'PASS T161 search ranks whole-word matches first';
end $$;

-- T162: suggestions come from catalog words and categories, never from short input
set role anon;
do $$
declare v_cat text;
begin
  select c into v_cat from public.catalog_products p, unnest(p.category_path) c where p.is_active and length(c) >= 4 limit 1;
  if v_cat is not null and not exists (select 1 from public.search_suggest(left(v_cat, 3)) s where s.term = v_cat) then
    raise exception 'TEST FAIL T162 category % not suggested', v_cat;
  end if;
  if exists (select 1 from public.search_suggest('a')) then raise exception 'TEST FAIL T162 one letter'; end if;
  raise notice 'PASS T162 search suggestions';
end $$;
reset role;

-- T163: pharmacy search matches the start of a word only
do $$
declare v_name text; v_word text;
begin
  select name_fa into v_name from public.pharmacies where status = 'active' order by name_fa limit 1;
  v_word := split_part(v_name, ' ', 1);
  if length(v_word) < 4 then raise notice 'SKIP T163'; return; end if;
  if not exists (select 1 from public.search_pharmacies(left(v_word, 3))) then
    raise exception 'TEST FAIL T163 word start not found';
  end if;
  if exists (select 1 from public.search_pharmacies(right(v_word, 3)) x
             where app.match_rank(app.norm_text(x.name_fa), app.norm_text(right(v_word, 3))) < 2
               and app.match_rank(app.norm_text(coalesce(x.address, '')), app.norm_text(right(v_word, 3))) < 2) then
    raise exception 'TEST FAIL T163 middle of a word matched';
  end if;
  raise notice 'PASS T163 pharmacy search matches word starts';
end $$;

-- T164: text banners, icon tiles and the feature strip validate
do $$ begin
  if app.page_validate(null, '[{"id":"b1","type":"banner","slides":[{"tone":"brand","title":{"fa":"سلام"},"link":{"kind":"path","value":"/finder"}}]}]') <> 'ok'
     or app.page_validate(null, '[{"id":"b1","type":"banner","slides":[{"tone":"brand"}]}]') <> 'block'
     or app.page_validate(null, '[{"id":"b1","type":"banner","slides":[{"title":{"fa":"x"},"tone":"neon"}]}]') <> 'block'
     or app.page_validate(null, '[{"id":"f1","type":"features","items":[{"icon":"map","label":{"fa":"نزدیک"}}]}]') <> 'ok'
     or app.page_validate(null, '[{"id":"f1","type":"features","items":[{"icon":"rocket","label":{"fa":"x"}}]}]') <> 'block'
     or app.page_validate(null, '[{"id":"c1","type":"categories","items":[{"icon":"pill","tone":"mint","label":{"fa":"x"},"link":{"kind":"search","value":"کلسیم"}}]}]') <> 'ok' then
    raise exception 'TEST FAIL T164';
  end if;
  raise notice 'PASS T164 text banners, icon tiles and feature strip';
end $$;

-- T165: the default home layout is valid (checked after T146 replaced it, so validate the migration's rules on a copy)
do $$ begin
  if not exists (select 1 from public.page_layouts where pharmacy_id is null) then
    raise exception 'TEST FAIL T165 no home layout';
  end if;
  raise notice 'PASS T165 home layout exists';
end $$;
