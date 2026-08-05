# Finance Tracker — Development log

A running record of what we built for the private finance growth tracker at
`/finance`, why, and how. Most-recent first. Mirrors the style of
`docs/development-log.md`.

The full approved implementation plan (all decisions + rationale) is preserved in
`finance/PLAN.md` — read that first for the complete design context.

---

## Phase 2 + 3 — Growth charts + AI statement reading (BUILT, 2026-08-06)

**Phase 2 — growth charts (`finance/charts.js`, verified light + dark):**
- Loaded the `dataviz` skill; validated the 3-hue composition palette with its
  script (passes with the standard relief note → composition chart always shows
  direct labels). Charts are inline SVG (no external lib), theme-aware via
  `--series-*` CSS vars added to `style.css` (accent = brand rose for net worth;
  green/red for income/expense; blue/green/red for liquid/illiquid/liabilities).
- Three charts on the dashboard: **Net worth over time** (area+line, hover
  crosshair + tooltip), **Income vs expense** (grouped bars, legend), **What
  you're made of** (stacked bars, liabilities below the zero line, legend). Each
  has hover tooltips; thin marks, 2px gaps, recessive grid. `window.Charts.render`.

**Phase 3 — AI statement reading (assets, liabilities, spending):**
- **`finance/setup/edge-functions/parse-statement/index.ts`** — Supabase Edge
  Function (Deno). Uses **Claude Haiku 4.5** (`claude-haiku-4-5`) with a base64
  PDF `document` block + a strict extraction system prompt. Returns a structured
  DRAFT: `statement_kind`, period, `balances`, `liabilities` (positive amount
  owed), `illiquid_balances`, and `transactions` (with `category` + `is_transfer`).
  **This function is the real API-spend gate:** requires a valid Supabase auth
  session AND a server-side `INVITE_PASSKEY` check (secrets: `CLAUDE_API_KEY`,
  `INVITE_PASSKEY`). The Claude key never touches website code.
- **`finance/statements.js`** — upload widget + draft review UI (`window.
  BloomStatements`). Uploads PDF → Edge Function → renders an editable draft →
  Apply. All values editable; nothing saved until Apply.
- **`app.js` integration** — snapshot form shows the widget when `AI_STATEMENTS`
  is true (config). `applyDraft` fills balance rows and seeds big-picture expense
  lines from categories. **BUG FOUND + FIXED in verification:** the first
  name-matcher matched the liability "Mox Credit Card" onto the liquid "Mox"
  account (both contain "mox"). Fixed by restricting matches to the correct
  account TYPE (liabilities↔liability accounts only) and preferring exact name
  matches before substring. Re-tested: Mox Credit Card→liability row, plain
  Mox untouched, US Broker gets printed FX rate, Octopus top-up excluded as a
  transfer. This is the exact double-count trap flagged when reading the real
  Mox statement.
- **`finance/supabase.js`** — added `functionsUrl()` (derives
  `*.functions.supabase.co`) and `aiEnabled()`. **config** gained `AI_STATEMENTS`
  (default false).
- **`finance/setup/edge-functions/README.md`** — full deploy guide (Claude API
  account, Supabase CLI, secrets, deploy, flip `AI_STATEMENTS`).

**Grace must do for Phase 3 (not automatable):** create a Claude API account at
console.anthropic.com + add credit; install Supabase CLI; `supabase secrets set
CLAUDE_API_KEY / INVITE_PASSKEY`; deploy the function; set `AI_STATEMENTS: true`.
Cost ~pennies/month (Haiku). Model is one line to swap to Sonnet 5 if needed.

**Preview note:** `finance/preview.html` mocks `BloomStatements.parseStatement`
and sets `aiEnabled()` true so the widget is clickable with sample draft data;
`?route=newmonth` opens a fresh Add-a-month form. Throwaway file.

---

## UI refinement pass 1 — branding, month-based model, copy (2026-08-06)
**Done, verified in preview harness.**

- **Branding:** app name is **Bloom**. Login slogan "Give your money room to bloom."
  Dashboard header "Bloom" + "Your assets, growth, and spending, all in one calm place."
  Footer "Bloom · made with love by @gracermy" (the footer middot is the ONLY middot kept).
- **Copy rule:** removed every em-dash (—) and middot (·) from user-facing app copy
  (Grace's preference), except the footer. Dropdowns/hints reworded to parentheses/commas.
- **Month-based model (schema change):** snapshots are now one-per-calendar-month.
  `snapshots.snapshot_date` → replaced by `period_year` + `period_month` (1-12) with a
  `unique(user_id, period_year, period_month)` constraint, plus `updated_at`. Snapshot form
  uses Month + Year dropdowns (no date picker); dashboard/history show "August 2026" and
  "Last updated <date>". `snapshot.js` gained `periodLabel/periodKey/fmtUpdated/MONTH_NAMES`;
  `_date` is now `periodKey(year,month)` ("YYYY-MM") for ordering. Save enforces one-per-month
  (blocks a clashing month, points user to History to edit). **Anyone who already ran the old
  schema.sql must re-run the updated `setup/schema.sql`** (it's pre-first-use, so fine).
- **Dashboard:** "Change" card renamed **"Growth"** ("vs previous month"); Expense sub reads
  "income minus growth"; buttons "+ Add a month"; "Recent months" list.
- **Auto-route UX:** in Income defaults, auto-route is now **add/remove** (not always shown)
  with an **ⓘ info button** explaining it is a *slice of fixed income* recorded as an illiquid
  contribution — it does NOT add to income (confirmed intent). New CSS `.info-btn`/`.info-box`.
- **`finance/preview.html`** (throwaway, gitignore-worthy): a self-contained mock-data harness
  so Grace can click through all logged-in screens without an account. Uses a fake Supabase
  client; writes nothing. Updated to the month/year sample data. `?route=` deep-link for
  screenshots. NOT part of the shipped app — delete before/at go-live if desired.

---

## Phase 0 + 1 — Foundations + core net-worth engine (BUILT)
**Date:** 2026-08-05 — *usable app; login + accounts + snapshots + derived expense working & verified*

**Concept (Grace's system, mimicked):** Not a transaction tracker. Each period she
snapshots the *balances* of every bank/e-wallet/cash (liquid) + records contributions
to illiquid holdings (MPF, stocks, deposits — **at cost, never marked to market**),
records income, and **derives expense from the change in net worth** rather than logging
purchases. Core formulas:
```
Net worth    = Σ liquid (→base) + Σ illiquid-at-cost (→base) − Σ liabilities/cards (→base)
Real expense = total income (→base) − Δ net worth   (vs previous snapshot)
```
Balances drive net worth & expense; a credit-card statement's balance is a **liability**
(negative), so card spending + later repayment nets to zero across snapshots — no
double-count/timing problem. (This split was validated against two real statements:
HSBC One = asset statement, Mox = credit/spending statement.)

**Built:**
- **`finance/index.html`** — app shell. Reuses the site's nav, `/theme.js`, `/blossom.js`
  background, and fonts. Loads the Supabase UMD SDK from jsDelivr CDN, then `config.js`
  (gitignored), then app modules. `noindex` meta so the private app isn't crawled.
- **`finance/style.css`** — lifted the site's design tokens (rose/pink glassmorphism,
  Instrument Serif + Source Sans 3 + JetBrains Mono, `data-theme` light/dark). Added
  finance-specific components: `.stat`/`.stat-grid` tiles, `.line-item`/`.li-inputs`
  form rows, `.history-item`, `--pos`/`--neg` semantic colors, `.view` switching.
- **`finance/supabase.js`** — `window.FinanceDB`: client init from `window.FINANCE_CONFIG`,
  `getConfigError()` (missing config vs SDK-not-loaded), `baseCurrency()`, `invitePasskey()`.
- **`finance/snapshot.js`** — the financial model (`window.Model`), pure functions, no DB:
  `toBase(amount, rate)` (value = amount × rate; rate = units of base per 1 unit of the
  line's currency; same-currency ⇒ 1), `illiquidCostUpTo(moves, date)` (**cumulative**
  across all snapshots ≤ date, so illiquid only needs its *changes* entered each period),
  `computeSnapshot`, `computeTimeline` (orders by date, computes Δ + derived expense; first
  snapshot has null expense). Plus `fmt`/`fmtSigned` currency formatting.
- **`finance/app.js`** — orchestration: auth gate, data access (Supabase), and all views
  built with a tiny `el()` DOM helper. Views: **auth** (sign in / create account),
  **dashboard** (latest stats + recent list), **accounts** (add/delete accounts by type +
  income-defaults editor), **snapshot** (new/edit form), **history**. Snapshot save wipes &
  re-inserts child rows for correctness on edit. Auto-routing: if income defaults set an
  illiquid route, new snapshots auto-add that as an illiquid `in` move.
- **`finance/setup/schema.sql`** — Postgres tables (accounts, snapshots, balances,
  illiquid_moves, income, income_defaults, expense_lines, transactions) + **RLS**: every
  table `enable row level security` with an `owner_all` policy `user_id = auth.uid()`, so
  each user only ever sees their own rows. Indexes on snapshot foreign keys.
- **`finance/setup/SETUP.md`** — step-by-step Supabase setup (create project, run schema,
  copy URL + anon key, enable email auth, disable signups once circle is in).
- **`finance/config.sample.js`** — template; copy to `config.js` (gitignored) and fill in.
- **`.gitignore`** — added `finance/config.js`.

**Invite passkey (protects Grace's Claude API spend from random public signups):**
Decision = **browser-checked** single shared passkey (simplest). Added `INVITE_PASSKEY`
to config; the "Create account" tab reveals an invite field and rejects signup unless it
matches. **CAVEAT (documented on purpose):** a browser-checked passkey is visible in source
to a determined person — it's a casual gate, not real security. The TRUE protection for API
spend is the **server-side check in the statement Edge Function** (Phase 3), which will
refuse to run for anyone + can cap usage. Grace also disables public signups in Supabase
once her few users are in. Passkey can be changed anytime to stop future signups; existing
accounts keep working.

**VERIFIED:**
- JS syntax-checked all modules (`node --check`).
- Headless Chrome: no-config → "Setup needed" screen; with config → auth screen renders
  correctly (screenshot confirmed, matches site design; Supabase SDK loaded from CDN OK).
- **Model unit test with real HSBC numbers** (`node` eval of snapshot.js): net worth
  correctly combined HKD 36,066.75 + USD 9.28×7.8418 + stocks 22,200 + MPF 35,940.41 −
  Mox 4,424.55; illiquid carried forward cumulatively without re-entry; `expense =
  income − Δnw` correct (a month where net worth fell 491.30 on 19,950 income ⇒ expense
  20,441.30); first snapshot expense = null. All assertions passed.

**What Grace must do before it runs (cannot be automated):**
1. Create a free **Supabase** project, run `schema.sql`, copy URL + anon key into `config.js`.
   (See `setup/SETUP.md`.) Set an `INVITE_PASSKEY`.
2. (Later, Phase 3) Create a **Claude API** account for statement reading.

**Answered along the way:**
- *Does the API use my Claude subscription?* No — Claude API is separately billed
  pay-as-you-go; never touches the Pro/Max subscription.
- *Cost per statement scan (Haiku 4.5)?* ~$0.007 (HSBC 2pp) to ~$0.011 (Mox 4pp);
  realistic monthly total for a handful of statements ≈ $0.05–0.10.
- *Do my users need my VPN?* No — API calls originate from Supabase's servers (cloud →
  Claude cloud), not from Grace's machine/VPN. Users just open the URL normally.

---

## Roadmap (remaining phases — not yet built)

- **Phase 2 — Growth visualization.** Charts (net worth over time, expense per period,
  asset composition, income vs expense), theme-aware. Load the `dataviz` skill first.
  New file: `finance/charts.js`.
- **Phase 3 — AI statement reading (assets & liabilities).** Supabase Edge Function
  `parse-statement` holding the `CLAUDE_API_KEY` secret; upload asset/liability PDF →
  Haiku 4.5 returns a structured **draft** (balances, printed FX rates, liabilities,
  illiquid balances like MPF) → review/correct UI writes into a snapshot. This function is
  also the real server-side gate for API spend. New file: `finance/statements.js`.
- **Phase 4 — Spending categorization.** From spending statements (Mox-type), AI
  categorizes transactions (food/transport/shopping/fitness/other) as an **editable draft**,
  auto-flagging transfers/self-payments (e.g. paying own card bill, Octopus top-up) for
  exclusion. Feeds `expense_lines` breakdown only — never the derived expense total.

## Out of scope (later)
Receipt (non-statement) photo upload; budgets/goals; model swap to Sonnet if accuracy
needs it; server-side (strong) invite gate if the browser passkey proves insufficient.
