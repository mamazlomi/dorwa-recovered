-- Test data for the medicine finder on the live project (virtual pharmacies only).
-- Phone numbers are deliberately unreachable test numbers (021-0000-000x).
update public.pharmacies p set phone = '021-0000-000' || right(p.slug, 1)
where p.is_virtual and p.phone is null and p.slug ~ '^test-[a-z]+-[0-9]$';

insert into public.finder_drugs (product_id, status, note, origin)
select id, 'active', 'داده آزمایشی', 'admin' from public.catalog_products
where id in ('f6194c34-ff43-5dd4-a9f5-c2dea4036210',  -- آموکسی‌سیلین ۵۰۰
             '02a107f4-5cf7-f591-b967-1aad348becdb',  -- متفورمین ۵۰۰
             'bd7d806e-8083-662c-285f-e0817c08d48e',  -- لووتیروکسین ۱۰۰
             'd48457b5-2393-9379-e067-0752530e96bd',  -- ایبوپروفن ۲۰۰
             '11b77c81-5e27-11c9-9f88-cd0ea8abd0d1')  -- استامینوفن ۵۰۰ (no pharmacy declares it)
on conflict (product_id) do nothing;

insert into public.finder_stock (pharmacy_id, drug_id, confirmed_at)
select ph.id, d.id, now()
from (values
  ('test-tehran-1', 'f6194c34-ff43-5dd4-a9f5-c2dea4036210'),
  ('test-tehran-1', '02a107f4-5cf7-f591-b967-1aad348becdb'),
  ('test-tehran-2', 'f6194c34-ff43-5dd4-a9f5-c2dea4036210'),
  ('test-tehran-4', 'f6194c34-ff43-5dd4-a9f5-c2dea4036210'),
  ('test-tehran-3', 'bd7d806e-8083-662c-285f-e0817c08d48e'),
  ('test-isfahan-1', 'd48457b5-2393-9379-e067-0752530e96bd'),
  ('test-shiraz-1', '02a107f4-5cf7-f591-b967-1aad348becdb')
) v(slug, product)
join public.pharmacies ph on ph.slug = v.slug
join public.finder_drugs d on d.product_id = v.product::uuid
on conflict (pharmacy_id, drug_id) do update set confirmed_at = now();
