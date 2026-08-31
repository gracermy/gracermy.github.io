-- Bloom push notifications — subscriptions table + RLS
-- Run this in the Supabase SQL Editor AFTER split-schema.sql.
--
-- A push subscription is NOT a person: it's one browser on one device. The same
-- person on a phone and a laptop has two rows, and they expire independently
-- (iOS in particular drops them after long disuse). Keeping them in their own
-- table, separate from wallet_members, means a dead subscription can be deleted
-- without touching anyone's membership.
--
-- ─────────────────────────────────────────────────────────────
-- ⚠️ RESET (optional): uncomment to drop and start over.
-- ─────────────────────────────────────────────────────────────
-- drop table if exists public.push_subscriptions cascade;
-- drop function if exists public.wallet_push_targets(uuid, uuid);
-- ─────────────────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The push service endpoint. Unique: re-subscribing the same browser must
  -- update the existing row, not pile up duplicates that each send a copy.
  endpoint    text not null unique,
  -- Encryption material from the browser's PushSubscription.
  p256dh      text not null,
  auth        text not null,
  -- Purely for the settings UI ("iPhone · added 3 Sept").
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_push_user on public.push_subscriptions(user_id);

-- ─────────────────────────────────────────────────────────────
-- RLS: a subscription belongs to exactly one person. Only they can see or
-- change it. The Edge Function reads these with the service_role key, which
-- bypasses RLS — that's why sending is done server-side and never from the
-- browser (one member must not be able to read another's endpoints).
-- ─────────────────────────────────────────────────────────────
alter table public.push_subscriptions enable row level security;

drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions
  for all using (user_id = auth.uid())
      with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- WHO SHOULD BE NOTIFIED about activity in a wallet?
--
-- Everyone in the wallet EXCEPT the person who caused it — you don't want a
-- notification about your own expense. Returns one row per device.
--
-- security definer: called by the Edge Function, and it deliberately reads
-- across users' subscriptions, which no single user's RLS would allow.
-- It only ever returns rows for members of the given wallet.
-- ─────────────────────────────────────────────────────────────
create or replace function public.wallet_push_targets(wid uuid, actor uuid)
returns table (endpoint text, p256dh text, auth text)
language sql
security definer
stable
set search_path = public
as $$
  select s.endpoint, s.p256dh, s.auth
    from public.wallet_members m
    join public.push_subscriptions s on s.user_id = m.user_id
   where m.wallet_id = wid
     and m.left_at is null
     and m.user_id is not null
     and m.user_id <> actor;
$$;

-- Only the service_role (the Edge Function) may call this. Explicitly revoking
-- from authenticated stops a logged-in user calling it from the browser to
-- harvest other people's push endpoints.
revoke all on function public.wallet_push_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.wallet_push_targets(uuid, uuid) to service_role;
