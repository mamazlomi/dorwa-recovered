-- Pharmacy panel: one row per stock line with the pharmacy's own discount,
-- the Dorva cap that applies (and which rule set it), and what the customer
-- actually sees. Members of the pharmacy, or Dorva staff, only.
create or replace function public.pharmacy_stock_overview(p_pharmacy uuid)
returns table(
  stock_id uuid, product_id uuid, name_fa text, name_i18n jsonb, dispensing_class text,
  category_path text[], facets jsonb, quantity int, own_price numeric, own_discount numeric,
  cap numeric, cap_source text, effective_discount numeric, list_price numeric, final_price numeric,
  published boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id, p.id, p.name_fa, p.name_i18n, p.dispensing_class, p.category_path, p.facets,
         s.quantity, s.price, s.discount_pct,
         c.max_discount_pct, c.source,
         least(s.discount_pct, c.max_discount_pct),
         coalesce(s.price, l.base_price),
         app.effective_price(l.price_policy, l.base_price, s.price, least(s.discount_pct, c.max_discount_pct)),
         coalesce(l.is_published, false)
  from stock_items s
  join catalog_products p on p.id = s.product_id
  left join product_listings l on l.product_id = s.product_id
  cross join lateral public.discount_cap(s.product_id) c
  where s.pharmacy_id = p_pharmacy
    and (app.is_pharmacy_member(p_pharmacy) or app.has_platform_permission('pharmacy.read_all'));
$$;
revoke execute on function public.pharmacy_stock_overview(uuid) from anon, public;
grant execute on function public.pharmacy_stock_overview(uuid) to authenticated;
