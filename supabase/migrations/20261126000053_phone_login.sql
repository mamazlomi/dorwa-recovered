-- Round 7a: sign-in with an SMS code (mobile number, no password).
--
-- The server (Next.js, service role) sends the code through the SMS provider and
-- checks it here. Codes are stored only as an HMAC hash, expire fast, allow a few
-- wrong tries, and are rate limited per number and per IP.
-- The table has no policies on purpose: browsers (anon / authenticated) cannot read it.

set search_path = public, extensions;

create table if not exists public.phone_otps (
  id          bigint generated always as identity primary key,
  phone       text not null check (phone ~ '^09[0-9]{9}$'),
  code_hash   text not null,
  ip          text,
  attempts    smallint not null default 0,
  consumed_at timestamptz,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists phone_otps_phone_idx on public.phone_otps (phone, created_at desc);
create index if not exists phone_otps_ip_idx    on public.phone_otps (ip, created_at desc) where ip is not null;

alter table public.phone_otps enable row level security;
revoke all on public.phone_otps from anon, authenticated;

-- Housekeeping: old codes are useless after a day.
create or replace function public.phone_otp_cleanup() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with d as (delete from public.phone_otps where created_at < now() - interval '1 day' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.phone_otp_cleanup() from public, anon, authenticated;

comment on table public.phone_otps is 'SMS sign-in codes (hashed). Service role only.';
