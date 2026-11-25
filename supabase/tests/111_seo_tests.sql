-- T221-T224: SEO meta, sitemap gated by indexing, overrides and redirects
reset role;
set role anon;
do $$
declare m jsonb;
begin
  m := public.seo_meta('/');
  if (m->>'indexing')::boolean then raise exception 'TEST FAIL T221 indexing default on'; end if;
  if public.seo_sitemap() <> '{}'::jsonb then raise exception 'TEST FAIL T221 sitemap while off'; end if;
  begin perform public.seo_admin(); raise exception 'TEST FAIL T221 admin anon';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS T221 indexing off by default, sitemap empty, admin closed';
end $$;
reset role;
update public.settings set value = 'true' where key = 'seo.indexing' and scope = 'platform';
set role anon;
do $$
declare s jsonb;
begin
  s := public.seo_sitemap();
  if jsonb_array_length(s->'products') < 1 then raise exception 'TEST FAIL T222 products'; end if;
  if exists (select 1 from jsonb_array_elements(s->'products') x join public.catalog_products p on p.id = (x->>'id')::uuid where p.dispensing_class = 'rx') then
    raise exception 'TEST FAIL T222 rx in sitemap';
  end if;
  raise notice 'PASS T222 sitemap without prescription medicines';
end $$;
reset role;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) \gset ignore_
set role authenticated;
do $$
begin
  if public.seo_page_save('/fa/products/', '{"fa":"خرید دارو"}', '{"fa":"توضیح"}', false, null) <> 'ok' then raise exception 'TEST FAIL T223 save'; end if;
  if (public.seo_meta('/products')->'page'->'title'->>'fa') <> 'خرید دارو' then raise exception 'TEST FAIL T223 path normalised'; end if;
  if public.seo_page_save('/bad path!', '{}', '{}', false, null) <> 'path' then raise exception 'TEST FAIL T223 bad path'; end if;
  if public.seo_redirect_save('/old-page', '/fa/products', true, true) <> 'ok' then raise exception 'TEST FAIL T224 redirect'; end if;
  if public.seo_redirect_save('/fa/products', '/old-page', true, true) <> 'loop' then raise exception 'TEST FAIL T224 loop'; end if;
  if public.seo_redirect_save('/admin/x', '/fa', true, true) <> 'path' then raise exception 'TEST FAIL T224 admin redirect'; end if;
  if jsonb_array_length(public.seo_redirect_list()) <> 1 then raise exception 'TEST FAIL T224 list'; end if;
  if (public.seo_admin()->'report'->>'products')::int < 1 then raise exception 'TEST FAIL T224 report'; end if;
  raise notice 'PASS T223-T224 overrides, redirects and report';
end $$;
reset role;
update public.settings set value = 'false' where key = 'seo.indexing' and scope = 'platform';
