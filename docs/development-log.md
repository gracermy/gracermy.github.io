# Development log

A running record of major changes to gracermy.github.io — what we built, why, and how. Most-recent first.

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
All games load `/games/profile.js` before their own JS. It manages a single localStorage profile with coins, streak, daily reward, best times keyed as `"<game>_<difficulty>"`. Daily reward formula: `50 + min(streak-1, 5)*10`.

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
