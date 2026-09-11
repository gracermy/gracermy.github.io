-- Bloom Perks — the cards and memberships you hold, and what they get you.
-- Run this in the Supabase SQL Editor AFTER schema.sql.
--
-- Perks is the third tracker, independent of the other two: it shares no math
-- with the net-worth engine or the bill splitter, and never appears on the same
-- screen. Owner-only RLS (user_id = auth.uid()), matching schema.sql, NOT the
-- membership-based RLS the wallets use — a card is yours alone.
--
-- ⚠️ RESET (optional): uncomment to drop and start over.
-- ─────────────────────────────────────────────────────────────
-- drop table if exists public.perk_offers, public.perk_cards cascade;
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- PERK CARDS: one credit card or membership you hold.
--
-- TWO NAMES ARE STORED ON PURPOSE:
--   typed_name    — exactly what you wrote ("hang seng enjoy")
--   name          — the resolved official product ("Hang Seng enJoy Card")
-- If a resolution is ever wrong, the typed name is the only way to see what you
-- actually meant. Keeping just the corrected name would make a bad match
-- permanent and invisible.
--
-- TIER matters as much as the card: from 1 Sep 2026 a Mox Credit holder earns
-- 2% with Mox+ and 1% without, on the same card. A benefit gathered against the
-- wrong tier is simply wrong, so tier is its own editable field rather than
-- being buried in the name.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.perk_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null default 'card' check (kind in ('card','membership')),
  typed_name  text not null,
  name        text not null,
  issuer      text,
  tier        text,
  -- 'confirmed'  : you picked it from the resolver's candidates
  -- 'unverified' : the resolver found nothing and we kept what you typed.
  --                Still a real card you hold; it just may not match promos well.
  status      text not null default 'unverified' check (status in ('confirmed','unverified')),
  note        text,
  official_url text,
  -- Optional. Welcome offers are excluded from gathering outright (you already
  -- hold the card), so this is NOT needed for eligibility. It exists only for
  -- anniversary-style benefits, and stays blank for almost everyone.
  issued_on   date,
  resolved_at timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_perk_cards_user on public.perk_cards(user_id, sort_order);

-- ─────────────────────────────────────────────────────────────
-- PERK OFFERS: what a card actually gets you (Phase 2 fills these).
--
-- Created now so Phase 1's data model does not need reshaping later.
-- Deliberately NOT keyed to a user: offers belong to a CARD TYPE, and the
-- benefits of a Hang Seng enJoy Card are identical for everyone who holds one.
-- Keyed this way, a future shared cache needs no rewrite; for now every row
-- simply belongs to one of Grace's cards.
--
-- ends_on is stored so an entry can grey itself out rather than sitting there
-- looking valid forever. source_url is not a footnote — it is how you check the
-- fine print the summary may have flattened.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.perk_offers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id     uuid not null references public.perk_cards(id) on delete cascade,
  merchant    text not null,
  headline    text not null,
  detail      text,
  requirements text,
  -- The tier this applies to, when a card has them. Null = all tiers.
  tier        text,
  starts_on   date,
  ends_on     date,
  source_url  text,
  gathered_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_perk_offers_card on public.perk_offers(card_id);
create index if not exists idx_perk_offers_merchant on public.perk_offers(user_id, lower(merchant));

-- ─────────────────────────────────────────────────────────────
-- RLS: owner-only, same shape as every table in schema.sql.
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['perk_cards','perk_offers'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists owner_all on public.%I;', t);
    execute format($f$
      create policy owner_all on public.%I
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;
