#!/usr/bin/env node
/**
 * Nonogram (Pixle) puzzle bank generator — COLORED nonograms.
 *
 * Each filled cell has a colour. A clue is an ordered list of [length, colour]
 * runs. Colour rules (standard for colored nonograms):
 *   - two SAME-colour runs need at least one blank gap between them;
 *   - two DIFFERENT-colour runs may touch with no gap.
 * A puzzle is kept only if its clues yield exactly ONE solution, verified by a
 * colour-aware line-solver (constraint propagation). Ambiguous puzzles are
 * discarded.
 *
 * Palette size varies by difficulty so puzzles range from monochrome to
 * colourful:
 *   easy   → always 1 colour (classic picross)
 *   medium → 1–3 colours
 *   hard   → 1–4 colours
 *
 * Usage:  node scripts/generate-nonogram.js
 *         node scripts/generate-nonogram.js --counts 50,50,30
 *
 * Storage per puzzle:
 *   { id, rows, cols, palette: ["#..",..],
 *     solution: ["0102","..."],   // per-cell: '0' blank, '1'=palette[0], '2'=palette[1] ...
 *     rowClues: [[[len,colorIdx],...], ...],
 *     colClues: [[[len,colorIdx],...], ...] }
 * (colorIdx is 0-based into palette.)
 */

const fs = require('fs');
const path = require('path');

// NOTE on colours: random colored nonograms are rarely UNIQUELY solvable as
// the colour count rises (3-colour hard ≈ 0%). So the random bank caps colours
// low and runs at a higher density (which boosts the unique-solution rate).
// Richer 3+ colour puzzles will come from the designed-picture phase, where
// uniqueness is controlled by hand rather than by chance.
const DIFFICULTIES = {
  easy:   { rows: 5,  cols: 5,  density: 0.58, colorsMin: 1, colorsMax: 1 },
  medium: { rows: 10, cols: 10, density: 0.65, colorsMin: 1, colorsMax: 2 },
  hard:   { rows: 15, cols: 15, density: 0.65, colorsMin: 1, colorsMax: 2 },
};

// Palette pool — filled cells take one of the puzzle's chosen colours.
const COLOR_POOL = [
  '#f472b6', // pink
  '#60a5fa', // blue
  '#a78bfa', // purple
  '#34d399', // green
  '#fbbf24', // amber
  '#fb7185', // rose
  '#22d3ee', // cyan
  '#f97316', // orange
];
const DEFAULT_COUNTS = { easy: 150, medium: 150, hard: 100 };
const OUT_DIR = path.join(__dirname, '..', 'games', 'nonogram', 'puzzles');

const BLANK = 0;   // cell with no colour
const UNKNOWN = -1; // solver: not yet determined

// ── helpers ──────────────────────────────────────────────────
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Colour-aware run-length clues for a line of cell values (0 = blank,
// 1..K = colour). Returns [[len, color], ...]; empty line → [].
// A new run starts whenever colour changes (even with no blank between) or a
// blank breaks the run.
function lineClues(line) {
  const clues = [];
  let runLen = 0, runColor = BLANK;
  for (const v of line) {
    if (v === BLANK) {
      if (runLen > 0) clues.push([runLen, runColor - 1]);
      runLen = 0; runColor = BLANK;
    } else if (v === runColor) {
      runLen++;
    } else {
      if (runLen > 0) clues.push([runLen, runColor - 1]);
      runLen = 1; runColor = v;
    }
  }
  if (runLen > 0) clues.push([runLen, runColor - 1]);
  return clues;
}

// ── random colored picture ───────────────────────────────────
function randomGrid(rows, cols, density, numColors) {
  const grid = [];
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (Math.random() < density) {
        row.push(1 + Math.floor(Math.random() * numColors)); // colour 1..numColors
        filled++;
      } else {
        row.push(BLANK);
      }
    }
    grid.push(row);
  }
  const total = rows * cols;
  if (filled < total * 0.25 || filled > total * 0.75) return null;
  // Require every colour to actually appear, else the palette claim is a lie.
  const seen = new Set();
  for (const row of grid) for (const v of row) if (v !== BLANK) seen.add(v);
  if (seen.size !== numColors) return null;
  // Every row AND column must have at least one filled cell — no fully-blank
  // (numberless) clue lines, which look broken in the UI.
  for (let r = 0; r < rows; r++) {
    if (grid[r].every(v => v === BLANK)) return null;
  }
  for (let c = 0; c < cols; c++) {
    if (grid.every(row => row[c] === BLANK)) return null;
  }
  return grid;
}

// ── colour-aware line solver ─────────────────────────────────
// Cell domain is a bitmask over {blank, colour1..K}. bit 0 = blank,
// bit (k) = colour k. `line` holds either UNKNOWN or a concrete value (0..K).
// We enumerate every valid placement of the clue's runs, honouring:
//   - same-colour consecutive runs need ≥1 blank gap;
//   - different-colour consecutive runs may be adjacent (gap optional).
// For each cell we record which concrete values appear across ALL valid
// placements; a cell is forced if only one value is possible.
function solveLine(line, clue, numColors) {
  const n = line.length;

  // possible[i] = Set of values (0..K) that cell i can take across placements
  const possible = Array.from({ length: n }, () => new Set());
  let anyValid = false;

  const placement = new Array(n).fill(BLANK);

  // Minimum cells needed for runs[ci..end], including mandatory same-colour gaps.
  function minSpace(ci) {
    let need = 0;
    for (let k = ci; k < clue.length; k++) {
      need += clue[k][0];
      if (k > ci) {
        // gap required only if this run and the previous are the same colour
        if (clue[k][1] === clue[k - 1][1]) need += 1;
      }
    }
    return need;
  }

  function place(ci, pos) {
    if (ci === clue.length) {
      for (let i = pos; i < n; i++) placement[i] = BLANK;
      // validate against known cells
      for (let i = 0; i < n; i++) {
        if (line[i] !== UNKNOWN && line[i] !== placement[i]) return;
      }
      anyValid = true;
      for (let i = 0; i < n; i++) possible[i].add(placement[i]);
      return;
    }
    const [runLen, colorIdx] = clue[ci];
    const colorVal = colorIdx + 1;
    const need = minSpace(ci);
    const lastStart = n - need;
    for (let start = pos; start <= lastStart; start++) {
      // [pos, start) blank
      let ok = true;
      for (let i = pos; i < start; i++) {
        if (line[i] !== UNKNOWN && line[i] !== BLANK) { ok = false; break; }
      }
      if (!ok) continue;
      // [start, start+runLen) this colour
      for (let i = start; i < start + runLen; i++) {
        if (line[i] !== UNKNOWN && line[i] !== colorVal) { ok = false; break; }
      }
      if (!ok) continue;
      const after = start + runLen;
      // Determine gap before next run.
      let nextPos;
      if (ci < clue.length - 1) {
        const sameColor = clue[ci + 1][1] === colorIdx;
        if (sameColor) {
          // mandatory blank gap
          if (after >= n) continue;
          if (line[after] !== UNKNOWN && line[after] !== BLANK) continue;
          nextPos = after + 1;
        } else {
          // different colour may touch; no forced gap
          nextPos = after;
        }
      } else {
        nextPos = after;
      }
      // commit
      for (let i = pos; i < start; i++) placement[i] = BLANK;
      for (let i = start; i < after; i++) placement[i] = colorVal;
      if (ci < clue.length - 1 && clue[ci + 1][1] === colorIdx && after < n) {
        placement[after] = BLANK;
      }
      place(ci + 1, nextPos);
    }
  }

  // Empty clue → whole line blank.
  if (clue.length === 0) {
    for (let i = 0; i < n; i++) {
      if (line[i] !== UNKNOWN && line[i] !== BLANK) return false;
      line[i] = BLANK;
    }
    return true;
  }

  place(0, 0);
  if (!anyValid) return false;

  for (let i = 0; i < n; i++) {
    if (possible[i].size === 1) {
      const v = [...possible[i]][0];
      if (line[i] !== UNKNOWN && line[i] !== v) return false;
      line[i] = v;
    }
  }
  return true;
}

function lineSolve(rows, cols, rowClues, colClues, numColors) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(UNKNOWN));

  let changed = true, guard = 0;
  while (changed) {
    if (++guard > rows * cols * 4 + 50) break;
    changed = false;

    for (let r = 0; r < rows; r++) {
      const before = grid[r].join(',');
      if (!solveLine(grid[r], rowClues[r], numColors)) return 'contradiction';
      if (grid[r].join(',') !== before) changed = true;
    }
    for (let c = 0; c < cols; c++) {
      const col = new Array(rows);
      for (let r = 0; r < rows; r++) col[r] = grid[r][c];
      const before = col.join(',');
      if (!solveLine(col, colClues[c], numColors)) return 'contradiction';
      if (col.join(',') !== before) {
        changed = true;
        for (let r = 0; r < rows; r++) grid[r][c] = col[r];
      }
    }
  }

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === UNKNOWN) return 'ambiguous';
  return 'unique';
}

// ── generate a single puzzle ─────────────────────────────────
// `wantColors` (optional) forces a specific colour count for this puzzle, so
// the caller can deliberately mix mono and colourful puzzles in the bank
// rather than letting the easier mono case dominate.
function generateOne(cfg, wantColors) {
  const { rows, cols, density } = cfg;
  for (let attempt = 0; attempt < 300; attempt++) {
    const numColors = wantColors || (cfg.colorsMin +
      Math.floor(Math.random() * (cfg.colorsMax - cfg.colorsMin + 1)));
    const grid = randomGrid(rows, cols, density, numColors);
    if (!grid) continue;

    const rowClues = grid.map(lineClues);
    const colClues = [];
    for (let c = 0; c < cols; c++) {
      colClues.push(lineClues(grid.map(row => row[c])));
    }

    if (lineSolve(rows, cols, rowClues, colClues, numColors) !== 'unique') continue;

    const palette = shuffle([...COLOR_POOL]).slice(0, numColors);

    return {
      rows, cols,
      palette,
      solution: grid.map(row => row.join('')), // '0' blank, '1'..'K' colour idx+1
      rowClues,
      colClues,
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

// ── load/save bank ───────────────────────────────────────────
function loadBank(file) {
  if (!fs.existsSync(file)) return { puzzles: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { puzzles: [] }; }
}
function saveBank(file, bank) {
  fs.writeFileSync(file, JSON.stringify(bank));
}

// ── main ─────────────────────────────────────────────────────
function parseCounts() {
  const idx = process.argv.indexOf('--counts');
  if (idx !== -1 && process.argv[idx + 1]) {
    const [e, m, h] = process.argv[idx + 1].split(',').map(Number);
    return { easy: e, medium: m, hard: h };
  }
  const arg = process.argv.find(a => a.startsWith('--counts='));
  if (arg) {
    const [e, m, h] = arg.split('=')[1].split(',').map(Number);
    return { easy: e, medium: m, hard: h };
  }
  return DEFAULT_COUNTS;
}

function main() {
  const counts = parseCounts();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [diff, cfg] of Object.entries(DIFFICULTIES)) {
    const target = counts[diff];
    if (!target) continue;
    const file = path.join(OUT_DIR, `${diff}.json`);
    const bank = loadBank(file);
    const startCount = bank.puzzles.length;
    process.stdout.write(`\n[${diff}] starting with ${startCount} puzzles, generating ${target} more...\n`);

    let generated = 0, failed = 0;
    const t0 = Date.now();
    while (generated < target) {
      // Alternate the requested colour count so the bank gets a real mix
      // instead of defaulting to the easy-to-generate mono case. Roughly half
      // mono, half at the difficulty's max colours.
      const wantColors = cfg.colorsMax > 1
        ? (generated % 2 === 0 ? 1 : cfg.colorsMax)
        : 1;
      const p = generateOne(cfg, wantColors);
      if (!p) {
        failed++;
        if (failed > 2000) { console.error(`  too many failures (${failed}), stopping early`); break; }
        continue;
      }
      p.id = startCount + generated;
      bank.puzzles.push(p);
      generated++;
      if (generated % 10 === 0 || generated === target) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`  ${generated}/${target} (${elapsed}s)\r`);
      }
    }
    process.stdout.write('\n');
    saveBank(file, bank);
    const sizeKB = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`  saved ${file} (${bank.puzzles.length} total, ${sizeKB} KB)`);
  }
  console.log('\nDone.');
}

main();
