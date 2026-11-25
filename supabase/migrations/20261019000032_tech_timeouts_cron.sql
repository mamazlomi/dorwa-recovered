-- Run the technical-officer deadline every minute (Supabase pg_cron).
-- Skipped where pg_cron is not available (local tests call tech_timeouts_tick directly).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if not exists (select 1 from cron.job where jobname = 'dorva-tech-timeouts') then
      perform cron.schedule('dorva-tech-timeouts', '* * * * *', 'select public.tech_timeouts_tick()');
    end if;
  end if;
end $$;
