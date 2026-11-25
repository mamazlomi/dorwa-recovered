-- Smarter medicine finder:
--  * typo-tolerant search (trigram similarity) with "did you mean";
--  * every unanswered search is matched once to a catalog product, even when misspelt;
--  * demand per city: past a threshold the medicine joins the shortage list on its own
--    (regional), past N cities it becomes national, and pharmacies of those cities get an alert.

set search_path = public, extensions;

-- ---------------------------------------------------------------- settings
insert into public.setting_definitions (key, group_code, value_type, options, min_value, max_value, unit, label, help, sort) values
  ('finder.auto_enabled', 'finder', 'boolean', null, null, null, null,
   '{"fa":"ساخت خودکار لیست کمبود از جستجوهای بی‌جواب","en":"Build the shortage list from unanswered searches","ar":"بناء قائمة النقص من عمليات البحث دون نتيجة"}',
   '{"fa":"روشن: دارویی که در یک شهر به اندازه آستانه جستجو و پیدا نشود، خودش وارد لیست کمبود می‌شود و داروخانه‌های همان شهر اعلان می‌گیرند.","en":"On: a medicine searched this many times in a city without result joins the list and that city''s pharmacies are alerted.","ar":"تشغيل: يُضاف الدواء تلقائياً وتُنبَّه صيدليات المدينة."}', 708),
  ('finder.auto_regional_threshold', 'finder', 'number', null, 2, 500, '{"fa":"جستجو","en":"searches","ar":"بحث"}',
   '{"fa":"آستانه کمبود منطقه‌ای (جستجوی بی‌جواب در یک شهر)","en":"Regional shortage threshold (unanswered searches in one city)","ar":"عتبة النقص الإقليمي"}', null, 709),
  ('finder.auto_national_cities', 'finder', 'number', null, 2, 50, '{"fa":"شهر","en":"cities","ar":"مدينة"}',
   '{"fa":"تعداد شهر برای کمبود کشوری","en":"Cities that make a shortage national","ar":"عدد المدن للنقص الوطني"}',
   '{"fa":"وقتی دارو در این تعداد شهر به آستانه برسد، کمبود کشوری حساب می‌شود و همه داروخانه‌ها اعلان می‌گیرند.","en":"When this many cities pass the threshold, the shortage is national and every pharmacy is alerted.","ar":"عندها يصبح النقص وطنياً وتُنبَّه كل الصيدليات."}', 710),
  ('finder.demand_window_days', 'finder', 'number', null, 1, 180, '{"fa":"روز","en":"days","ar":"يوم"}',
   '{"fa":"بازه شمارش جستجوهای بی‌جواب","en":"Window for counting unanswered searches","ar":"فترة عد عمليات البحث"}', null, 711),
  ('finder.match_threshold', 'finder', 'number', null, 0.2, 0.9, null,
   '{"fa":"حساسیت تشخیص غلط تایپی (۰٫۲ تا ۰٫۹)","en":"Typo matching strictness (0.2–0.9)","ar":"دقة مطابقة الأخطاء الإملائية"}',
   '{"fa":"عدد کمتر یعنی غلط‌های بیشتری پذیرفته می‌شود ولی احتمال اشتباه هم بالا می‌رود. پیشنهاد: ۰٫۳۵","en":"Lower accepts more typos but risks wrong matches. Suggested: 0.35","ar":"الأقل يقبل أخطاء أكثر. المقترح: 0.35"}', 712)
on conflict (key) do nothing;
insert into public.settings (key, scope, value, description_fa) values
  ('finder.auto_enabled', 'platform', 'true', 'ساخت خودکار لیست کمبود'),
  ('finder.auto_regional_threshold', 'platform', '5', 'آستانه کمبود منطقه‌ای'),
  ('finder.auto_national_cities', 'platform', '3', 'تعداد شهر برای کمبود کشوری'),
  ('finder.demand_window_days', 'platform', '30', 'بازه شمارش جستجوهای بی‌جواب'),
  ('finder.match_threshold', 'platform', '0.35', 'حساسیت تشخیص غلط تایپی')
on conflict do nothing;

-- ---------------------------------------------------------------- tables
alter table public.finder_drugs drop constraint if exists finder_drugs_origin_check;
alter table public.finder_drugs add constraint finder_drugs_origin_check check (origin in ('admin', 'suggestion', 'auto'));
alter table public.finder_drugs add column if not exists scope text not null default 'national' check (scope in ('national', 'regional'));
alter table public.finder_drugs add column if not exists region_cities int[] not null default '{}';

-- one resolution per distinct query text (misspellings included)
create table if not exists public.finder_query_map (
  query       text primary key,
  product_id  uuid references public.catalog_products(id) on delete cascade,
  score       real,
  resolved_at timestamptz not null default now()
);
alter table public.finder_query_map enable row level security;

create table if not exists public.finder_alerts (
  id          bigserial primary key,
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  drug_id     uuid not null references public.finder_drugs(id) on delete cascade,
  scope       text not null check (scope in ('national', 'regional')),
  searches    int not null default 0,
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  unique (pharmacy_id, drug_id)
);
alter table public.finder_alerts enable row level security;

create index if not exists catalog_products_name_trgm on public.catalog_products using gin (app.norm_text(name_fa) extensions.gin_trgm_ops);
create index if not exists catalog_products_generic_trgm on public.catalog_products using gin (app.norm_text(coalesce(generic_name, '')) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------- matching
-- best catalog product for a (possibly misspelt) query, or null
create or replace function app.finder_resolve(p_query text) returns table (product_id uuid, score real)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with q as (select app.norm_text(trim(p_query)) q)
  select p.id, greatest(similarity(app.norm_text(p.name_fa), q.q),
                        similarity(app.norm_text(coalesce(p.generic_name, '')), q.q),
                        similarity(lower(coalesce(p.name_en, '')), q.q))::real s
  from catalog_products p cross join q
  where p.is_active and length(q.q) >= 3
    and (app.norm_text(p.name_fa) % q.q or app.norm_text(coalesce(p.generic_name, '')) % q.q
         or app.norm_text(p.name_fa) like '%' || q.q || '%' or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%')
  order by (app.norm_text(p.name_fa) like q.q || '%') desc, 2 desc
  limit 1;
$$;

-- typo-tolerant search over the listed medicines; fuzzy = matched only by similarity
drop function if exists public.finder_search(text, int);
create or replace function public.finder_search(p_query text default null, p_city int default null)
returns table (drug_id uuid, product_id uuid, name_fa text, name_en text, generic_name text, dispensing_class text,
               image_url text, in_city int, total int, fuzzy boolean)
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with q as (select app.norm_text(nullif(trim(p_query), '')) q),
  base as (
    select d.id, p.id pid, p.name_fa, p.name_en, p.generic_name, p.dispensing_class, p.image_url,
           (q.q is null or app.norm_text(p.name_fa) like '%' || q.q || '%'
            or app.norm_text(coalesce(p.name_en, '')) like '%' || q.q || '%'
            or app.norm_text(coalesce(p.generic_name, '')) like '%' || q.q || '%') exact,
           case when q.q is null then 1 else greatest(similarity(app.norm_text(p.name_fa), q.q),
                similarity(app.norm_text(coalesce(p.generic_name, '')), q.q), similarity(lower(coalesce(p.name_en, '')), q.q)) end sim
    from finder_drugs d join catalog_products p on p.id = d.product_id cross join q
    where d.status = 'active' and app.setting_bool('finder.enabled', true)
  ),
  hits as (
    select * from base where exact
    union all
    -- only when nothing matched as typed
    select * from base where not exact and not exists (select 1 from base where exact)
      and sim >= app.setting_num('finder.match_threshold', 0.35)
  )
  select h.id, h.pid, h.name_fa, h.name_en, h.generic_name, h.dispensing_class, h.image_url,
         (select count(*) from finder_stock s join pharmacies ph on ph.id = s.pharmacy_id
           where s.drug_id = h.id and ph.status = 'active' and app.finder_fresh(s.confirmed_at) and ph.city_id = p_city)::int,
         (select count(*) from finder_stock s join pharmacies ph on ph.id = s.pharmacy_id
           where s.drug_id = h.id and ph.status = 'active' and app.finder_fresh(s.confirmed_at))::int,
         not h.exact
  from hits h
  order by h.exact desc, h.sim desc, h.name_fa
  limit 60;
$$;

-- ---------------------------------------------------------------- demand → list → alerts
-- after an unanswered search: match it, and list/alert when a city passes the threshold
create or replace function app.finder_learn(p_query text, p_city int) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_q text := left(lower(trim(coalesce(p_query, ''))), 80);
  v_pid uuid; v_score real; v_n int; v_cities int[]; v_drug uuid; v_scope text;
  v_win interval := make_interval(days => app.setting_num('finder.demand_window_days', 30)::int);
  v_thr int := app.setting_num('finder.auto_regional_threshold', 5)::int;
begin
  if v_q = '' then return; end if;
  if not exists (select 1 from finder_query_map where query = v_q) then
    select r.product_id, r.score into v_pid, v_score from app.finder_resolve(v_q) r;
    insert into finder_query_map (query, product_id, score)
    values (v_q, case when v_score >= app.setting_num('finder.match_threshold', 0.35) then v_pid end, v_score)
    on conflict do nothing;
  end if;
  select product_id into v_pid from finder_query_map where query = v_q;
  if v_pid is null or p_city is null or not app.setting_bool('finder.auto_enabled', true) then return; end if;
  if exists (select 1 from catalog_products where id = v_pid and dispensing_class not in ('rx', 'otc', 'supplement')) then
    return;   -- only medicines and supplements belong in the shortage list
  end if;

  -- cities where this product passed the threshold in the window
  select coalesce(array_agg(city_id), '{}') into v_cities from (
    select e.city_id from finder_events e join finder_query_map m on m.query = e.query
    where e.kind = 'search' and coalesce(e.results, 0) = 0 and m.product_id = v_pid and e.city_id is not null
      and e.created_at > now() - v_win
    group by e.city_id having count(*) >= v_thr) x;
  if not (p_city = any(v_cities)) then return; end if;

  v_scope := case when cardinality(v_cities) >= app.setting_num('finder.auto_national_cities', 3)::int then 'national' else 'regional' end;
  insert into finder_drugs (product_id, status, origin, scope, region_cities, note)
  values (v_pid, 'active', 'auto', v_scope, v_cities, 'خودکار از جستجوهای بی‌جواب')
  on conflict (product_id) do update set
    scope = case when finder_drugs.origin = 'auto' then excluded.scope else finder_drugs.scope end,
    region_cities = (select array_agg(distinct c) from unnest(finder_drugs.region_cities || excluded.region_cities) c)
  returning id into v_drug;
  -- an "off" medicine stays off: Dorva switched it off on purpose
  if exists (select 1 from finder_drugs where id = v_drug and status = 'off') then return; end if;

  select count(*) into v_n from finder_events e join finder_query_map m on m.query = e.query
  where e.kind = 'search' and coalesce(e.results, 0) = 0 and m.product_id = v_pid and e.created_at > now() - v_win;
  insert into finder_alerts (pharmacy_id, drug_id, scope, searches)
  select ph.id, v_drug, v_scope, v_n from pharmacies ph
  where ph.status = 'active' and (v_scope = 'national' or ph.city_id = any(v_cities))
    and not exists (select 1 from finder_stock s where s.pharmacy_id = ph.id and s.drug_id = v_drug and app.finder_fresh(s.confirmed_at))
  on conflict (pharmacy_id, drug_id) do update set searches = excluded.searches, scope = excluded.scope,
    created_at = case when finder_alerts.answered_at is not null and finder_alerts.answered_at < now() - interval '7 days'
                      then now() else finder_alerts.created_at end,
    answered_at = case when finder_alerts.answered_at is not null and finder_alerts.answered_at < now() - interval '7 days'
                       then null else finder_alerts.answered_at end;
end $$;

create or replace function public.finder_log(p_kind text, p_drug uuid default null, p_pharmacy uuid default null,
                                            p_query text default null, p_results int default null, p_city int default null)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  insert into finder_events (kind, drug_id, pharmacy_id, query, results, city_id)
  select p_kind, p_drug, p_pharmacy, nullif(left(lower(trim(coalesce(p_query, ''))), 80), ''), p_results, p_city
  where p_kind in ('search', 'view', 'call')
    and (p_kind <> 'search' or coalesce(trim(p_query), '') <> '')
    and (p_drug is null or exists (select 1 from finder_drugs where id = p_drug))
    and (p_pharmacy is null or exists (select 1 from pharmacies where id = p_pharmacy))
    and (p_kind <> 'call' or (p_drug is not null and p_pharmacy is not null));
  if p_kind = 'search' and coalesce(p_results, 0) = 0 and coalesce(trim(p_query), '') <> '' then
    perform app.finder_learn(p_query, p_city);
  end if;
end $$;

-- demand table for Dorva: product × city, misspellings merged
create or replace function public.finder_demand(p_days int default 30)
returns table (product_id uuid, name_fa text, generic_name text, city_id int, city_name text, searches int,
               spellings text[], listed boolean, scope text, cities int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_platform_permission('finder.manage') or app.has_platform_permission('pharmacy.read_all')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    with ev as (
      select m.product_id pid, e.city_id cid, e.query q from finder_events e join finder_query_map m on m.query = e.query
      where e.kind = 'search' and coalesce(e.results, 0) = 0 and m.product_id is not null
        and e.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 366))
    ), agg as (
      select pid, cid, count(*)::int n, array_agg(distinct q) qs from ev group by pid, cid
    )
    select a.pid, p.name_fa, p.generic_name, a.cid, c.name_fa, a.n, a.qs[1:6],
           exists (select 1 from finder_drugs d where d.product_id = a.pid and d.status = 'active'),
           (select d.scope from finder_drugs d where d.product_id = a.pid),
           (select count(distinct cid)::int from agg a2 where a2.pid = a.pid)
    from agg a join catalog_products p on p.id = a.pid left join cities c on c.id = a.cid
    order by a.n desc, p.name_fa limit 100;
end $$;

-- alerts a pharmacy has not answered yet
create or replace function public.finder_alerts_for(p_pharmacy uuid)
returns table (drug_id uuid, name_fa text, scope text, searches int, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select a.drug_id, p.name_fa, a.scope, a.searches, a.created_at
    from finder_alerts a join finder_drugs d on d.id = a.drug_id and d.status = 'active'
    join catalog_products p on p.id = d.product_id
    where a.pharmacy_id = p_pharmacy and a.answered_at is null
    order by a.scope = 'national' desc, a.searches desc;
end $$;

-- answering "have / don't have" also closes the alert
create or replace function public.finder_set_stock(p_pharmacy uuid, p_drug uuid, p_have boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.finder_can(p_pharmacy) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from finder_drugs where id = p_drug and status = 'active') then return 'not_listed'; end if;
  if p_have then
    insert into finder_stock (pharmacy_id, drug_id, confirmed_at, confirmed_by) values (p_pharmacy, p_drug, now(), auth.uid())
    on conflict (pharmacy_id, drug_id) do update set confirmed_at = now(), confirmed_by = auth.uid();
  else
    delete from finder_stock where pharmacy_id = p_pharmacy and drug_id = p_drug;
  end if;
  update finder_alerts set answered_at = now() where pharmacy_id = p_pharmacy and drug_id = p_drug and answered_at is null;
  return 'ok';
end $$;

grant execute on function public.finder_search(text, int) to anon, authenticated;
grant execute on function public.finder_log(text, uuid, uuid, text, int, int) to anon, authenticated;
grant execute on function public.finder_demand(int) to authenticated;
grant execute on function public.finder_alerts_for(uuid) to authenticated;
grant execute on function public.finder_set_stock(uuid, uuid, boolean) to authenticated;
