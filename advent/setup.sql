-- Our Advent — database setup.
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It uses the same Supabase project as the finance app but touches none of
-- its tables. Safe to re-run.
--
-- 👉 FIRST RUN ONLY: change 'mistletoe' on the line marked CHANGE ME to the
--    password you two will use (case-insensitive). Re-running this file later
--    never changes an existing password. To change it, run on its own:
--      update public.advent_secret
--      set pass_hash = encode(extensions.digest(lower(trim('new password')), 'sha256'), 'hex');
--
-- How it's protected: the tables below are locked (no direct access for
-- anyone using the public key). The page can only read and write through the
-- three functions at the bottom, and each one checks the password first. The
-- password itself is never stored, only its SHA-256 hash.

-- Everything the calendar saves: one row per key, e.g. "day:5:coupon:a".
create table if not exists public.advent_kv (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists advent_kv_updated_at on public.advent_kv (updated_at);
alter table public.advent_kv enable row level security;
revoke all on public.advent_kv from anon, authenticated;

-- The password hash (a single row).
create table if not exists public.advent_secret (
  id        int primary key default 1 check (id = 1),
  pass_hash text not null
);
alter table public.advent_secret enable row level security;
revoke all on public.advent_secret from anon, authenticated;

insert into public.advent_secret (id, pass_hash)
values (1, encode(extensions.digest(lower(trim('mistletoe')), 'sha256'), 'hex'))   -- CHANGE ME
on conflict (id) do nothing;

-- Which advent day it is right now in Hong Kong time: 0 before 1 December,
-- 1–24 during, 24 after. A day's hidden content is released once it's reached.
create or replace function public.advent_day()
returns int
language sql stable
as $$
  select case
    when d < make_date(2026, 12, 1) then 0
    when d > make_date(2026, 12, 24) then 24
    else extract(day from d)::int
  end
  from (select (now() at time zone 'Asia/Hong_Kong')::date as d) t;
$$;

-- Internal: does this password match?
create or replace function public.advent_ok(p_pass text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from advent_secret
    where pass_hash = encode(digest(lower(trim(coalesce(p_pass, ''))), 'sha256'), 'hex')
  );
$$;
revoke all on function public.advent_ok(text) from public, anon, authenticated;

-- Used by the password screen.
create or replace function public.advent_check(p_pass text)
returns boolean
language sql stable security definer
set search_path = public
as $$ select advent_ok(p_pass); $$;

-- Everything that changed since a moment in time (null = everything).
-- A day's content ("day:N:content") stays hidden until day N arrives.
create or replace function public.advent_pull(p_pass text, p_since timestamptz default null)
returns table (key text, value jsonb, updated_at timestamptz)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not advent_ok(p_pass) then raise exception 'wrong password' using errcode = '28P01'; end if;
  return query
    select k.key, k.value, k.updated_at from advent_kv k
    where (p_since is null or k.updated_at > p_since)
      and not (k.key ~ '^day:[0-9]+:content$'
               and split_part(k.key, ':', 2)::int > advent_day())
    order by k.updated_at;
end;
$$;

-- Save one key. A null value means "removed".
create or replace function public.advent_put(p_pass text, p_key text, p_value jsonb)
returns timestamptz
language plpgsql volatile security definer
set search_path = public
as $$
declare t timestamptz := clock_timestamp();
begin
  if not advent_ok(p_pass) then raise exception 'wrong password' using errcode = '28P01'; end if;
  if p_key !~ '^(day|wallet):[A-Za-z0-9:_-]{1,120}$' then raise exception 'bad key'; end if;
  -- The content is set up from the private SQL file, never from the page.
  if p_key ~ '^day:[0-9]+:content$' then raise exception 'bad key'; end if;
  if octet_length(coalesce(p_value::text, '')) > 3000000 then raise exception 'too big'; end if;
  insert into advent_kv (key, value, updated_at) values (p_key, p_value, t)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return t;
end;
$$;

grant execute on function public.advent_check(text) to anon, authenticated;
grant execute on function public.advent_pull(text, timestamptz) to anon, authenticated;
grant execute on function public.advent_put(text, text, jsonb) to anon, authenticated;
