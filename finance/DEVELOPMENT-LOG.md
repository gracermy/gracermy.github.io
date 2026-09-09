# Bloom: development log

A running record of what we built at `/finance`, why, and how. Most-recent
first. Mirrors the style of `docs/development-log.md`.

Bloom is now **two independent trackers** behind one login:

- **Asset Tracker**: the original net-worth engine (snapshots, derived
  spending, charts, AI statement reading). Plan: `finance/PLAN.md`.
- **Expense Tracker**: bill splitting with shared wallets. Plan:
  `finance/SPLIT-PLAN.md`.

They share no math and never appear on the same screen. Read the relevant plan
first for the complete design context.

Setup docs: `setup/SETUP.md`, `setup/schema.sql` (asset tracker),
`setup/split-schema.sql` (wallets), `setup/push-schema.sql` +
`setup/NOTIFICATIONS.md` (notifications).

---

## Digest frequency, per person (BUILT, 2026-09-09)

**First, a real bug.** The weekly digest was scheduled `0 10 * * 1` — 10:00
**UTC**, which is 18:00 in Hong Kong. It had been arriving Monday evening, not
Monday morning. Now `0 2 * * 1` = 10:00 HKT. Hong Kong is UTC+8 year-round with
no DST (checked: January and July both map 10:00 HKT to 02:00 UTC), so the hour
never drifts.

**Per person, not per wallet.** The digest is deliberately ONE notification
covering all your wallets ("3 expenses across 2 wallets"). A per-wallet frequency
would force one push per wallet, which is precisely the spam a single digest
exists to prevent, and would need a rule for when a daily and a weekly wallet
collide. Muting one wallet, if ever wanted, is a boolean — not a second
frequency.

**`notification_prefs`**: one row per user, `digest` in `off | daily | weekly`,
owner-only RLS. **A missing row means weekly**, so both existing users kept
today's behaviour with no backfill — and the weekly query has to match NULL as
well as `'weekly'`, which is the one easy thing to get wrong here.

`'off'` stops **the digest only**. Expense-added, settlement and join pings still
arrive; the per-device switch remains the way to silence everything. The digest
is the part people tire of first, so it gets its own control.

**`weekly_summaries()` → `digest_summaries(window_days, want)`.** Same query,
parameterised window, plus a join on the preference so each run only serves the
people who chose that cadence. `weekly_summaries()` survives as a thin wrapper so
the function and the cron jobs could be updated in either order without a window
where the digest broke.

**The date boundary is not incidental.** `spent_on` is a bare DATE and
`current_date` evaluates in the DB's timezone (UTC). Between 00:00 and 08:00 HKT
the UTC date is still yesterday, so a *daily* window computed in UTC would cover
the wrong day. The window is anchored to the Hong Kong date explicitly rather
than relying on the two coinciding, which they do only by luck.

**Two cron jobs**, both 02:00 UTC (10:00 HKT): `bloom-weekly-summary` Mondays,
`bloom-daily-summary` every day. Mutually exclusive by preference.

**Verified against the real database** (rolled-back transactions, impersonating a
logged-in user):

- no prefs row -> weekly targets 2 people, daily targets 0
- set to daily -> leaves the weekly run (0), appears in the daily run
- set to off -> in neither run
- users in BOTH runs simultaneously: **0**
- `weekly_summaries()` wrapper matches `digest_summaries(7,'weekly')`
- a today-dated expense produces a correct daily payload (1 expense, HKD 120)
  while the weekly run separately covers the other user's 4
- RLS: own row visible, others' invisible, cross-user write refused, an invalid
  `digest` value rejected by the check constraint

Afterwards: 0 prefs rows, 6 expenses, 2 wallets, no test residue.

**A daily digest is silent on quiet days** (`having count(...) > 0`). With 0
expenses in the last 24h at the time of writing, daily correctly targeted nobody.
That is the design, not a failure — worth remembering before debugging a
"missing" daily notification.

---

## Wallet delete made atomic in Postgres (BUILT, 2026-09-09)

The client-side delete worked but was **not atomic**: five separate PostgREST
calls, so a connection dropped midway left a wallet whose expenses were gone but
which still appeared in the list. Now a single `delete_wallet(wid)` SECURITY
DEFINER function does all five deletes in one implicit transaction — all or
nothing. `Split.deleteWallet()` is one `rpc()` call.

**The owner check is load-bearing.** SECURITY DEFINER means RLS does not filter
what the function touches, so `is_wallet_owner()` at the top is the only thing
between a caller and someone else's wallet. It raises `42501` for a non-owner
rather than deleting nothing, so the client can tell refusal apart from an
already-deleted wallet. Execute is revoked from `public` and granted only to
`authenticated`.

**Verified against the real database** (each test inside a transaction that
rolls back, impersonating a logged-in user with `set_config('request.jwt.claims',…)`
since the SQL console has no `auth.uid()`):

- naive `delete from wallets` FAILS -> `violates foreign key constraint
  expense_shares_member_id_fkey` — the exact reason the ordering exists
- ordered delete succeeds, leaving 0 rows across all five tables
- also on a deeper wallet (3 members incl. one who had **left**, 4 expenses,
  12 shares, 2 settlements)
- `delete_wallet()` in one call: clean, nothing orphaned
- non-owner call **refused**, and the wallet it targeted still exists

Grace's real data was checked untouched afterwards (2 wallets, 3 members,
5 expenses, 9 shares).

**Applied to the live DB already.** Re-running `split-schema.sql` is safe and
idempotent (`create or replace`), but not required.

---

## Delete a wallet + the Edge Function that nearly got reverted (BUILT, 2026-09-09)

**Delete wallet.** Wallet settings offered only Archive, so a wallet made by
mistake stayed forever. There is now a red **Delete** beside Archive, owner-only
(the `wallets_delete` / `wm_delete` RLS policies already enforced that server-side;
the button just stops offering what would be refused).

Deleting is not archiving, so the confirmation is deliberately heavier than the
`confirm()` used elsewhere: it names what will be destroyed (`It holds 7 expenses
and 2 payments`), says so explicitly when others are in the wallet (*it disappears
for them too*), points at archiving as the reversible option, and requires the
wallet's **name to be typed**. A wallet holds other people's records, so a
reflexive OK is not consent.

**`deleteWallet()` deletes in dependency order, and has to.** A plain
`delete from wallets` fails: wallets cascades to `wallet_members`, but
`expense_shares.member_id` and `settlements.from/to_member_id` are
**ON DELETE RESTRICT**, so the cascade hits the restriction and the whole delete
is rejected. Order is shares (reached through their parent expenses, since
`expense_shares` has no `wallet_id`) → settlements → expenses → members → wallet.
Any failure throws rather than leaving a half-deleted wallet.

---

**The Edge Function copy that was a month stale.** `finance/setup/edge-functions/`
turned out to be a doc mirror, not the deploy source — the real one is
`/supabase/functions/` at the **repo root**, and the mirror was ~1 month behind.
Deploying from it would have silently reverted: base-currency conversion, the
`spending_total = total_out - self_transfer_out` formula, the transfers /
possible_transfers audit lists, and the cross-month `monthly_breakdown`. Caught by
diffing the two before deploying. The mirror is now synced and carries
`README-SOURCE.md` saying which copy is real.

**So the itemisation from 2026-09-08 was ported onto the live prompt properly**,
as a `lines` array *inside* each `monthly_breakdown` category rather than the flat
top-level `transactions` list the stale copy used. That keeps every existing
guarantee — lines arrive already split by calendar month and already converted to
the base currency — and `buildMonths()` prefers them, falling back to
`transactions`, then to aggregate-only categories. All three shapes were tested,
including the aggregate-only one that was live at the time, so the site kept
working before the deploy as well as after.

Deployed with `supabase functions deploy parse-statement --project-ref <ref>`
(the explicit ref is needed: there is no `supabase/config.toml`, so the CLI
can't find the link on its own).

---

## Statement review: itemised lines grouped by category (BUILT, 2026-09-08)

The AI statement review used to collapse a statement into one editable row per
category (`food 506`, `shopping 208`). The number was right but the *sources*
were invisible: you had to trust the total, and correcting it meant editing an
aggregate you couldn't audit. The draft is a rough estimate by design, so the
value of showing it at all is being able to see where it came from.

**Now the review lists every line on the statement, grouped under its
category.** Each line reads `date and time || reference name || amount`, with a
category dropdown and a delete button:

```
Food                                  506
  2026-08-05 12:41  Keeta             108   [food ▾] ✕
  2026-08-05 20:15  CITYSUPER TSTOWER 265   [food ▾] ✕
  2026-08-19 21:48  Deliveroo HK      133   [food ▾] ✕
Shopping                              208
  2026-08-06 14:02  UNIQLO            208   [shopping ▾] ✕
```

**The category total is derived, never stored.** `categorise()` regroups the
surviving lines on every render, so deleting a line or moving it to another
category updates both category totals and the month total immediately. The old
UI stored a category amount alongside its name, which meant the displayed total
could silently disagree with the lines it claimed to summarise. There is no
longer an editable per-category amount, because there is nothing for it to mean.

**On Apply, each line becomes its own `expense_lines` row**, labelled with the
reference name as printed rather than with the category name repeated. So the
saved breakdown says `food / Deliveroo HK / 133`, not `food / food / 506`. A
line whose category isn't one of `EXPENSE_CATS` falls back to `other`, since the
snapshot form's dropdown can only hold real categories.

**Edge Function changes** (`setup/edge-functions/parse-statement/index.ts`,
needs a redeploy to take effect): the prompt now asks for a `time` field, tells
the model to emit **every** printed line rather than merging purchases that
share a merchant or date, and to keep `description` as the reference name as
printed instead of a generic label. `max_tokens` went 4096 → 16000, because a
fully itemised statement is much longer than a category summary.

**Kept as-is:** transfers are still excluded and still listed separately above
(they're what makes the exclusion auditable); the cross-month split still shows
each calendar month separately and applies only the month being added; a printed
`spending_total` still wins, scaling the lines proportionally so the itemisation
adds up to the statement's own figure. Older drafts with no line detail
(`category_breakdown` / `monthly_breakdown`) still render, as one line per
category.

**Checked in a real browser** (headless Chrome against `preview.html`, whose
mock draft now has times, several lines per category and a line in the next
month): grouping, deleting, re-categorising, the cross-month notice, Apply
producing one labelled expense row per line, plus dark mode and a 430px phone
where the line wraps to two rows instead of three.

**Note:** `transactions` is a real table in `schema.sql` but nothing writes to
it. The line detail lives only in the browser during review and is discarded
after Apply, so the saved `expense_lines` labels are the only record of it.

---

## Settings as modals, centred (BUILT, 2026-09-02)

Trial of a more app-like UI, built on a branch so it could be dropped. Grace
kept it.

**Wallet settings in a modal.** The gear icon on a wallet opens name, icon,
currency and archive in a modal instead of navigating to a page, so you change
one thing and stay where you were. **People opens as a second modal stacked on
top**, so adding, removing or re-inviting someone repaints the list in place
and closing it returns to settings with the member count refreshed. The
`walletSettings` route still exists as the people page (reachable, and used for
non-owners).

**First non-route UI in Bloom**, so `openModal()` had to cover what routing gave
for free: Escape and backdrop dismiss, focus trap for Tab, focus restored on
close, page behind locked without losing scroll position, and a pushed history
entry so Android's back gesture closes the modal rather than leaving the wallet.

**Three stacking bugs, all found by exercising it in a real browser** (they all
looked fine in the source):
1. The page lock was released by whichever modal closed first, so closing People
   unlocked the page while settings was still open. Fixed with a `modalStack`:
   the first modal owns the lock and the last to close restores scroll.
2. `onPop` set `closed = true` before calling `close()`, which made `close()`
   return early and never clean up, so Escape silently stopped working on the
   outer modal.
3. Closing the inner modal calls `history.back()`, and that `popstate` cascaded
   into closing the outer one, so one Escape dismissed both. Self-triggered pops
   are now counted (`selfPops`) and swallowed, and only the topmost modal
   handles a popstate at all.

**Bottom sheet reverted to a centred card.** The phone breakpoint originally
anchored the modal to the bottom edge; with the icon grid wrapping to two rows
it grew taller than the screen and the Save button fell off. Now a floating
centred card at every width, with tighter padding on phones.

**Still open:** Remove uses a native `confirm()`, which now appears over two
modals. Works, but it's the least app-like part of the flow.

---

## Expense Tracker UI fixes (BUILT, 2026-09-01)

Round of fixes after Grace used it for real.

**The missing pie chart, two separate causes.** First fix addressed empty
"Your share" data (viewer not a linked member, or no share row in any expense):
it now falls back to the whole-wallet view, and the Your share / Whole wallet
toggle only appears when both views have data. But the real cause was different
and only found by **measuring the rendered DOM**: with a single category the
slice spans the full circle, so its arc starts and ends at the same point, and
**SVG treats a zero-length arc as a no-op that paints nothing**. The legend and
centre total rendered normally, so it read as "no chart" rather than an error.
The path's bounding box was 0×27 inside a healthy 150×150 svg. A full-circle
slice is now drawn as two concentric circles with an even-odd fill rule.

**Editable payments.** Tapping a recorded settlement opens an editor with Save
and Delete, from both the activity feed and the past-payments list. Balances
recalculate on their own since they are always derived. Members who have since
left still render in the From/To pickers, or their old payments could not be
edited at all.

**Notifications toggle** replaced the explanatory card with one compact bar at
the top of the Expense Tracker: label left, switch right. Only states the app
cannot act on (iOS not installed, permission blocked) still carry text.

**Wallet icon editable in settings.** The new-wallet form had an emoji picker
but settings did not. Extracted into a shared `emojiPicker()` so the two cannot
drift; an emoji not in the offered list is prepended rather than silently
replaced on save.

**Spacing and overflow.** Several flex text columns had `flex: 1` without
`min-width: 0`; a flex item defaults to `min-width: auto`, so a long name or
email refused to shrink and pushed its row past the card edge. Also: `.shell`
had a top-only margin so cards sat flush against following button rows, the
back button collided with page titles, and the settings control became a gear
icon matched to the title card's height via `align-items: stretch`.

---

## Push notifications (BUILT, 2026-08-31)

Four notification types, all free-tier:

| Trigger | Notification |
|---|---|
| Expense added | "Alex added Groceries HK$420" |
| Settlement recorded | "Becca paid Grace HK$200" |
| Someone joins a wallet | "Becca joined the wallet" |
| Weekly (Mon 6pm HK) | "12 expenses across 2 wallets. HK$3,400 spent, your share HK$1,700." |

**Architecture:** `push_subscriptions` (one row per **device**, not per person:
the same user on a phone and laptop has two, expiring independently),
`wallet_push_targets()` returning everyone in a wallet except the actor, and a
`send-push` Edge Function invoked by Database Webhooks. Sending is server-side
with the service_role key because it must read other people's subscriptions; a
browser must never be able to. The function also requires a shared secret
header, so knowing its URL is not enough to invoke it.

**Insert only, deliberately** for expenses and settlements. Notifying on every
edit would ping everyone for each typo correction. A join is the exception: it
is an UPDATE (the member row already exists and joining fills in `user_id`), so
the function checks for exactly that `null → user_id` transition. Adding a
name-only member, renaming one, or adding an email all stay silent.

**Weekly digest** runs on `pg_cron` rather than a table event. A quiet week
sends nothing rather than a "you spent nothing" ping.

**Config bug found while wiring this up:** `saveConfig()` only writes the fields
the setup screen asks about, so on any device that had used that screen the
spread in `config()` overrode `VAPID_PUBLIC_KEY` with `undefined` and
notifications would have silently never appeared. The merge now skips only
`undefined`, so a saved `false` still wins.

**Setup gotchas** (both "feature not enabled yet", not real errors): creating a
webhook failed with `schema "supabase_functions" does not exist` until webhooks
were enabled; `cron.schedule` failed until
`create extension if not exists pg_cron with schema extensions;`.

---

## Installable app / PWA (BUILT, 2026-08-31)

Manifest, service worker and a blossom icon set, so Bloom can be added to the
Home Screen and launch full-screen. **This is also the prerequisite for
notifications: Apple only allows web push for PWAs installed to the Home
Screen**, which is why install came first.

The service worker is deliberately conservative, since the way one can really
hurt is by serving stale or wrong responses: only same-origin GETs for our own
static files are cached, **Supabase REST and auth and the CDN are never
intercepted** (so no session data can end up in a cache), HTML is network-first
so a deploy is picked up on the next load, and bumping `CACHE_VERSION` drops
every older cache. Registration failures are swallowed: a PWA that will not install is a lost
convenience, but a crash on load would be a broken app.

iOS gives no automatic install prompt, so the home screen shows a dismissible
card explaining Share → Add to Home Screen. Android and desktop capture
`beforeinstallprompt` and install in one tap.

**Why PWA over native:** shipping to iOS through the App Store needs a paid
Apple Developer account at $99/year regardless of how the app is built. A PWA
is the only genuinely free way to get an app icon on an iPhone, and it keeps
the existing database, auth and every line of app code unchanged.

---

## Expense Tracker: bill splitting (BUILT, 2026-08-28)

Bloom becomes two trackers behind one login, forked from a new `home` route.
Full design in `finance/SPLIT-PLAN.md`.

**Deliberate separation.** Shared expenses are their own ledger and never touch
`snapshots` / `balances` / derived expense. Net worth already reflects shared
spending (paying for dinner lowers your bank balance), so linking them would
double-count. Vocabulary is kept distinct on purpose: the Asset Tracker says
"spending", the Expense Tracker says "spent" / "your share", so the same word
never means two things.

**Model.** A **wallet** is one shared book per group (flatmate, friends, a
trip), fully independent: a debt in one never nets against another, because in
real life you pay them separately. A **member** is a named seat with a
*nullable* `user_id`: name-only, invited-by-email (auto-linked on signup via
`claim_wallet_invites()`), or linked later. **Expenses reference `member_id`,
never `user_id`**, so linking an account or leaving never rewrites history.
Equal split by default with a per-person override; `expense_shares` is a real
table so history freezes (adding a 4th housemate in March must not rewrite
February's 3-way splits) and rounding is cent-exact ($10/3 → 3.34 + 3.33 +
3.33). Balances simplify to the fewest transfers. Settlements offset balances
rather than deleting anything, so the category pie is unaffected by settling up.

**Key architectural difference:** these tables use **membership-based RLS**
(`is_wallet_member()`, a `security definer` function to avoid the policy on
`wallet_members` recursing into itself), not the owner-only
`user_id = auth.uid()` of `schema.sql`, because several people must read and
write the same rows.

**Bugs found while building:**
- The `wallets` select policy must also match `created_by`. Creating a wallet
  does `insert … select()`, and at that instant the creator has no member row,
  so a membership-only test returned zero rows and creation appeared to fail.
- `count(*)` returns `bigint`, assigned into an `integer` in
  `claim_wallet_invites()`. Replaced with `GET DIAGNOSTICS`.
- The home card summed positions across wallets and formatted them in the base
  currency, so an HKD and a USD wallet were added as raw numbers. It now only
  totals when the outstanding wallets share a currency.

**Verified:** 38 unit tests over the math: cent-exact allocation, balances
summing to zero, someone excluded from an expense, partial settlements,
multi-currency in both balances and category totals, and the exact-split edges.

**Still unverified:** the membership RLS was never tested against two real
accounts (specifically that a non-member gets zero rows from a direct query),
and end-to-end push delivery was never observed from the dev side.

---

## At-cost vs. market value + editable AI drafts (BUILT, 2026-08-11)

Grace's insight while using the AI reader on a real HSBC statement: banks show
illiquid holdings at **current market value** (fluctuates), but her method needs
**at-cost** (contributions) so derived expense stays correct — and MPF/stocks are
sometimes inside the bank (real value shown) and sometimes outside (contributions
only). Also, the AI draft had no way to delete/edit lines.

**Editable AI draft (statements.js):** every draft line (balances, liabilities,
illiquid market values) now has a ✕ delete; spending categories are an editable,
deletable list (rename category + edit amount) stored on `draft._categories`.
`applyDraft` uses the edited list, and routes illiquid market values into the
new market-value fields (not at-cost).

**Dual illiquid value model — the core change:**
- New `market_values` table (per illiquid account per snapshot; RLS + index).
  **Informational only — never feeds expense.**
- `snapshot.js` now computes BOTH: `netWorth` (liquid + illiquid-**at-cost** −
  liabilities) which drives Δ-net-worth → **derived expense**, and
  `marketNetWorth` (liquid + illiquid-**market** − liabilities) for the "true"
  figure. Accounts without a recorded market value fall back to at-cost so the
  market total is complete. Added `illiquidCostByAcctUpTo` for the per-account
  fallback. **Verified:** a stock rising 20000→23000 shows marketNetWorth up but
  leaves derived expense unchanged (uses the cost delta) — market swings no
  longer distort expense.
- Snapshot form: new "Current market value (optional)" section, one row per
  illiquid account (blank = keep at-cost). "Illiquid moves" relabeled "(at cost)"
  with clarified copy.
- Dashboard: when any market value exists, shows "Net worth (at cost)" (labeled
  "basis for expense") + a "Net worth (market)" tile + "Illiquid (market)".
- Edge Function prompt: illiquid_balances clarified as CURRENT MARKET VALUE.

**Requires re-running finance/setup/schema.sql** (adds `market_values`; additive,
safe — `create table if not exists`).

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
