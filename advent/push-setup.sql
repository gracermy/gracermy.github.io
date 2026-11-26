-- Our Advent Calendar — notifications.
-- Run once in Supabase (SQL Editor -> New query -> paste -> Run), AFTER
-- setup.sql. Safe to re-run.
--
-- What it sets up:
--   * advent_push   — one row per phone that turned notifications on
--   * advent_outbox — a queue of notifications waiting to be sent
--   * a trigger: when one of you answers/writes/shares something, queue a
--     notification for the other
--   * two daily jobs: 10:00 HKT "today's door is open", and 22:00 HKT a nudge
--     for whoever hasn't opened today's door yet
--
-- Why a queue: the sending function (supabase/functions/advent-push) only ever
-- sends what is waiting in this queue. So it needs no secret password — anyone
-- who found its address could only make it send notifications that were
-- already due. Every table here is locked; the page reaches them only through
-- the password-checked functions below.

-- Uses pg_net (for calling the function) and pg_cron (for the daily jobs);
-- both are already on, Bloom's notifications use them.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── Devices ──
create table if not exists public.advent_push (
  endpoint   text primary key,
  person     text not null check (person in ('a', 'b')),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.advent_push enable row level security;
revoke all on public.advent_push from anon, authenticated;

create or replace function public.advent_subscribe(
  p_pass text, p_person text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not advent_ok(p_pass) then raise exception 'wrong password' using errcode = '28P01'; end if;
  if p_person not in ('a', 'b') or p_endpoint !~ '^https://' then raise exception 'bad subscription'; end if;
  insert into advent_push (endpoint, person, p256dh, auth)
  values (p_endpoint, p_person, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set person = excluded.person, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.advent_unsubscribe(p_pass text, p_endpoint text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not advent_ok(p_pass) then raise exception 'wrong password' using errcode = '28P01'; end if;
  delete from advent_push where endpoint = p_endpoint;
end;
$$;

grant execute on function public.advent_subscribe(text, text, text, text, text) to anon, authenticated;
grant execute on function public.advent_unsubscribe(text, text) to anon, authenticated;

-- ── Queue ──
create table if not exists public.advent_outbox (
  id         bigserial primary key,
  kind       text not null check (kind in ('event', 'daily', 'nudge')),
  dedupe     text unique,          -- 'daily:5' / 'nudge:5', so a job can't double-send
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
alter table public.advent_outbox enable row level security;
revoke all on public.advent_outbox from anon, authenticated;

-- Wake the sending function. It takes no secret (see the note at the top).
create or replace function public.advent_wake()
returns void
language sql volatile security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url     := 'https://mpuyphvmpnxdlvoosiwn.supabase.co/functions/v1/advent-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$;
revoke all on function public.advent_wake() from public, anon, authenticated;

-- When one of you does something, queue a notification for the other.
-- Only the first save counts (editing a coupon or swapping a photo doesn't
-- notify again), and door-opens are tracked silently.
create or replace function public.advent_on_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.value is null or new.value->>'by' is null then return new; end if;
  if tg_op = 'UPDATE' and old.value is not null then return new; end if;
  if new.key !~ '^day:[0-9]+:(coupon|answer|judge|spin|memory|done):?[ab]?$'
     and new.key !~ '^wallet:used:' then
    return new;
  end if;
  insert into advent_outbox (kind, payload)
  values ('event', jsonb_build_object('key', new.key, 'by', new.value->>'by'));
  perform advent_wake();
  return new;
end;
$$;

drop trigger if exists advent_notify on public.advent_kv;
create trigger advent_notify
  after insert or update on public.advent_kv
  for each row execute function public.advent_on_change();

-- Daily jobs call this with 'daily' or 'nudge'. Does nothing outside 1–24 Dec.
create or replace function public.advent_enqueue(p_kind text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare d int := advent_day();
        today date := (now() at time zone 'Asia/Hong_Kong')::date;
begin
  if today < make_date(2026, 12, 1) or today > make_date(2026, 12, 24) then return; end if;
  insert into advent_outbox (kind, dedupe, payload)
  values (p_kind, p_kind || ':' || d, jsonb_build_object('day', d))
  on conflict (dedupe) do nothing;
  perform advent_wake();
end;
$$;
revoke all on function public.advent_enqueue(text) from public, anon, authenticated;

-- The sending function claims waiting rows with this, so two wake-ups at once
-- can never send the same notification twice. Old rows are skipped (a
-- reminder from yesterday is no use).
create or replace function public.advent_claim()
returns setof public.advent_outbox
language sql volatile security definer
set search_path = public
as $$
  update advent_outbox set sent_at = now()
   where id in (
     select id from advent_outbox
      where sent_at is null and created_at > now() - interval '6 hours'
      order by id
      for update skip locked)
  returning *;
$$;
revoke all on function public.advent_claim() from public, anon, authenticated;
grant execute on function public.advent_claim() to service_role;

-- ── Daily jobs (cron times are UTC; Hong Kong is UTC+8, no daylight saving) ──
select cron.unschedule(jobname) from cron.job
 where jobname in ('advent-morning', 'advent-evening');
select cron.schedule('advent-morning', '0 2 * * *',  $$ select public.advent_enqueue('daily') $$);  -- 10:00 HKT
select cron.schedule('advent-evening', '0 14 * * *', $$ select public.advent_enqueue('nudge') $$);  -- 22:00 HKT
