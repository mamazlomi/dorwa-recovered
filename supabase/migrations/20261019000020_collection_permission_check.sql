-- Lets a page ask whether the signed-in user may edit a pharmacy's (or, with
-- null, Dorva's) collections, to show or hide the edit controls.
create or replace function public.can_manage_collections(p_pharmacy uuid default null) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.can_manage_collection(p_pharmacy);
$$;
grant execute on function public.can_manage_collections(uuid) to anon, authenticated;
