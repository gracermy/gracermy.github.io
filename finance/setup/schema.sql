-- Finance Growth Tracker — database schema + Row Level Security
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
--
-- Every table is scoped to the logged-in user via RLS policies checking
-- user_id = auth.uid(). A user can only ever see/modify their own rows.
--
-- ⚠️ RESET (optional): if you ran an OLDER version of this schema and have NO
-- real data yet, uncomment the block below to drop the old tables first, then
-- run the rest. This deletes all finance DATA but NOT your login accounts.
-- ─────────────────────────────────────────────────────────────
-- drop table if exists
--   public.transactions, public.expense_lines, public.income_defaults,
--   public.income, public.illiquid_moves, public.balances,
--   public.snapshots, public.accounts
-- cascade;
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- ACCOUNTS: a bank / e-wallet / cash / credit card / illiquid holding
-- ─────────────────────────────────────────────────────────────
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  -- 'liquid'    : bank / e-wallet / cash (counts positively toward net worth)
  -- 'illiquid'  : MPF / stocks / deposit (tracked at cost via illiquid_moves)
  -- 'liability' : credit card etc. (balance owed, subtracted from net worth)
  type        text not null check (type in ('liquid','illiquid','liability')),
  currency    text not null default 'HKD',
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- SNAPSHOTS: one dated financial note (end-of-period)
-- ─────────────────────────────────────────────────────────────
-- One snapshot per calendar month. `period_year` + `period_month` (1-12)
-- identify it (shown as e.g. "August 2026"). `updated_at` tracks when you last
-- edited it (shown as "Last updated ..."). A unique constraint enforces one
-- snapshot per month per user.
create table if not exists public.snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_year   int not null,
  period_month  int not null check (period_month between 1 and 12),
  base_currency text not null default 'HKD',
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, period_year, period_month)
);

-- ─────────────────────────────────────────────────────────────
-- BALANCES: a balance line within a snapshot (for liquid & liability accounts)
-- exchange_rate = units of this line's currency per 1 unit of base currency's
-- value... stored as "multiply amount by nothing; convert via rate" — see app.
-- We store amount in its own currency + the rate to base so history is stable.
-- For 'liability' accounts, amount is the positive amount OWED (app subtracts).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.balances (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_id   uuid not null references public.snapshots(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  amount        numeric not null default 0,
  currency      text not null default 'HKD',
  -- value in base currency = amount * exchange_rate
  -- (rate of 1 means same currency as base)
  exchange_rate numeric not null default 1,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- ILLIQUID MOVES: contribution/withdrawal at cost within a snapshot
-- ─────────────────────────────────────────────────────────────
create table if not exists public.illiquid_moves (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_id   uuid not null references public.snapshots(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  direction     text not null check (direction in ('in','out')),
  amount        numeric not null default 0,
  currency      text not null default 'HKD',
  exchange_rate numeric not null default 1,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- INCOME: income lines within a snapshot (fixed salary + side income)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.income (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_id   uuid not null references public.snapshots(id) on delete cascade,
  kind          text not null check (kind in ('fixed','side')),
  label         text,
  amount        numeric not null default 0,
  currency      text not null default 'HKD',
  exchange_rate numeric not null default 1,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- INCOME DEFAULTS: one row per user; drives fixed-income auto-fill and
-- optional auto-routing of part of income into an illiquid account.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.income_defaults (
  user_id                    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  fixed_amount               numeric not null default 0,
  currency                   text not null default 'HKD',
  auto_route_illiquid_account_id uuid references public.accounts(id) on delete set null,
  auto_route_amount          numeric not null default 0,
  updated_at                 timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- AUTO ROUTES: fixed monthly slices of income that are auto-recorded as
-- contributions into an illiquid account. One row per route; a user can have
-- several (e.g. 1000 -> MPF, 500 -> stocks). Pre-filled into each new month.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.auto_routes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  amount      numeric not null default 0,
  currency    text not null default 'HKD',
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- EXPENSE LINES: big-picture breakdown per snapshot (editable)
-- These are descriptive only; the total expense is derived from net worth.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.expense_lines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  category    text not null default 'other',
  label       text,
  amount      numeric not null default 0,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- TRANSACTIONS: parsed spending lines (categorization only; NOT in expense math)
-- is_transfer flags self-payments / wallet top-ups to exclude from category totals.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  snapshot_id       uuid not null references public.snapshots(id) on delete cascade,
  source_account_id uuid references public.accounts(id) on delete set null,
  txn_date          date,
  description       text,
  amount            numeric not null default 0,
  currency          text not null default 'HKD',
  category          text not null default 'other',
  is_transfer       boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY: enable on all tables + owner-only policies
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','snapshots','balances','illiquid_moves',
    'income','income_defaults','expense_lines','transactions','auto_routes'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    -- drop old policy if present, then create a single all-actions policy
    execute format('drop policy if exists owner_all on public.%I;', t);
    execute format($f$
      create policy owner_all on public.%I
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- Helpful indexes
create index if not exists idx_snapshots_user_period on public.snapshots(user_id, period_year, period_month);
create index if not exists idx_balances_snapshot   on public.balances(snapshot_id);
create index if not exists idx_illiquid_snapshot   on public.illiquid_moves(snapshot_id);
create index if not exists idx_income_snapshot     on public.income(snapshot_id);
create index if not exists idx_expense_snapshot    on public.expense_lines(snapshot_id);
create index if not exists idx_txn_snapshot        on public.transactions(snapshot_id);
create index if not exists idx_autoroutes_user      on public.auto_routes(user_id);
