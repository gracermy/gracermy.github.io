# Finance Growth Tracker — Implementation Plan

## Context

Grace tracks her financial growth with a manual, low-effort system: at the end of each period she snapshots the balances of all her banks/e-wallets/cash (liquid) plus contributions to illiquid assets (MPF, stocks, deposits, recorded at cost — never marked to market), records her income, and *derives* her expense from the change in net worth rather than logging transactions. She wants this as a private, multi-user web app on her GitHub Pages site, accessible from any device, with AI reading her uploaded bank/credit-card statements to eliminate manual data entry and categorize spending.

The core financial model (validated against two real statements — HSBC One asset statement, Mox Credit card statement):

```
Net worth    = Σ assets owned (liquid + illiquid-at-cost)  −  Σ liabilities owed (card balances)
Real expense = Total income (fixed + side)  −  Δ net worth      [over the period between two snapshots]
```

Key rule that avoids double-counting: **balances drive net worth & expense; transactions drive ONLY the categorized spending breakdown, never the expense total.** A credit card is a *liability* line (negative) in the snapshot — spending on it then paying it off nets to zero across snapshots, so there is no timing/misalignment problem. Transfers/self-payments (e.g. paying own card bill, topping up Octopus) are excluded from categorization.

### Locked decisions
- **Data/auth:** Supabase free tier — email/password login, per-user private data via row-level security (RLS). Data never in the public repo.
- **Currency:** Convert all to a base currency; exchange rate is manual but **pre-filled** from the statement when printed (HSBC prints USD 7.8418, AUD 5.4943).
- **Income:** Track fixed monthly (auto-filled) + side income; supports auto-routing part of income to illiquid.
- **AI:** Claude API, **Haiku 4.5**, called via a Supabase Edge Function that holds the secret API key. Est. cost ~$0.05–0.10/month. Output is a **draft the user edits**, never blind-trusted.
- **Invite passkey (added after approval):** A single shared invite passkey gates account creation, to protect Grace's Claude API spend from random public signups. Decision = **browser-checked** (simplest) via `INVITE_PASSKEY` in config; the signup form rejects unless it matches. Caveat: browser-checked = casual gate only (visible in source). The real API-spend protection is the **server-side check in the Phase 3 Edge Function** (refuses to run for anyone + can cap usage). Grace also disables public signups in Supabase once her few users are in.
- **Location:** `/finance` subfolder of `gracermy.github.io` (matches existing `/games`, `/booth` convention).
- **Tech:** Plain HTML/CSS/JS, no build step. Reuse existing site design tokens (rose/pink glassmorphism, Instrument Serif + Source Sans 3 + JetBrains Mono, `data-theme` light/dark, `blossom.js` background).

### What the user must set up (cannot be automated)
1. A **Supabase project** (free) → provides project URL + public anon key (both safe for client code).
2. A **Claude API account** at console.anthropic.com (separate billing) → provides a secret API key, stored only in the Edge Function.

---

## Architecture

```
gracermy.github.io/finance/           GitHub Pages (static)
├── index.html          app shell: auth gate + SPA views
├── style.css           reuses site design tokens
├── app.js              router, auth session, view orchestration
├── supabase.js         Supabase client init (URL + anon key — public)
├── snapshot.js         snapshot form + net-worth/expense computation
├── charts.js           growth visualizations (dataviz skill)
├── statements.js       PDF upload → calls Edge Function → draft review UI
└── config.sample.js    template for URL/anon key (real config gitignored)

Supabase (cloud, free tier)
├── Postgres DB         tables below, all RLS-protected by auth.uid()
├── Auth                email/password
└── Edge Function       parse-statement: holds CLAUDE_API_KEY secret,
                        sends PDF to Haiku 4.5, returns structured draft JSON
```

Client → Supabase Auth for login; client → Postgres (RLS) for all data; client → Edge Function only for statement parsing (function calls Claude, never exposes the key).

---

## Data model (Postgres, all tables RLS-scoped to `user_id = auth.uid()`)

- **accounts** — a bank/wallet/card the user owns. `id, user_id, name, type` (liquid | illiquid | liability), `currency, is_active`.
- **snapshots** — one dated financial note. `id, user_id, snapshot_date, base_currency, note`.
- **balances** — a balance line within a snapshot. `snapshot_id, account_id, amount, currency, exchange_rate` (rate to base; pre-filled from statement). For liability accounts, amount stored as owed (subtracted in net-worth calc).
- **illiquid_moves** — contribution/withdrawal at cost. `snapshot_id, account_id, direction` (in|out), `amount, currency, exchange_rate`.
- **income** — `snapshot_id, kind` (fixed|side), `label, amount, currency, exchange_rate`. Fixed pre-filled from a user default.
- **income_defaults** — `user_id, fixed_amount, currency, auto_route_illiquid_account_id, auto_route_amount` (drives auto-fill + auto-routing).
- **expense_lines** — big-picture breakdown per snapshot. `snapshot_id, category, label, amount`. Auto-seeded (rent, catch-all); user edits.
- **transactions** — parsed spending lines (categorization only, NOT in expense math). `snapshot_id, source_account_id, txn_date, description, amount, currency, category, is_transfer` (excluded when true).

Derived values (net worth, Δ net worth, real expense) are **computed in the client** from these tables, not stored, so corrections always recompute correctly.

---

## Build phases

Each phase ends in a usable/deployable state.

### Phase 0 — Foundations
- Grace creates the Supabase project; I provide SQL to create all tables + RLS policies + `income_defaults`.
- Scaffold `/finance/` files; add real Supabase config path to `.gitignore`; commit `config.sample.js`.
- Deploy: login page works on GitHub Pages, one test account logs in and sees an empty dashboard.

### Phase 1 — Core net-worth engine (manual entry) — *usable on its own*
- Auth gate (redirect to login if no session; "stay logged in").
- Manage accounts (add bank/wallet/cash/card/illiquid, set currency).
- New snapshot form: liquid balances (amount + currency + rate), illiquid moves, liability balances, income (fixed auto-filled + side). Big-picture expense lines editable.
- Compute + display: net worth, Δ vs previous snapshot, **real expense = income − Δ net worth**, expense breakdown.
- Snapshot history list; open/edit past snapshots.

### Phase 2 — Growth visualization
- Load `dataviz` skill first. Charts: net worth over time, expense per period, asset composition (liquid/illiquid/liability), income vs expense. Theme-aware (light/dark).

### Phase 3 — AI statement reading (assets & liabilities)
- Grace creates Claude API account; I deploy the `parse-statement` Edge Function with `CLAUDE_API_KEY` as a Supabase secret.
- Upload asset/liability PDF (HSBC/Mox-type) → Haiku 4.5 returns structured draft: balances, printed exchange rates, liability balances, illiquid balances (e.g. MPF) → review/correct UI writes into the snapshot.

### Phase 4 — Spending categorization
- From spending statements, AI categorizes transactions (food/transport/shopping/fitness/other) as an **editable draft**, auto-flagging transfers/self-payments for exclusion. Feeds `expense_lines` breakdown only — never the expense total.

---

## Critical files & reuse

- **Reuse design tokens** from `/Users/gracermy/my github/gracermy.github.io/games/index.html` (CSS `:root` / `[data-theme="dark"]` vars, nav, `.page-header-shell`, card styles) and `theme.js` (theme toggle + persistence). Copy the token block into `finance/style.css` so the app matches the site.
- **Reuse** `/blossom.js` (root) for the background canvas, as `/games/` does.
- New files all live under `/finance/`. No existing files change except adding the finance config path to `.gitignore` and optionally a nav link on the site.
- Supabase JS client loaded via CDN `<script>` (allowed on GitHub Pages; only the Artifact sandbox forbids CDNs — this is a normal hosted page).

## Security notes
- The **anon key is public by design** — safe in client code; RLS is what protects data. Every table has a policy `user_id = auth.uid()` for select/insert/update/delete.
- The **Claude API key is never in client code** — only in the Edge Function's server-side secret.
- Statement PDFs are sent to the Edge Function → Claude API for parsing (Phase 3+). Uploaded files are processed transiently, not stored, unless we add opt-in storage later.

## Verification
- **Phase 0/1:** Load `/finance/` locally (`python3 -m http.server` in the repo), sign up a test user, add accounts, create two snapshots with known numbers, confirm net worth, Δ, and real expense match hand calculation. Log in on a second device/browser to confirm sync + isolation (a second account sees no data). Verify via `/verify` skill end-to-end.
- **Phase 2:** Confirm charts render correct series in both themes.
- **Phase 3/4:** Upload the two sample statements (HSBC, Mox) to a running Edge Function; confirm the draft matches the documents (HSBC HKD 36,066.75 / USD 9.28 @7.8418 / stocks 22,200 / MPF 35,940.41; Mox liability −4,424.55 with transactions categorized and the +6,095.91 self-payment + Octopus −500 flagged as transfers). Correct-and-save round-trips into the snapshot.
- Confirm one real month's derived expense is sane against Grace's manual note for the same period.

## Out of scope (later)
- Receipt (non-statement) photo upload, budgets/goals, recurring-expense auto-multiply for multi-month gaps (superseded by "upload every statement" approach), model swap to Sonnet if accuracy needs it.
