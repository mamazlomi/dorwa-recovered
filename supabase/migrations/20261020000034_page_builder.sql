-- Page builder: the Dorva home page and each pharmacy page are built from
-- blocks (banner, product row, category tiles, text). Each page has a draft
-- and a published version. Pharmacy pages go through Dorva review (setting).
--
-- Rules enforced here, not in the browser:
--   * only block types Dorva allows (per setting) and at most N blocks
--   * prescription (rx) products never appear in a row or behind a banner link
--     (public advertising of prescription medicines is not allowed)
--   * images only from Dorva's own storage, inside the page's own folder
--   * links are internal paths only

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('pages.pharmacy_enabled', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"صفحه‌ساز برای داروخانه‌ها","en":"Page builder for pharmacies","ar":"منشئ الصفحات للصيدليات"}',
   '{"fa":"خاموش: داروخانه‌ها نمی‌توانند صفحه خود را بچینند و صفحه منتشرشده‌شان هم نمایش داده نمی‌شود.","en":"Off: pharmacies cannot edit their page and their published layout is hidden.","ar":"إيقاف: لا تستطيع الصيدليات تعديل صفحتها ويُخفى ما نُشر."}', 610),
  ('pages.pharmacy_approval', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"انتشار صفحه داروخانه با تأیید دروا","en":"Pharmacy pages need Dorva approval","ar":"صفحات الصيدليات تحتاج موافقة دوروا"}',
   '{"fa":"روشن: هر تغییر داروخانه تا تأیید دروا منتشر نمی‌شود.","en":"On: a pharmacy''s changes go live only after Dorva approves them.","ar":"تشغيل: لا تُنشر تغييرات الصيدلية قبل موافقة دوروا."}', 611),
  ('pages.ph_banner', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"داروخانه: بلوک بنر","en":"Pharmacy: banner block","ar":"الصيدلية: كتلة البانر"}', null, 612),
  ('pages.ph_products', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"داروخانه: بلوک ردیف محصول","en":"Pharmacy: product row block","ar":"الصيدلية: كتلة صف المنتجات"}', null, 613),
  ('pages.ph_categories', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"داروخانه: بلوک کاشی دسته‌ها","en":"Pharmacy: category tiles block","ar":"الصيدلية: كتلة بلاطات الفئات"}', null, 614),
  ('pages.ph_text', 'catalog', 'boolean', null, null, null, null,
   '{"fa":"داروخانه: بلوک متن و اطلاعیه","en":"Pharmacy: text block","ar":"الصيدلية: كتلة النص"}', null, 615),
  ('pages.max_blocks', 'catalog', 'number', null, 1, 40, null,
   '{"fa":"حداکثر بلوک در هر صفحه","en":"Maximum blocks per page","ar":"أقصى عدد كتل في الصفحة"}', null, 616),
  ('pages.max_slides', 'catalog', 'number', null, 1, 10, null,
   '{"fa":"حداکثر اسلاید هر بنر","en":"Maximum slides per banner","ar":"أقصى عدد شرائح للبانر"}', null, 617)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('pages.pharmacy_enabled', 'platform', 'true', 'صفحه‌ساز برای داروخانه‌ها'),
  ('pages.pharmacy_approval', 'platform', 'true', 'انتشار صفحه داروخانه با تأیید دروا'),
  ('pages.ph_banner', 'platform', 'true', 'داروخانه: بلوک بنر'),
  ('pages.ph_products', 'platform', 'true', 'داروخانه: بلوک ردیف محصول'),
  ('pages.ph_categories', 'platform', 'true', 'داروخانه: بلوک کاشی دسته‌ها'),
  ('pages.ph_text', 'platform', 'true', 'داروخانه: بلوک متن و اطلاعیه'),
  ('pages.max_blocks', 'platform', '15', 'حداکثر بلوک در هر صفحه'),
  ('pages.max_slides', 'platform', '5', 'حداکثر اسلاید هر بنر')
on conflict do nothing;

-- ---------------------------------------------------------------- permissions
insert into public.permissions (code, scope, description_fa) values
  ('pages.manage', 'platform', 'چیدمان صفحه اصلی دروا و بررسی صفحه داروخانه‌ها'),
  ('pharmacy.pages.manage', 'pharmacy', 'چیدمان صفحه داروخانه')
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'pages.manage' from public.roles r
where r.is_system and r.pharmacy_id is null and r.scope = 'platform' and r.code in ('super_admin', 'content_moderator')
on conflict do nothing;
-- whoever may manage a pharmacy's collections may also arrange its page
insert into public.role_permissions (role_id, permission_code)
select distinct rp.role_id, 'pharmacy.pages.manage' from public.role_permissions rp
join public.roles r on r.id = rp.role_id and r.scope = 'pharmacy'
where rp.permission_code = 'pharmacy.collections.manage'
on conflict do nothing;

-- ---------------------------------------------------------------- table
create table if not exists public.page_layouts (
  id            uuid primary key default gen_random_uuid(),
  pharmacy_id   uuid references public.pharmacies(id) on delete cascade,   -- null = Dorva home page
  draft         jsonb not null default '[]'::jsonb,
  published     jsonb,
  status        text not null default 'draft' check (status in ('draft', 'pending', 'published', 'rejected')),
  review_note   text check (review_note is null or length(review_note) <= 500),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  published_at  timestamptz,
  reviewed_by   uuid references auth.users(id)
);
create unique index if not exists page_layouts_one on public.page_layouts
  (coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.page_layouts enable row level security;   -- read and written only through the functions below

-- ---------------------------------------------------------------- access
create or replace function app.can_edit_page(p_pharmacy uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_pharmacy is null then app.has_platform_permission('pages.manage')
    else app.has_platform_permission('pages.manage')
      or (app.setting_bool('pages.pharmacy_enabled', true) and app.has_pharmacy_permission(p_pharmacy, 'pharmacy.pages.manage'))
  end;
$$;

-- ---------------------------------------------------------------- validation
-- 'ok' or the first problem: too_many, block_type, block, image, link, rx, collection, text
create or replace function app.page_validate(p_pharmacy uuid, p_blocks jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  b jsonb; s jsonb; it jsonb; k text;
  v_folder text := coalesce(p_pharmacy::text, 'home');
  v_img text;
  v_platform boolean := p_pharmacy is null or app.has_platform_permission('pages.manage');
  v_max int := app.setting_num('pages.max_blocks', 15)::int;
  v_slides int := app.setting_num('pages.max_slides', 5)::int;
  v_ids uuid[];
begin
  if jsonb_typeof(p_blocks) <> 'array' then return 'block'; end if;
  if jsonb_array_length(p_blocks) > v_max then return 'too_many'; end if;
  v_img := '^' || v_folder || '/[a-z0-9_-]{1,60}\.(jpg|jpeg|png|webp)$';

  for b in select * from jsonb_array_elements(p_blocks) loop
    if jsonb_typeof(b) <> 'object' or coalesce(b->>'id', '') !~ '^[a-z0-9]{2,20}$' then return 'block'; end if;
    k := b->>'type';
    if k not in ('banner', 'products', 'categories', 'text') then return 'block_type'; end if;
    if p_pharmacy is not null and not v_platform and not app.setting_bool('pages.ph_' || k, true) then return 'block_type'; end if;

    -- every text field is {fa, en, ar}, short
    if (b ? 'title' and jsonb_typeof(b->'title') <> 'object') or (b ? 'body' and jsonb_typeof(b->'body') <> 'object') then
      return 'text';
    end if;
    if length(coalesce(b->'title'->>'fa', '') || coalesce(b->'title'->>'en', '') || coalesce(b->'title'->>'ar', '')) > 300 then return 'text'; end if;
    if greatest(length(coalesce(b->'body'->>'fa', '')), length(coalesce(b->'body'->>'en', '')), length(coalesce(b->'body'->>'ar', ''))) > 1500 then return 'text'; end if;

    if k = 'banner' then
      if jsonb_typeof(b->'slides') <> 'array' or jsonb_array_length(b->'slides') not between 1 and v_slides then return 'block'; end if;
      for s in select * from jsonb_array_elements(b->'slides') loop
        if coalesce(s->>'image', '') !~ v_img then return 'image'; end if;
        if app.page_link_ok(s->'link', p_pharmacy) is distinct from 'ok' then return app.page_link_ok(s->'link', p_pharmacy); end if;
      end loop;

    elsif k = 'products' then
      if coalesce(b->>'source', '') not in ('collection', 'bestselling', 'discount', 'newest', 'manual') then return 'block'; end if;
      if coalesce((b->>'limit')::int, 12) not between 4 and 24 then return 'block'; end if;
      if b->>'source' = 'collection' and not exists (
           select 1 from collections c where c.id::text = b->>'collection' and c.status = 'published'
             and (c.pharmacy_id is null or c.pharmacy_id = p_pharmacy)) then
        return 'collection';
      end if;
      if b->>'source' = 'manual' then
        if jsonb_typeof(b->'products') <> 'array' or jsonb_array_length(b->'products') not between 1 and 24 then return 'block'; end if;
        begin
          select array_agg(x::uuid) into v_ids from jsonb_array_elements_text(b->'products') x;
        exception when others then return 'block';
        end;
        if exists (select 1 from catalog_products p where p.id = any(v_ids) and p.dispensing_class = 'rx') then return 'rx'; end if;
      end if;

    elsif k = 'categories' then
      if jsonb_typeof(b->'items') <> 'array' or jsonb_array_length(b->'items') not between 1 and 12 then return 'block'; end if;
      for it in select * from jsonb_array_elements(b->'items') loop
        if jsonb_typeof(it->'label') <> 'object' or coalesce(it->'label'->>'fa', '') = '' or length(it->'label'->>'fa') > 60 then return 'text'; end if;
        if it->>'image' is not null and it->>'image' !~ v_img then return 'image'; end if;
        if app.page_link_ok(it->'link', p_pharmacy) is distinct from 'ok' then return app.page_link_ok(it->'link', p_pharmacy); end if;
      end loop;

    elsif k = 'text' then
      if coalesce(b->>'style', 'plain') not in ('plain', 'info', 'notice') then return 'block'; end if;
      if coalesce(b->'body'->>'fa', '') = '' and coalesce(b->'title'->>'fa', '') = '' then return 'text'; end if;
    end if;
  end loop;
  return 'ok';
end $$;

-- a link is {kind: none|collection|product|search|path, value}
create or replace function app.page_link_ok(p_link jsonb, p_pharmacy uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k text := coalesce(p_link->>'kind', 'none'); v text := coalesce(p_link->>'value', '');
begin
  if p_link is null or k = 'none' then return 'ok'; end if;
  if k = 'collection' then
    return case when exists (select 1 from collections c where c.slug = v and c.status = 'published'
                               and (c.pharmacy_id is null or c.pharmacy_id = p_pharmacy)) then 'ok' else 'collection' end;
  elsif k = 'product' then
    if v !~ '^[0-9a-f-]{36}$' then return 'link'; end if;
    if exists (select 1 from catalog_products p where p.id = v::uuid and p.dispensing_class = 'rx') then return 'rx'; end if;
    return case when exists (select 1 from catalog_products p where p.id = v::uuid) then 'ok' else 'link' end;
  elsif k = 'search' then
    return case when length(trim(v)) between 1 and 60 then 'ok' else 'link' end;
  elsif k = 'path' then
    -- internal pages only; never another site
    return case when v ~ '^/[a-z0-9/_?=&%.-]{0,150}$' and v !~ '^//' then 'ok' else 'link' end;
  end if;
  return 'link';
end $$;

-- ---------------------------------------------------------------- editor RPCs
create or replace function public.page_editor(p_pharmacy uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r page_layouts;
begin
  if not app.can_edit_page(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from page_layouts where pharmacy_id is not distinct from p_pharmacy;
  return jsonb_build_object(
    'draft', coalesce(r.draft, '[]'::jsonb), 'published', r.published, 'status', coalesce(r.status, 'draft'),
    'review_note', r.review_note, 'updated_at', r.updated_at, 'published_at', r.published_at,
    'needs_approval', p_pharmacy is not null and app.setting_bool('pages.pharmacy_approval', true)
                      and not app.has_platform_permission('pages.manage'),
    'allowed', case when p_pharmacy is null or app.has_platform_permission('pages.manage')
                 then '["banner","products","categories","text"]'::jsonb
                 else (select coalesce(jsonb_agg(t), '[]'::jsonb) from unnest(array['banner', 'products', 'categories', 'text']) t
                       where app.setting_bool('pages.ph_' || t, true)) end,
    'max_blocks', app.setting_num('pages.max_blocks', 15), 'max_slides', app.setting_num('pages.max_slides', 5));
end $$;

create or replace function public.page_save(p_pharmacy uuid, p_blocks jsonb) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if not app.can_edit_page(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  v := app.page_validate(p_pharmacy, p_blocks);
  if v <> 'ok' then return v; end if;
  insert into page_layouts (pharmacy_id, draft, status, updated_by, updated_at)
  values (p_pharmacy, p_blocks, 'draft', auth.uid(), now())
  on conflict ((coalesce(pharmacy_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  do update set draft = excluded.draft, updated_by = excluded.updated_by, updated_at = now(),
                -- a pending page goes back to draft: it must be sent again
                status = case when page_layouts.status in ('pending', 'rejected') then 'draft'
                              when page_layouts.status = 'published' and page_layouts.published = excluded.draft then 'published'
                              else 'draft' end;
  return 'ok';
end $$;

-- 'published' | 'pending' | a validation code
create or replace function public.page_publish(p_pharmacy uuid) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r page_layouts; v text;
begin
  if not app.can_edit_page(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from page_layouts where pharmacy_id is not distinct from p_pharmacy for update;
  if not found then return 'block'; end if;
  v := app.page_validate(p_pharmacy, r.draft);
  if v <> 'ok' then return v; end if;
  if p_pharmacy is not null and app.setting_bool('pages.pharmacy_approval', true) and not app.has_platform_permission('pages.manage') then
    update page_layouts set status = 'pending', submitted_at = now(), review_note = null where id = r.id;
    return 'pending';
  end if;
  update page_layouts set published = draft, status = 'published', published_at = now(), review_note = null,
                          reviewed_by = auth.uid() where id = r.id;
  return 'published';
end $$;

-- Dorva review: approve | reject | unpublish
create or replace function public.page_review(p_pharmacy uuid, p_action text, p_note text default null) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r page_layouts; v text;
begin
  if not app.has_platform_permission('pages.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from page_layouts where pharmacy_id = p_pharmacy for update;
  if not found then return 'missing'; end if;
  if p_action = 'approve' then
    if r.status <> 'pending' then return 'not_pending'; end if;
    v := app.page_validate(p_pharmacy, r.draft);
    if v <> 'ok' then return v; end if;
    update page_layouts set published = draft, status = 'published', published_at = now(), reviewed_by = auth.uid(),
                            review_note = nullif(trim(coalesce(p_note, '')), '') where id = r.id;
    return 'ok';
  elsif p_action = 'reject' then
    if r.status <> 'pending' then return 'not_pending'; end if;
    update page_layouts set status = 'rejected', reviewed_by = auth.uid(), review_note = left(nullif(trim(coalesce(p_note, '')), ''), 500)
    where id = r.id;
    return 'ok';
  elsif p_action = 'unpublish' then
    update page_layouts set published = null, status = 'draft', reviewed_by = auth.uid(),
                            review_note = left(nullif(trim(coalesce(p_note, '')), ''), 500) where id = r.id;
    return 'ok';
  end if;
  return 'action';
end $$;

create or replace function public.page_queue() returns table (
  pharmacy_id uuid, slug text, name_fa text, name_i18n jsonb, status text, submitted_at timestamptz,
  published_at timestamptz, blocks int, review_note text)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.pharmacy_id, p.slug::text, p.name_fa, p.name_i18n, l.status, l.submitted_at, l.published_at,
         jsonb_array_length(l.draft), l.review_note
  from page_layouts l join pharmacies p on p.id = l.pharmacy_id
  where app.has_platform_permission('pages.manage')
  order by (l.status = 'pending') desc, l.submitted_at desc nulls last, l.updated_at desc;
$$;

-- what visitors see; null = no custom layout (the page keeps its default look)
create or replace function public.page_public(p_pharmacy uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select l.published from page_layouts l
  where l.pharmacy_id is not distinct from p_pharmacy
    and (p_pharmacy is null or app.setting_bool('pages.pharmacy_enabled', true));
$$;

-- products for a row; never prescription items
create or replace function public.page_products(p_source text, p_collection uuid default null, p_ids uuid[] default null,
                                               p_pharmacy uuid default null, p_city int default null, p_limit int default 12)
returns table(product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text, category_path text[],
              image_url text, min_price numeric, max_price numeric, list_price numeric, max_discount numeric,
              pharmacies int, total int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare n int := least(greatest(coalesce(p_limit, 12), 1), 24);
begin
  if p_source = 'manual' then
    -- the search pages at 200 rows: walk the pages until every chosen product is found
    return query
      with recursive pg(off) as (select 0 union all select off + 200 from pg where off < 4000)
      select s.* from pg cross join lateral public.shop_search(p_city, null, '{}'::jsonb, p_pharmacy, null, 200, pg.off, 'name') s
      where s.product_id = any(coalesce(p_ids, '{}')) and s.dispensing_class <> 'rx'
      order by array_position(p_ids, s.product_id) limit n;
  else
    return query
      select s.* from public.shop_search(p_city, null, '{}'::jsonb, p_pharmacy,
                                         case when p_source = 'collection' then p_collection end, n * 3 + 12, 0,
                                         case when p_source in ('bestselling', 'discount', 'newest') then p_source end) s
      where s.dispensing_class <> 'rx' and s.min_price is not null
        and (p_source <> 'discount' or coalesce(s.max_discount, 0) > 0)
      limit n;
  end if;
end $$;

grant execute on function public.page_editor(uuid) to authenticated;
grant execute on function public.page_save(uuid, jsonb) to authenticated;
grant execute on function public.page_publish(uuid) to authenticated;
grant execute on function public.page_review(uuid, text, text) to authenticated;
grant execute on function public.page_queue() to authenticated;
grant execute on function public.page_public(uuid) to anon, authenticated;
grant execute on function public.page_products(text, uuid, uuid[], uuid, int, int) to anon, authenticated;

-- ---------------------------------------------------------------- image storage
-- the first folder of an uploaded file names its page: 'home' or a pharmacy id
create or replace function app.page_media_folder_ok(p_folder text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case when p_folder = 'home' then app.can_edit_page(null)
              when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then app.can_edit_page(p_folder::uuid)
              else false end;
$$;

-- public bucket; uploads only into the folder of a page the user may edit
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('page-media', 'page-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 2097152,
                                 allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'page_media_insert') then
    create policy page_media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'page-media' and app.page_media_folder_ok((storage.foldername(name))[1]));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'page_media_delete') then
    create policy page_media_delete on storage.objects for delete to authenticated
      using (bucket_id = 'page-media' and app.page_media_folder_ok((storage.foldername(name))[1]));
  end if;
end $$;
