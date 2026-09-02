# Bloom Split — Expense Tracker Plan

Bloom becomes **two independent trackers** behind one login:

- **Asset Tracker** — the existing net-worth engine (snapshots, balances, growth).
- **Expense Tracker** — new. Shared wallets for splitting bills with different
  groups of people.

Two trackers, two separate calculations, **no combining**. Money in one never
feeds the other's math.

---

## 1. Navigation & flow

The confusion risk is having two things called "expense" that mean different
things. The fix is that they never appear on the same screen. Home is a fork;
from there you are in one tracker or the other, and the back path always leads
home.

```
                      ┌──────────────┐
                      │     HOME     │   "Bloom" intro + two choices
                      └──────┬───────┘
              ┌──────────────┴──────────────┐
              ▼                             ▼
     ┌─────────────────┐          ┌──────────────────┐
     │  ASSET TRACKER  │          │ EXPENSE TRACKER  │
     │  (today's app)  │          │      (new)       │
     ├─────────────────┤          ├──────────────────┤
     │ Add a month     │          │ My wallets       │
     │ History         │          │  ├ Friends       │
     │ Accounts        │          │  ├ Flatmate      │
     │ Statistics      │          │  └ Boyfriend     │
     └─────────────────┘          └──────────────────┘
       net worth, growth,           who owes whom,
       derived expense              settle up, pie
```

### Home screen

```
┌───────────────────────────────────────────────┐
│                    Bloom                      │
│   Give your money room to bloom.              │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  ▭   Asset Tracker                      │  │
│  │      Net worth, growth, and monthly     │  │
│  │      spending          HK$ 482,300  ›   │  │
│  └─────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────┐  │
│  │  ⇄   Expense Tracker                    │  │
│  │      Split bills with friends,          │  │
│  │      flatmates, and partners            │  │
│  │                    you're owed $340  ›  │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

Each card shows one live number, so home is useful rather than just a menu.

**Naming rule to keep it unambiguous.** The word "expense" means two different
things, so each tracker uses its own vocabulary and never the other's:

| Asset Tracker says | Expense Tracker says |
|---|---|
| month, snapshot | wallet, expense |
| **spending** (derived from net worth) | **spent** / **your share** |
| accounts (your banks) | wallets (shared books) |
| net worth, growth | balance, owes |

The Asset Tracker's derived figure is labelled **"Spending"**; the Expense
Tracker never uses that word for a total. No screen ever shows both.

### Routes

| Route | Screen |
|---|---|
| `home` | the fork above (new default landing) |
| `dashboard` | Asset Tracker home (today's dashboard, unchanged) |
| `snapshot` `history` `accounts` `summary` | unchanged |
| `wallets` | Expense Tracker home — list of your wallets |
| `wallet` | one wallet: balances, recent expenses, pie |
| `expense` | add / edit an expense |
| `settle` | settle up |
| `walletSettings` | rename, members, archive |

Back behaviour: Asset sub-pages go back to `dashboard`; Expense sub-pages go
back to `wallets`; both tracker homes go back to `home`. You can never
accidentally cross from one tracker into the other's sub-page.

---

## 2. Wallets — the sharing model

A **wallet** is one shared expense book with its own members, currency, and
balances. You can be in as many as you like:

```
Grace's wallets
├── 🎉 Friends      Grace, Alex, Becca      you're owed  $240
├── 🏠 Flatmate     Grace, Sam              you owe       $85
├── ❤️ Boyfriend    Grace, Jamie            settled up
└── ✈️ Japan trip   Grace, Alex, Becca, Sam  you're owed  $1,200   [archived]
```

Wallets are fully independent. A debt in "Friends" never nets against one in
"Flatmate" — you settle each separately, because in real life you pay Alex and
your flatmate separately. Alex being in two of your wallets is fine; they're
tracked as two distinct memberships with separate balances.

### Members, and how a person gets added

This is the part worth getting exactly right. A member is **not** a user
account — it's a named seat in a wallet that *may* be linked to an account.

```
member = { wallet_id, display_name, user_id (nullable), invite_email (nullable) }
```

That nullable `user_id` is what makes the whole thing flexible. Three ways in,
all producing the same kind of row:

**A. Add by name only** — "Becca". No account, no email. She can't log in and
see it, but you can track what she owes immediately. Use this for people who'll
never use the app. **Zero friction, and it's the default.**

**B. Invite by email** — you enter `alex@example.com`. The member row is
created with `invite_email` set and `user_id` still null, so you can start
adding expenses right away. When Alex signs up (or next signs in) with that
email, Bloom links the row: `user_id` is filled in and the wallet appears in
Alex's list, with all history already there.

**C. Link an existing member later** — Becca finally makes an account. Open
wallet settings, tap her name, "invite by email". Same linking mechanism. **No
expense is ever rewritten**, because expenses point at `member_id`, never
`user_id`.

```
      Add member
          │
    ┌─────┴─────┐
    ▼           ▼
 name only   + email
 user_id=∅   invite_email set, user_id=∅
    │           │
    │           ▼                    on signup/signin with
    │      ┌──────────┐              a matching email
    │      │  linked  │◀─────────────────────────────
    │      │ user_id  │
    │      │   set    │
    └─────▶└──────────┘
      (add email later)
```

**The linking step** runs once at login: look for member rows whose
`invite_email` matches the signed-in user's email and whose `user_id` is null,
then claim them. It's a single call in `enterApp()`, implemented as a
`security definer` SQL function so it can write rows the user can't yet see.

**Why email-matching over invite codes.** No code to relay, no expiry, nothing
to explain — you type the email you already know, and it just works when they
join. The cost is that it only fires for the exact address they sign up with;
wallet settings shows "invited, not yet joined" so a typo is visible and
editable.

**Removing someone** sets `left_at` rather than deleting. Their past expenses
keep a valid payer, and their name still renders in history. New expenses stop
including them.

---

## 3. Calculation — kept entirely separate

The Asset Tracker's rule is unchanged: *balances drive net worth and derived
spending; transactions drive only the breakdown.*

The Expense Tracker has its own, parallel rule:

> **Shared expenses are their own ledger.** They never touch `snapshots`,
> `balances`, or the derived-spending math.

Your net worth already reflects shared spending — when you pay for dinner your
bank balance drops, and the Asset Tracker's derived figure catches it
automatically. Logging that dinner in a wallet is about *fairness between
people*, not your expense total. Feeding one into the other would double-count.
Two clean ledgers, no shared math, as you asked.

### Balance math (per wallet)

```
For each member:
  paid    = Σ expenses they paid for
  owed    = Σ their shares across all expenses
  settled = Σ settlements sent − Σ settlements received
  net     = paid − owed + settled        (positive = they are owed)
```

Then **simplify**: greedily match the biggest creditor against the biggest
debtor. Three people with tangled mutual debts collapse to at most two
payments — nobody wants to make three transfers that cancel out.

All computed client-side in `split.js`, mirroring how `snapshot.js` derives
rather than stores, so edits always recompute correctly.

---

## 4. Data model

```
wallets           a shared expense book
  id, name, emoji, base_currency, created_by, created_at, archived

wallet_members    a seat in a wallet (one row per person per wallet)
  id, wallet_id, user_id (nullable), invite_email (nullable),
  display_name, is_owner, joined_at, left_at (nullable)

shared_expenses   one shared cost
  id, wallet_id, paid_by_member_id, spent_on, description, category,
  amount, currency, exchange_rate, split_mode ('equal'|'exact'),
  created_by, created_at

expense_shares    who owes what for one expense
  id, expense_id, member_id, share_amount

settlements       a reimbursement payment
  id, wallet_id, from_member_id, to_member_id, amount, currency,
  exchange_rate, settled_on, note, created_by, created_at
```

Named `wallets` / `shared_expenses` so nothing collides with the existing
`accounts` and `expense_lines` tables, in the database or in conversation.

**Why `expense_shares` is a real table.** Equal splits could be derived on the
fly, but stored shares make overrides, exclusions, and rounding share one code
path — and they freeze history, so adding a fourth housemate in March can't
silently rewrite February's three-way splits.

**Rounding.** Remainder cents go to the earliest members, so shares always sum
exactly to the total: `$10.00 / 3` → `3.34 / 3.33 / 3.33`, never a lost cent.

### RLS: membership-based

Every existing table uses owner-only RLS (`user_id = auth.uid()`). Shared data
can't work that way — two people must read and write the same rows. Split
tables ask instead: *is the current user a member of this wallet?*

```sql
create function public.is_wallet_member(wid uuid) returns boolean
  language sql security definer stable as $$
    select exists (
      select 1 from public.wallet_members
      where wallet_id = wid and user_id = auth.uid() and left_at is null
    );
  $$;
```

`security definer` matters: without it, the policy on `wallet_members` would
recurse into itself. Policies read `using (public.is_wallet_member(wallet_id))`;
`expense_shares` has no `wallet_id`, so it joins through its parent expense.

**Deliberate trade-off:** any member can edit or delete any expense in their
wallet. Splitting bills is high-trust, and per-row author locks add friction to
fixing a typo your partner made. `created_by` keeps authorship visible.

---

# PHASE 1 — Build spec  ✅ BUILT

> Kept as the design record. See **STATUS** at the end of this file for what
> shipped, including work beyond the original plan.

Goal: **the two-tracker structure exists, and wallets can be created, shared,
and joined.** No expenses yet. This phase is where the risk lives (new security
model, new nav); everything after it is ordinary CRUD.

### 1.1 Database — `setup/split-schema.sql` (new file)

Written in the style of the existing `schema.sql`: `if not exists`, re-runnable,
commented, with a commented-out reset block.

- Create the five tables above.
- `is_wallet_member(uuid)` — `security definer stable`.
- `claim_wallet_invites()` — `security definer`; sets `user_id = auth.uid()` on
  rows where `invite_email` matches the caller's email and `user_id is null`.
  Returns the number claimed.
- Enable RLS on all five; policies:
  - `wallets` — select/update where `is_wallet_member(id)`; insert where
    `created_by = auth.uid()`.
  - `wallet_members` — select where `is_wallet_member(wallet_id)`;
    insert/update/delete where the caller is an **owner** of that wallet.
  - `shared_expenses`, `settlements` — all actions where
    `is_wallet_member(wallet_id)`.
  - `expense_shares` — all actions where the parent expense's wallet passes.
- Indexes: `wallet_members(user_id)`, `wallet_members(wallet_id)`,
  `wallet_members(invite_email) where user_id is null`,
  `shared_expenses(wallet_id, spent_on)`, `expense_shares(expense_id)`,
  `settlements(wallet_id)`.

**Grace runs this once** in the Supabase SQL Editor, same as the original schema.

### 1.2 `split.js` (new file)

Data layer + math, no DOM. Exports `window.Split`:

```
loadWallets()                    wallets + members + your net position
createWallet(name, emoji, cur)   creates wallet + your owner member row
addMember(walletId, name, email) name-only or invited
updateMember(memberId, patch)    rename, add email later
removeMember(memberId)           soft: sets left_at
claimInvites()                   calls the SQL function at login
computeBalances(expenses, settlements, members)   → per-member net
simplifyDebts(balances)          → minimal [{from, to, amount}]
allocateShares(amount, members, mode, overrides)  → cent-exact shares
```

Balance/split functions are written in Phase 1 (pure, easy to reason about) but
only exercised in Phase 2. `loadWallets` returns zeroed balances until then.

### 1.3 `app.js` changes

1. **New `home` route** — Bloom intro + two tracker cards, each with its live
   number. Becomes the landing view.
2. `enterApp()` — `routeTo("home")` instead of `"dashboard"`; add
   `await Split.claimInvites()` before it, so a wallet someone invited you to is
   already present on first load.
3. **`dashboard` route** — unchanged internals; gains a back bar to `home` and
   a header clarifying it's the Asset Tracker.
4. **New routes** `wallets` and `walletSettings`.
5. `setNav(true)` — signed-in logo goes to `home`, not `dashboard`.
6. `backBar()` — already takes a route argument, so Expense pages pass
   `"wallets"`. No change needed.

### 1.4 Screens in Phase 1

**Home** — as drawn above. Asset card shows latest net worth (or "get started");
Expense card shows your total position across wallets (or "set up a wallet").

**Wallets list** — your wallets with member avatars-by-initial and your position
in each; a "New wallet" button; archived wallets collapsed below.

**New wallet** — name, emoji picker, base currency (defaults to your Bloom base
currency), then "add people" inline: a name field plus an optional email field,
repeatable. You're added automatically as owner.

**Wallet settings** — rename, change emoji/currency, member list showing status
(`joined` / `invited — not yet joined` / `name only`), add member, add an email
to an existing member, remove member, archive wallet.

### 1.5 `style.css` additions (~90 lines)

`.tracker-card` (the big home cards), `.wallet-row`, `.member-chip`,
`.member-status`, `.emoji-picker`. All built from existing tokens
(`--shell`, `--accent-soft`, `--radius`) and the `.action-card` pattern, so it
looks like the rest of Bloom with no new visual language.

### 1.6 `index.html`

One line: `<script src="split.js"></script>` before `app.js`.

### 1.7 Acceptance checks

Sharing correctness is the entire risk of this phase, so it's verified with two
real accounts before anything is built on top:

1. Home shows both cards; each leads to its tracker; back returns home.
2. The Asset Tracker works exactly as before — snapshots, history, charts.
3. Create a wallet, add a name-only member and an email-invited member.
4. **Sign in as the invited account:** the wallet appears automatically, with
   the member row linked.
5. **Sign in as a third, uninvited account:** the wallet is invisible — confirmed
   by a direct `select` on `wallets` returning zero rows, not just an empty UI.
6. A non-owner member cannot add or remove members (RLS rejects it).
7. Removing a member sets `left_at`; their name still renders.

### 1.8 Files touched

```
finance/
├── index.html            + 1 script tag
├── app.js                + home/wallets/walletSettings routes; enterApp
├── split.js        NEW   data layer + math
├── style.css             + ~90 lines
└── setup/
    └── split-schema.sql  NEW   tables, functions, RLS, indexes
```

`snapshot.js`, `charts.js`, `statements.js`, `supabase.js`: **untouched**. The
Asset Tracker keeps working throughout.

---

## Later phases (summary)

- **Phase 2 — Expenses & balances.** Add/edit/delete expense with equal-split
  default and custom override; wallet home with headline balance and recent
  expenses. *Deployable as a working splitter.*
- **Phase 3 — Settle up.** Settlements pre-filled from simplified debts, partial
  payments, history.
- **Phase 4 — Insights.** Spending pie via the existing
  `Charts.spendingPie(items, cur)`, which already takes exactly the
  `[{label, amount}]` shape the aggregation produces. Month and category filters.
- **Phase 5 — Polish.** Recurring expenses, quick-add, CSV export.

---

# STATUS (as of 2026-09-02)

**Phases 1 to 4 are built and in daily use.** Phase 5 was dropped as not needed.
Day-to-day history now lives in `DEVELOPMENT-LOG.md`; this file stays as the
design rationale.

Built beyond the original plan:

- **Installable app (PWA)** — manifest, service worker, icons.
- **Push notifications** — expense added, settlement recorded, someone joins a
  wallet, plus a weekly digest. See `setup/NOTIFICATIONS.md`.
- **Modal settings** — wallet settings open in a modal, with People stacked on
  top, rather than navigating to a page.
- **Editable settlements** — tapping a recorded payment opens an editor with
  delete; balances recalculate since they are always derived.

Two things remain **unverified from the development side** and rest on Grace's
own testing:

1. The membership RLS was never exercised with two real accounts — specifically
   that a non-member gets **zero rows from a direct query**, not merely an empty
   screen. Worth checking next time someone new is added to a wallet.
2. End-to-end push delivery was never observed here, only the routing logic and
   the setup steps.

If picking this up later, the natural next steps are: replacing the native
`confirm()` on member removal with an inline confirmation (the least app-like
part of the flow), and extending the modal pattern to the expense form and
settle-up if the direction proves right.
