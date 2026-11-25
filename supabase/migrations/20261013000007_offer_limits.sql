-- How many units of each product a customer may add from one pharmacy's page.
-- Capped at 10 so exact stock levels are not exposed to competitors.
create or replace function public.offer_limits(p_pharmacy uuid)
returns table(product_id uuid, max_qty int)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.product_id, least(s.quantity, 10)::int
  from stock_items s
  join pharmacies ph on ph.id = s.pharmacy_id and ph.status = 'active'
  where s.pharmacy_id = p_pharmacy and s.quantity > 0;
$$;
grant execute on function public.offer_limits(uuid) to anon, authenticated;
