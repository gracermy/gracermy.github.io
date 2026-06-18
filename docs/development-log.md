# Development log

A running record of major changes to gracermy.github.io — what we built, why, and how. Most-recent first.

---

## Phase 10 — Crossum build started; Kakuro generation R&D
**Date:** 2026-06-12 → 2026-06-13 — *UI + easy generator done; medium/hard generation blocked*

**Built:**
- **`games/kakuro/index.html`** — full Crossum shell, replacing the coming-soon stub. Lifted from `suguru/index.html`: daily-reward overlay, 5-slide tutorial (rewritten for Kakuro sums/no-repeat rules), loading overlay, home, game screen, all modals (leave/giveup/restart/settings/hint). Picker is digits **1–9** + Pencil + Erase. Loads shared `/games/profile.js`.
- **`games/kakuro/style.css`** — suguru CSS recolored to the amber/orange identity (`--amber #fbbf24`, `--orange #f97316`, warm-dark bg). New Kakuro-specific cell styles: `.cell.wall` (black), `.cell.wall.has-clue::after` (diagonal slash), `.clue-sum.down`/`.clue-sum.right` (corner sum numbers), `.cell.white`, run-highlight, candidates 3×3 grid.
- **`scripts/generate-kakuro.js`** — generator with: constructive layout carver (carve interior walls from a solid start, keep if no isolated cell; `splitLongRuns` enforces maxRun), a backtracking fill (`solveOne`), a brute uniqueness counter (`solveCount`, node-budgeted), and a **correct logical-propagation solver** (`logicSolvable`) using 9-bit candidate masks + a precomputed `COMBOS[len][sum]` table + per-run combination filtering + naked-singles. JSON entry: `{ rows, cols, cells:[{t:'wall',down,right}|{t:'cell'}], solution, id }`.

**KEY FINDING — generate-then-verify does NOT scale for Kakuro (documented so we don't repeat it):**
The Suguru/Nonogram pattern (random-fill → keep if uniquely solvable) **fails for Kakuro above 5×5**. Measured logic-solvable (⇒ unique) rate by grid size: **5×5 ≈ 0.5%** (works only because retries are cheap), **6×6 = 0%, 7×7 = 0%, 8×8/9×9 = 0%** — a hard cliff right after 5×5. Verified across density 20–70% walls, run lengths 2–5, interlock on/off, and pattern lattices; confirmed by BOTH the logic solver and brute-force `solveCount` ground truth (so it is not a solver weakness — the logic solver correctly accepts all known-unique easy puzzles). Even a 7×7 with only ~11 white cells yields 0 unique. **Reason:** a randomly-filled Kakuro almost never has clue-sums that force a single solution; uniqueness probability decays exponentially with size.

**Conclusion / next step:** Medium & hard need the **inverse algorithm — solve-while-building**: co-construct puzzle + solution incrementally, running the logic solver in the loop and only keeping forced placements. That is a separate, substantial generator build (the genuine "hard part"). Easy (5×5) generates fine with the current code. Options on the table: (a) build the constructive generator, or (b) ship `kakuro.js` on the working easy bank so Crossum is playable now, medium/hard as follow-up. `kakuro.js` (the game logic) is **not yet built**.

**ROOT CAUSE found (deeper R&D session, 2026-06-13) — "SWAPS":**
Traced the medium/hard non-uniqueness to a single mechanism. A Kakuro has multiple solutions almost entirely because of **swaps**: two (or more) white cells whose values can be exchanged while *every* crossing run stays satisfied. Caught a concrete 2-cell example — cells (6,2),(6,3) = `8,9` in one solution and `9,8` in the other; they share a horizontal run (sum 17 either way) and both vertical runs tolerate the exchange, so the clues cannot distinguish them. Findings, all measured:
- Swaps are pervasive at 7×7: **0 of 2000** dense random fills were swap-free.
- Walling a differing cell does NOT fix a swap (both cells remain; the swap persists or moves). Watched a puzzle sit at exactly 2 solutions across 30 wall-flips.
- Higher density does NOT help — short 2-cell runs are the *most* swappable.
- **Decisive:** trying 30 DISTINCT solutions on a fixed 7×7 layout → still 0 unique. So **uniqueness is a property of the LAYOUT, not the fill** — swap-prone layouts admit *no* unique filling; the rare 5×5 successes come from structurally swap-resistant layouts. (`buildLayout` produces too-regular, swap-prone structures.)

**Therefore the next design direction is: construct/select SWAP-RESISTANT layouts** (varied run lengths, irregular crossing structure so no two cells can mutually exchange), then fill + verify. Repairing fills is a dead end; the lever is the layout. Prototypes for this R&D live in `/tmp/proto-*.js` (not committed). The committed generator still produces correct EASY puzzles.

**SOLVED (2026-06-17) — reveal GIVENS to force uniqueness.**
Web research found a working open-source generator ([ChrisMoutsos/kakuro](https://github.com/ChrisMoutsos/kakuro)) whose `generateBoard()` has the missing step: **you can't get uniqueness from clue-sums alone above ~5×5 — real Kakuro pre-fills a few cells as GIVENS.** Algorithm ("Phase 3"): after building a valid filled board, run the logic solver; while it can't finish, take the unsolved cell with the FEWEST candidates and FIX it to its true value as a given; re-propagate; repeat until logic solves it completely ⇒ guaranteed unique. The givens pin one cell of each swap, killing it.

Implemented in `generate-kakuro.js`: refactored the logic solver into `propagate()` (returns `{ok, solved, cand}`, accepts a `givens` map) wrapped by `logicSolvable()`; `generateOne()` runs the Phase-3 loop and caps givens at ~18% of interior cells. **Result: full banks generated in <2s — easy 150, medium 150, hard 100, ALL independently verified to have exactly one solution.** Given-counts: easy 0–3 (avg 2.6), medium 3–6 (avg 5.4), hard 8–12 (avg 11.4). JSON cell model gained `given: digit` on pre-filled white cells; bank entries carry `givens` (count). **kakuro.js must render given cells as fixed/locked (non-editable, distinct style).** Generation is no longer a blocker; remaining work is the game UI (`kakuro.js`) + wiring the Crossum tile into `games/index.html`.

---

## Phase 9 — Crossum (Kakuro) build plan
**Date:** 2026-06-12 — *planned, superseded by Phase 10*

**What:** Approved plan to build **Crossum** (Kakuro), the last unbuilt game from the Phase-1 scaffold. Kakuro = a crossword filled with digits 1–9: black clue cells hold a down-sum and/or right-sum, and each white run must add to that sum using each digit at most once. The amber/orange "coming soon" stub already exists at `games/kakuro/index.html` (URL slug `kakuro`, display name **Crossum**, theme bg `#1a140d`, gradient `#fbbf24→#f97316`).

**Grid sizes (decided):** Easy **5×5**, Medium **7×7**, Hard **9×9** (compact, mobile-friendly, in line with Nettle).

**Reuse strategy — the core of "match my style":** Crossum is the number-logic cousin of **Nettle (Suguru)**, so ~70% of `suguru.js` is lifted near-verbatim: puzzle-bank loader + played-set tracking, coin UI, save/resume (`kakuro_resume`), daily overlay, home/screen helpers, timer, undo, win modal, hint shop, tutorial, keyboard input, number picker, pencil mode. Shared `profile.js`, the `../sudoku/icons/coin.svg`, fonts, and overlays used unchanged. Coin rewards `{ easy:4, medium:8, hard:14 }` to match the arcade.

**Kakuro-specific (~30%, the real work):**
1. **Data model** — a cell is a *wall* (black, optional `{down, right}` sums) or a *fillable* white cell. (Different from Suguru's cage model.)
2. **Grid render** — black clue cells with the diagonal split + sum numbers; white cells as inputs. Most visually distinct piece.
3. **Validation** — per run: digits unique **and** sum to the clue.
4. **Hint logic** — reveal a correct digit / flag a broken run (adapt Suguru's hint shop).
5. **Generator** — `scripts/generate-kakuro.js`, modeled on `generate-suguru.js` (borrow its solver + uniqueness-check scaffolding). **The hard part** — Kakuro generation with guaranteed-unique solutions is the trickiest piece. Emits `games/kakuro/puzzles/{easy,medium,hard}.json` (150/150/100). Bump a `kakuro_bank_version`. Add a step to `.github/workflows/generate-puzzles.yml`.

**Build order (phased, each independently testable):** 1) Shell (copy+recolor suguru index/css, wire profile/home/daily/screens) → 2) Render + input (hand-author 2–3 JSON puzzles) → 3) Rules + win (validation, win, reward, undo, timer) → 4) Hints + 5-slide tutorial → 5) Generator + banks → 6) Add Crossum tile to `games/index.html` (replace coming-soon) + mobile touch test.

**Proposed JSON format (final shape locked when building the generator):** `{ "puzzles": [ { "rows", "cols", "cells": [{wall, down, right} | {wall:false}], "solution": [[0|digit]], "id" } ] }`.

---

## Phase 8 — Pixle picture authoring + interaction polish; repo privacy
**Date:** 2026-06-05 → 2026-06-12

**Pixle interaction polish (commits):** fill/mark toggle + auto-mark refinements; **3-tap cell cycle** (color → ✕ → blank) with working **touch drag-paint**; true colored nonograms with **per-number clue strikethrough**, then **position-aware** strikethrough — each clue number binds by which end of the run it sits, so strikes track the correct number as a line fills from either side.

**Picture authoring + curation pipeline (`scripts/`, kept PRIVATE — see below):** `author-pictures.js` (~936 lines) authors recognizable-shape picture puzzles (the Phase-6 "deferred designed-picture phase"). `review-banked-pictures.js` / `apply-bank-review.js` / `merge-pictures.js` drive a keep/discard curation workflow; `kept-pictures.json` / `discarded-pictures.json` record the decisions. This produced **243 curated named puzzles** (easy +117, medium +78, hard +48) on top of the original random banks.

**Reserved bank for the daily feature:** The 243 curated puzzles were split out of the live banks into `games/nonogram/puzzles/special/{easy,medium,hard}.json` — a tree the game does **not** fetch — so they stay hidden from random play until the (still-deferred) daily-puzzle feature serves them deliberately. Discriminator: curated puzzles carry a `name`; the original published puzzles do not. Live `easy/medium/hard.json` left byte-identical to before, so players saw zero change.

**Repo privacy decision:** Repo stays **public** (free GitHub Pages only serves public repos; a web game ships its source to the browser anyway, so a private repo hides little). The genuinely-spoilable content — the reserved `special/` answers and the authoring tooling — was **scrubbed from public git history** (force-push) and `.gitignore`d, kept locally only, destined for a separate **private dev repo** (free; unlimited private repos — only *Pages-from-private* costs money). Backup at `~/pixle-private-backup/`. Also added `.gitignore` (`.DS_Store` + the private paths).

**"Make it an app" path (for reference, deferred):** Rung 1 = shareable link (have it). **Rung 2 = PWA** (manifest + service worker → "Add to Home Screen", offline, free, reuses current code) — the recommended next "it's an app!" step. Rung 3 = app stores (Google Play ~$25 once, Apple $99/yr; gain = discoverability/search + store trust + built-in payments, not capability). Rung 4 = native rewrite — irrelevant, skip. User chose to furnish game features first before PWA.

---

## Phase 7 — Pixle goes colored
**Date:** 2026-06-02

**What:** Reworked Pixle from monochrome-with-decorative-color into a **true colored nonogram**. The Phase-6 "random decorative color" looked broken (meaningless red/purple noise) because color carried no logic. Now color is part of the puzzle.

**Clue model:** a clue is an ordered list of `[length, colorIdx]`. Colour rules: two **same-colour** runs need ≥1 blank gap; two **different-colour** runs may touch with no gap. Clue numbers render tinted in their run's colour.

**Generator + solver rework (`generate-nonogram.js`):** the random picture assigns each filled cell a colour; clues are derived as coloured runs. The line-solver is now colour-aware (enumerates placements honouring the same/different-colour gap rules) and still verifies a unique solution. Bank stores `palette`, a coloured `solution` string (`0` blank, `1..K` colour value), and coloured `rowClues`/`colClues`.

**Colour count by difficulty — and why it's capped:** probing showed random *coloured* puzzles are rarely uniquely solvable as colours rise (3-colour 15×15 ≈ 0%). So the random bank caps low and runs at higher density (~0.65) to lift the unique-solution rate: **easy = 1 colour always; medium & hard = a 50/50 mix of 1- and 2-colour puzzles** (the generator deliberately alternates the requested colour count so the bank isn't all-mono). Richer 3+ colour puzzles are deferred to the designed-picture phase, where uniqueness is hand-controlled rather than left to chance. Bank regenerated (400 puzzles, ~290 KB); bank version 1→3.

**Game changes:** cell value model is now `EMPTY | 1..K (color) | MARK`. Toolbar is built dynamically from the puzzle's palette — one **Fill** button per colour (plus **Mark ✕**); a mono puzzle just shows "Fill". Tap cycles colour → ✕ → blank; drag paints the active tool; number keys 1..K pick a colour, M picks mark. Auto-mark, win-check, and clue-satisfaction all compare colour sequences, not just lengths.

**Verified:** all 400 puzzles pass independent checks — derived clues match the solution, the colour-aware solver recovers the unique solution, and the game's own win-check + clue-match logic accept the solved grid.

**Follow-up tweaks (same day):**
- Generator now rejects any puzzle with a fully-blank row/column, so there are no empty (numberless) clue strips.
- Toolbar buttons are icon-only — a large colour swatch or a large ✕, no text labels — and the under-grid hint sentence was removed.
- **Per-number clue strikethrough:** each clue number strikes through as its run is formed (matched by length from each end of the line), regardless of correctness — not only when the whole line matches. When every number in a line is struck, the existing auto-mark fills the rest with ✕.
- The settings toggle (formerly the no-op "auto-dim clues") now controls **Auto-mark blanks** — turning it off strips auto-✕ and stops auto-marking; toggling mid-game applies immediately as one undoable step. Per-number strikes always show regardless.

---

## Phase 6 — Pixle (Nonogram) build
**Date:** 2026-06-01

**What:** First playable Pixle game at `/games/nonogram/` (display name "Pixle", URL slug `nonogram`). Picross/nonogram: fill cells to match row/column run-length clues and reveal a hidden picture.

**Difficulties:** Easy 5×5, Medium 10×10, Hard 15×15. Coin rewards 4/8/14 (matching Nettle's scale).

**Generation (puzzle-bank pattern, like Nettle):**
- `scripts/generate-nonogram.js` runs offline. Generates a random filled grid at a target density, derives row/col clues, then **verifies uniqueness with a line-solver** (constraint propagation): if the clues don't fully determine the grid via line-solving alone, the puzzle is ambiguous and discarded. Only uniquely-solvable puzzles are kept.
- Bundles to `games/nonogram/puzzles/{easy,medium,hard}.json` as `{"puzzles":[...]}`. Solution rows stored as bit-strings (`"10110"`) to keep JSON small (~152 KB for 150/150/100 = 400 puzzles). Generation takes <1s for the full bank.
- Bank version key `nonogram_bank_version` + played-index migration, same as Nettle.
- Added a Nonogram step to `.github/workflows/generate-puzzles.yml` (the workflow now generates both Suguru and Nonogram monthly; renamed from "Generate Suguru puzzles" to "Generate puzzles").

**Gameplay:**
- **Fill / Mark toggle** under the grid (the M key toggles too). Fill mode taps fill; Mark mode taps place ✕. Tapping a cell that's already in the active state clears it.
- **Drag to paint** — press and drag paints one target value across a line; the first cell's resulting value sets the stroke mode. Delegated `pointerdown`/`pointerover` on the board with `touch-action: none` so dragging doesn't scroll. One drag = one undo entry (batched changes, including any auto-marks it triggers).
- **Auto-mark**: when a row/column's filled cells match its clue (ANY arrangement, not just the true solution), the remaining empties auto-fill with ✕. If the line later stops matching, the auto-✕ are removed (manual ✕ are never touched). Tracked via an `autoMarked` grid; auto-changes fold into the triggering move's undo entry.
- **Strikethrough clues**: a satisfied row/col clue's numbers get a green line-through (kept legible, not dimmed). Gated on the shared `autoDisable` setting.
- **Lenient validation** (chosen up front): no mistake feedback mid-play. Win fires the instant the FILLED set matches the solution — ✕ marks ignored.

**Colour:** Each puzzle carries a small flat-colour palette (Easy 1, Medium 2, Hard 3 colours, chosen at random from an 8-colour pool) and a per-cell colour index, both stored in the JSON (`palette`, `colors` — `.` = blank, one digit per filled cell). Filled cells render as a flat colour from the palette, mirroring how real picture nonograms use only a few colours (subject + background). Clues are still pure filled/blank logic — colour is decorative and doesn't affect solvability. Bank version bumped 1 → 2 for the colour data.

**Shared systems reused verbatim:** profile.js (coins, streak, daily calendar overlay with "Day N" labels, best times), settings modal (autoDisable + showTimer), hint shop (Random 2c / Chosen 5c — here a hint *resolves* a cell to its true filled/blank state), pause, undo, restart, give-up, tutorial, win modal (gates `submitBestTime` on showTimer).

**Aesthetic:** Pixle's existing purple→blue identity (not Nettle's pink/blue). Filled cells use a purple→blue gradient; 5-cell block separators on the grid for readability.

**Deferred:** Puzzles are currently random pictures. Recognizable-shape generation (curated/hand-authored grids) is a later pass now that UI + logic are proven.

---

## Phase 5 — Cross-game alignment: settings, hint shop, daily calendar, unified rewards
**Date:** 2026-05-29

Sync work to make Sudoku and Nettle (and future similar games) behave consistently.

**Per-game settings (modal popup):**
- New ⚙ settings button on the home screen of each game
- Two toggles, both ON by default:
  - **Auto-disable answers** — when ON, picker dims digits that can't go in the selected cell (Sudoku: row/col/box constraints; Nettle: cage + 8-dir neighbours). When OFF, picker is fully unrestricted. Pencil mode always free regardless of setting.
  - **Show timer** — when OFF, timer is hidden AND time isn't recorded (best-time tracking skipped for that session). Win modal shows "Solved!" instead of "Solved in MM:SS."
- Storage: `<game>_settings` localStorage, accessed via shared `loadSettings/saveSettings/getSetting/setSetting` in profile.js.

**Sudoku changes for alignment:**
- Constrained picker added (`updatePickerForCell` checks row/col/3×3 box, respects autoDisable setting + pencil mode)
- Pencil candidates auto-clean on real-number placement — placing a real number strips that value from candidates in the same row, column, and 3×3 box (parity with Nettle's behaviour). Undo restores them.

**Nettle changes for alignment:**
- Picker dimming now respects the autoDisable setting and pencil mode (was always dimming previously). In pencil mode and autoDisable=OFF mode, all valid-size digits remain enabled — free input.
- Hint shop added (parity with Sudoku): 💡 button in top bar, modal offers Random (2 coins) and Chosen (5 coins) hints.

**Unified daily reward curve (replaces old `50 + min(streak-1,5)*10`):**
| Day | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8+ |
|---|---|---|---|---|---|---|---|---|
| Reward | 50 | 60 | 70 | 80 | 90 | 100 | **200** | cycle back to 50 |

Streak counter keeps growing even after the cycle wraps; the badge always shows the current `streak` value. Skipping a day resets streak to 1 but doesn't punish the user — they restart at 50.

**Weekly calendar UI in daily reward overlay:**
- 7 day chips, current day highlighted in gold gradient with subtle glow
- Day 7 chip uses pink/violet gradient + small ★ corner marker (visible weekly milestone)
- Reward amount displayed under each chip
- Claimed days have a subtle gold tint to show progression

**Profile reset (PROFILE_VERSION 1 → 2):**
Every existing user gets a fresh start on next load — coins, streak, totalSolved, bestTimes, and lastVisitDate all reset. Acceptable because only Grace and a small testing group have any state.

**New shared helpers in profile.js:**
- `rewardForDay(streakDay)` — returns the coin reward for a given streak day
- `dailyRewardSchedule(currentStreak)` — returns an array of 7 day descriptors for calendar rendering
- `loadSettings`, `saveSettings`, `getSetting`, `setSetting` — per-game settings

**How to apply this pattern to future games:** Include the settings modal markup verbatim from Sudoku/Nettle (toggles, descriptions, gear icon SVG). Call `applySettings()` on init and in `setPencilMode`. Add `updatePickerForCell()` that checks the game's specific constraints under `if (!pencilMode && getSetting(game, 'autoDisable'))`. For win, gate `submitBestTime()` on `showTimer` and increment `totalSolved` manually when timer is off.

---

## Phase 4 — Wordle (endless mode)
**Date:** 2026-05-28 → 2026-05-29

**What:** First playable Wordle game at `/games/wordle/`. Endless mode only — daily mode deferred to a future cross-game system.

**Mechanics:**
- 6 guesses × 5 letters, standard rules
- Traditional green/yellow/grey tile colours (kept exactly Wordle-conventional for muscle-memory; surroundings match site dark aesthetic)
- On-screen QWERTY keyboard + hardware keyboard support
- Tile flip animation on guess submission
- Share button on win — copies emoji grid (`🟩🟨⬛`) to clipboard
- Give-up flow reveals the target word

**Word lists:**
- `games/wordle/words/answers.json` — 2,315 curated answer words (official Wordle answer list)
- `games/wordle/words/guesses.json` — 15,929 accepted guesses (answer set + dwyl English 5-letter words, deduped)
- Storage format: concatenated 5-char strings instead of JSON array (~75% smaller payload). Total ~91 KB.

**Coin rewards:** scaled by guess count — 30/20/12/7/4/2 for 1..6 guesses. Best score tracked as lowest guess count via existing `submitBestTime()`.

**Why this approach:**
- Endless first because Grace wants daily mode to be a cross-game synchronised system, not per-game silos
- Traditional colours over site-themed because the green/yellow have strong genre association
- Concatenated word string saves bytes vs JSON array of strings, no perceptible decode cost

---

## Phase 3 — Nettle uniqueness + pencil auto-clean
**Date:** 2026-05-28 → 2026-05-29

**Bug 1 — multiple solutions:** Original `removeClues()` stripped clues without verifying uniqueness, producing puzzles where the user could legitimately fill in a different-but-valid solution. Fix: added `countSolutions()` to the generator (early-exits at 2 solutions found), modified `removeClues()` to verify uniqueness after each removal and revert if broken. Regenerated all 400 puzzles (~35 seconds for the full bank).

**Bug 2 — pencil candidates not auto-cleaning:** When user places a real number, that number must be removed from pencil candidates of any cell where it could no longer be valid. Initial fix only covered same-cage peers; user pointed out the no-touch rule extends to all 8-directional neighbours regardless of cage. Final fix: auto-clean strips placed value from candidates in same-cage cells AND all 8-directional neighbours.

**Bank versioning:** Added `suguru_bank_version` localStorage key. When the JSON banks are regenerated (e.g. for the uniqueness fix), bumping the constant in `suguru.js` triggers an automatic reset of the per-player "played puzzle indices" list, so users get a fresh pool against the new bank.

---

## Phase 2 — Switch Nettle to JSON puzzle bank + GitHub Actions scheduler
**Date:** 2026-05-27

**Problem:** Nettle's in-browser puzzle generation was unreliable. Initial implementation blocked the main thread; moving to a Web Worker helped on some browsers but the underlying CSP solver could still run for seconds on bad cage layouts. Users were stuck on the loading spinner without ever seeing a puzzle.

**Solution:** Pre-baked JSON puzzle bank.
- New `scripts/generate-suguru.js` runs offline (Node.js), uses an MRV-heuristic solver (~100× faster than the simple backtracker), and writes bundles to `games/suguru/puzzles/{easy,medium,hard}.json`.
- Game fetches the JSON at start, picks a random unplayed puzzle, tracks played indices in localStorage. When the entire bank is played, silently reset and loop.
- Initial seed: 150/150/100 puzzles per difficulty (~91 KB total).
- Deleted the Web Worker (`suguru-worker.js`) — no longer needed.

**Scheduling:** Added `.github/workflows/generate-puzzles.yml` that runs the generator on the 1st of every month and commits new puzzles back to the repo. Also triggerable on demand from the Actions tab.

**Why JSON bank over live generation:**
- Live load goes from "indefinite" to ~50ms
- Quality can be controlled (uniqueness, cage layout sanity, difficulty curation) once offline
- No CPU pressure on user's device
- Same pattern will apply to future games where live generation is hard (Pixle, Crossum)

---

## Phase 1 — Add Nettle (Suguru) + scaffold remaining games
**Date:** 2026-05-19 → 2026-05-26

**What:** Built the Nettle game from scratch (display name "Nettle", URL slug `/games/suguru/`). Added cards on the games index for the other planned games (Pixle, Threadle, Crossum, Wordle) with simple coming-soon placeholder pages.

**Nettle core:**
- 3 difficulties: Easy (5×5), Medium and Hard (7×7) — Hard removes more clues
- Cage layout generated by greedy BFS region-growing with size bias toward 3–5 cells
- Solver originally lived in-browser (replaced in Phase 2)
- Standard UI shared with Sudoku: pause, undo, restart, give-up, pencil mode, daily reward overlay, tutorial, coin reward, best-time tracking

**UX iterations:**
- Picker buttons dim digits that exceed the cage's max size, and digits already used by same-cage cells, AND digits held by 8-directional neighbours (no-touch rule)
- Same-number highlight upgraded from subtle text-shadow → soft pink background tint for visibility
- Pencil candidates resized from ~0.3rem → ~0.8rem
- Title gradient fix (line-height + padding to avoid descender clipping)

**Renames:** Display names for stubbed/built games changed for memorability while URL slugs stayed as the original genre name:
- Suguru → **Nettle**
- Nonogram → **Pixle**
- Masyu → **Threadle**
- Kakuro → **Crossum**
- Sudoku, Wordle unchanged

---

## Phase 0 — Site foundation (pre-existing)
**Date:** Earlier (before this log was kept)

- Static GitHub Pages site at gracermy.github.io
- `/` homepage with cherry-blossom canvas (`blossom.js`)
- `/booth/` vintage photo booth strip generator
- `/games/sudoku/` fully built game with live in-browser generation, coin system, pencil mode, hint shop, resume, daily reward
- `games/profile.js` shared cross-game profile system (coins, streak, daily reward, best times)

---

## Architectural patterns worth remembering

### Shared profile system
All games load `/games/profile.js` before their own JS. It manages a single localStorage profile with coins, streak, daily reward, best times keyed as `"<game>_<difficulty>"`. Daily reward curve (Phase 5, replaced the old `50 + min(streak-1,5)*10`): days 1–7 = 50/60/70/80/90/100/**200**, then cycles back to 50 while the streak counter keeps growing. Helpers: `rewardForDay()`, `dailyRewardSchedule()`.

### Puzzle bank pattern (for games with slow/unreliable live generation)
1. Write `scripts/generate-<game>.js` (Node, runs offline)
2. Bundles output to `games/<game>/puzzles/{easy,medium,hard}.json`
3. Game code: `fetch()` the bank, pick a random unplayed index from localStorage, track played indices, silently loop when exhausted
4. Add bank version key + migration so regenerated banks reset played indices
5. Add a step to `.github/workflows/generate-puzzles.yml` for monthly auto-top-up

### URL slugs vs display names
Folders/routes use the original genre name. Display names (titles, h1s, cards on the games index) use the rebranded name. See `docs/development-log.md` for the mapping, or check `games/index.html` for the canonical labels.

### Daily mode is deferred
No per-game daily mode in v1. The plan is to build a unified cross-game daily challenge system later, plugging into the existing `claimDailyReward()` streak infrastructure.
