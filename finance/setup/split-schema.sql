-- Bloom Expense Tracker (split) — database schema + Row Level Security
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE throughout.
--
-- ⚠️ DIFFERENT SECURITY MODEL FROM schema.sql
-- Every table in schema.sql is owner-only: `user_id = auth.uid()`. That cannot
-- work here, because two or more people must read AND write the same rows.
-- These tables are instead scoped by MEMBERSHIP: "is the current user a member
-- of this wallet?" — see is_wallet_member() below.
--
-- This is a SEPARATE LEDGER from the asset tracker. Nothing here ever touches
-- snapshots / balances / the derived-spending math. Your net worth already
-- reflects shared spending (paying for dinner lowers your bank balance);
-- these tables exist to track fairness between people, not your expense total.
--
-- ─────────────────────────────────────────────────────────────
-- ⚠️ RESET (optional): if you ran an EARLIER version of this file and have NO
-- real data yet, uncomment to drop first, then run the rest.
-- ─────────────────────────────────────────────────────────────
-- drop table if exists
--   public.expense_shares, public.settlements, public.shared_expenses,
--   public.wallet_members, public.wallets
-- cascade;
-- drop function if exists public.is_wallet_member(uuid);
-- drop function if exists public.is_wallet_owner(uuid);
-- drop function if exists public.claim_wallet_invites();
-- ─────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────
-- WALLETS: one shared expense book ("Friends", "Flatmate", "Japan trip").
-- Wallets are fully independent: a debt in one NEVER nets against another,
-- because in real life you pay your flatmate and your friends separately.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.wallets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  emoji         text not null default '👛',
  base_currency text not null default 'HKD',
  created_by    uuid not null default auth.uid() references auth.users(id) on delete set null,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- WALLET MEMBERS: a named SEAT in a wallet, which MAY be linked to an account.
--
-- The nullable user_id is the key design decision. A member is not a user:
--   * name only        -> user_id null, invite_email null  ("Becca", no account)
--   * invited by email -> user_id null, invite_email set   (links on signup)
--   * linked           -> user_id set                      (they can log in)
--
-- Expenses reference member_id, NEVER user_id — so linking an account later,
-- or someone leaving, never rewrites a single expense row.
--
-- left_at soft-removes: past expenses keep a valid payer and their name still
-- renders in history; they're just excluded from new splits.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.wallet_members (
  id           uuid primary key default gen_random_uuid(),
  wallet_id    uuid not null references public.wallets(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  invite_email text,
  display_name text not null,
  is_owner     boolean not null default false,
  joined_at    timestamptz not null default now(),
  left_at      timestamptz
);

-- A person can hold only one active seat per wallet.
create unique index if not exists idx_wm_wallet_user
  on public.wallet_members(wallet_id, user_id) where user_id is not null;

-- ─────────────────────────────────────────────────────────────
-- SHARED EXPENSES: one shared cost, paid by one member, split among members.
-- split_mode 'equal' = evenly among included members; 'exact' = per-member
-- amounts. Either way the per-person amounts live in expense_shares.
-- value in wallet base currency = amount * exchange_rate (same rule as schema.sql)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.shared_expenses (
  id               uuid primary key default gen_random_uuid(),
  wallet_id        uuid not null references public.wallets(id) on delete cascade,
  paid_by_member_id uuid not null references public.wallet_members(id) on delete restrict,
  spent_on         date not null default current_date,
  description      text,
  category         text not null default 'other',
  amount           numeric not null default 0,
  currency         text not null default 'HKD',
  exchange_rate    numeric not null default 1,
  split_mode       text not null default 'equal' check (split_mode in ('equal','exact')),
  created_by       uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- EXPENSE SHARES: who owes what for one expense (one row per participant).
--
-- Stored rather than derived on the fly, for two reasons:
--   1. equal / exact / excluded all share one code path;
--   2. it FREEZES HISTORY — adding a 4th housemate in March must not silently
--      rewrite February's 3-way splits.
-- Shares always sum exactly to the expense amount (remainder cents go to the
-- earliest members, so $10/3 = 3.34 + 3.33 + 3.33, never a lost cent).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.expense_shares (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.shared_expenses(id) on delete cascade,
  member_id    uuid not null references public.wallet_members(id) on delete restrict,
  share_amount numeric not null default 0,
  unique (expense_id, member_id)
);

-- ─────────────────────────────────────────────────────────────
-- SETTLEMENTS: a reimbursement payment from one member to another.
-- Nothing is ever deleted to "clear" a balance — a settlement is a row that
-- offsets it, so the history stays auditable.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.settlements (
  id              uuid primary key default gen_random_uuid(),
  wallet_id       uuid not null references public.wallets(id) on delete cascade,
  from_member_id  uuid not null references public.wallet_members(id) on delete restrict,
  to_member_id    uuid not null references public.wallet_members(id) on delete restrict,
  amount          numeric not null default 0,
  currency        text not null default 'HKD',
  exchange_rate   numeric not null default 1,
  settled_on      date not null default current_date,
  note            text,
  created_by      uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);


-- ─────────────────────────────────────────────────────────────
-- MEMBERSHIP HELPERS
--
-- SECURITY DEFINER is REQUIRED, not an optimisation: these functions are called
-- from the RLS policy ON wallet_members. A plain function would re-enter that
-- policy to read the table and recurse infinitely. Running as the definer
-- bypasses RLS inside the function body, which is safe because each one only
-- ever answers a yes/no question about auth.uid() and leaks no rows.
--
-- search_path is pinned so the function can't be hijacked by a caller-set path.
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_wallet_member(wid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.wallet_members
    where wallet_id = wid
      and user_id = auth.uid()
      and left_at is null
  );
$$;

create or replace function public.is_wallet_owner(wid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.wallet_members
    where wallet_id = wid
      and user_id = auth.uid()
      and left_at is null
      and is_owner
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- CLAIM INVITES: called once at login. Finds member seats invited to this
-- user's email address that aren't linked yet, and links them.
--
-- SECURITY DEFINER is required here too: the rows being claimed are invisible
-- to the user under RLS *until* they're claimed — a chicken-and-egg the
-- function resolves. It is deliberately narrow: it only ever sets user_id to
-- auth.uid(), only on rows whose invite_email matches this user's OWN verified
-- email, and only where user_id is still null. It cannot touch anything else.
--
-- The `not exists` guard stops a duplicate seat being claimed if the user is
-- somehow already a member of that wallet (which the unique index would reject).
-- ─────────────────────────────────────────────────────────────
create or replace function public.claim_wallet_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text;
  claimed  integer;
begin
  select email into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;

  update public.wallet_members m
     set user_id = auth.uid(),
         joined_at = now()
   where m.user_id is null
     and m.left_at is null
     and lower(m.invite_email) = lower(my_email)
     and not exists (
       select 1 from public.wallet_members other
        where other.wallet_id = m.wallet_id
          and other.user_id = auth.uid()
     );

  -- GET DIAGNOSTICS gives the row count as an integer directly, avoiding the
  -- bigint that count(*) would return.
  get diagnostics claimed = row_count;
  return coalesce(claimed, 0);
end;
$$;

-- The client calls these as logged-in users, so they need EXECUTE. (Supabase
-- grants EXECUTE on new functions to public by default, but being explicit
-- keeps this file correct if that default ever changes.)
grant execute on function public.is_wallet_member(uuid)   to authenticated;
grant execute on function public.is_wallet_owner(uuid)    to authenticated;
grant execute on function public.claim_wallet_invites()   to authenticated;


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--
-- Trade-off, chosen deliberately: any member can edit or delete any expense in
-- their wallet, including one someone else entered. Splitting bills is a
-- high-trust activity and per-row author locks add friction to fixing a typo
-- your flatmate made. created_by keeps authorship visible in the UI.
-- Membership itself is stricter: only owners can add or remove members.
-- ─────────────────────────────────────────────────────────────
alter table public.wallets         enable row level security;
alter table public.wallet_members  enable row level security;
alter table public.shared_expenses enable row level security;
alter table public.expense_shares  enable row level security;
alter table public.settlements     enable row level security;

-- ── wallets ──
-- Select: members see the wallet. The `created_by` clause is REQUIRED, not a
-- convenience: creating a wallet does `insert ... select()`, and at that instant
-- the creator has no member row yet, so a membership-only test would return
-- zero rows and the client would think the insert failed. It grants nothing
-- extra long-term — the creator adds their owner row microseconds later.
drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets
  for select using (
    public.is_wallet_member(id) or created_by = auth.uid()
  );

-- Insert: you may only create a wallet in your own name. The creator has no
-- member row yet at this instant, so membership can't be the test here — the
-- client adds itself as the owner member immediately afterwards.
drop policy if exists wallets_insert on public.wallets;
create policy wallets_insert on public.wallets
  for insert with check (created_by = auth.uid());

drop policy if exists wallets_update on public.wallets;
create policy wallets_update on public.wallets
  for update using (public.is_wallet_member(id))
          with check (public.is_wallet_member(id));

drop policy if exists wallets_delete on public.wallets;
create policy wallets_delete on public.wallets
  for delete using (public.is_wallet_owner(id));

-- ── wallet_members ──
-- Select: members see the roster. The `created_by` clause covers the moment
-- between creating a wallet and inserting your own owner row.
drop policy if exists wm_select on public.wallet_members;
create policy wm_select on public.wallet_members
  for select using (
    public.is_wallet_member(wallet_id)
    or user_id = auth.uid()
    or exists (select 1 from public.wallets w
                where w.id = wallet_id and w.created_by = auth.uid())
  );

-- Insert: wallet owners add members. The second clause lets the creator insert
-- their OWN first owner row, before any membership exists.
drop policy if exists wm_insert on public.wallet_members;
create policy wm_insert on public.wallet_members
  for insert with check (
    public.is_wallet_owner(wallet_id)
    or exists (select 1 from public.wallets w
                where w.id = wallet_id and w.created_by = auth.uid())
  );

drop policy if exists wm_update on public.wallet_members;
create policy wm_update on public.wallet_members
  for update using (public.is_wallet_owner(wallet_id))
          with check (public.is_wallet_owner(wallet_id));

drop policy if exists wm_delete on public.wallet_members;
create policy wm_delete on public.wallet_members
  for delete using (public.is_wallet_owner(wallet_id));

-- ── shared_expenses ──
drop policy if exists se_all on public.shared_expenses;
create policy se_all on public.shared_expenses
  for all using (public.is_wallet_member(wallet_id))
      with check (public.is_wallet_member(wallet_id));

-- ── expense_shares ──
-- No wallet_id column, so the check joins through the parent expense.
drop policy if exists es_all on public.expense_shares;
create policy es_all on public.expense_shares
  for all using (
    exists (select 1 from public.shared_expenses e
             where e.id = expense_id and public.is_wallet_member(e.wallet_id))
  )
  with check (
    exists (select 1 from public.shared_expenses e
             where e.id = expense_id and public.is_wallet_member(e.wallet_id))
  );

-- ── settlements ──
drop policy if exists st_all on public.settlements;
create policy st_all on public.settlements
  for all using (public.is_wallet_member(wallet_id))
      with check (public.is_wallet_member(wallet_id));


-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
create index if not exists idx_wm_user      on public.wallet_members(user_id);
create index if not exists idx_wm_wallet    on public.wallet_members(wallet_id);
create index if not exists idx_wm_invite    on public.wallet_members(lower(invite_email))
  where user_id is null;
create index if not exists idx_se_wallet    on public.shared_expenses(wallet_id, spent_on);
create index if not exists idx_es_expense   on public.expense_shares(expense_id);
create index if not exists idx_st_wallet    on public.settlements(wallet_id, settled_on);
