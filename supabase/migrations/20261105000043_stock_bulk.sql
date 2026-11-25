-- Bulk inventory editing: the pharmacy edits many rows in the table (or applies
-- one change to all ticked rows) and saves them together. Runs as the caller, so
-- the usual row security and the discount/price triggers check every row; a row
-- that breaks a rule is reported and the others are still saved.

create or replace function public.stock_bulk_save(p_pharmacy uuid, p_items jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  it jsonb; v_ok int := 0; v_err jsonb := '[]'::jsonb; v_code text; v_cap text; n int;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then
    return jsonb_build_object('ok', 0, 'errors', jsonb_build_array(jsonb_build_object('product_id', null, 'code', 'too_many')));
  end if;
  if not app.has_pharmacy_permission(p_pharmacy, 'inventory.manage') then raise exception 'forbidden' using errcode = '42501'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if coalesce(it->>'quantity', '') !~ '^[0-9]{1,6}$'
         or coalesce(it->>'discount_pct', '') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' or (it->>'discount_pct')::numeric > 100
         or (it->>'price' is not null and it->>'price' !~ '^[0-9]{1,12}$') then
        v_err := v_err || jsonb_build_object('product_id', it->>'product_id', 'code', 'value');
        continue;
      end if;
      update stock_items set quantity = (it->>'quantity')::int, discount_pct = (it->>'discount_pct')::numeric,
             price = nullif(it->>'price', '')::numeric, source = 'manual', updated_at = now()
      where pharmacy_id = p_pharmacy and product_id = (it->>'product_id')::uuid;
      get diagnostics n = row_count;
      if n = 0 then
        v_err := v_err || jsonb_build_object('product_id', it->>'product_id', 'code', 'missing');
      else
        v_ok := v_ok + 1;
      end if;
    exception when others then
      v_cap := substring(sqlerrm from 'exceeds max allowed ([0-9.]+)');
      v_code := case when v_cap is not null then 'discount' when sqlerrm like '%above Dorva cap%' then 'price_cap'
                     when sqlerrm like '%below Dorva floor%' then 'price_floor' when sqlstate = '42501' then 'forbidden' else 'unknown' end;
      v_err := v_err || jsonb_build_object('product_id', it->>'product_id', 'code', v_code, 'cap', v_cap);
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'errors', v_err);
end $$;
grant execute on function public.stock_bulk_save(uuid, jsonb) to authenticated;
