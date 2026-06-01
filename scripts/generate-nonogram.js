#!/usr/bin/env node
/**
 * Nonogram (Pixle) puzzle bank generator.
 * Generates puzzles for each difficulty and APPENDS them to existing JSON files.
 *
 * A nonogram is "fair" only if its row/column clues yield exactly ONE solution.
 * We generate a random filled picture, derive its clues, then verify uniqueness
 * with a line-solver (constraint propagation). If propagation can't fully solve
 * the puzzle from the clues alone, it's ambiguous and we discard it.
 *
 * Usage:  node scripts/generate-nonogram.js
 *         node scripts/generate-nonogram.js --counts 50,50,30
 *
 * Storage format per puzzle:
 *   { id, rows, cols, solution: ["10110", ...], rowClues: [[..]], colClues: [[..]] }
 * Solution rows are stored as bit-strings ("1"=filled, "0"=blank) to keep JSON small.
 */

const fs = require('fs');
const path = require('path');

const DIFFICULTIES = {
  easy:   { rows: 5,  cols: 5,  density: 0.55, palette: 1 },
  medium: { rows: 10, cols: 10, density: 0.50, palette: 2 },
  hard:   { rows: 15, cols: 15, density: 0.48, palette: 3 },
};

// Flat colors a filled cell can take. Each puzzle picks `palette` of these at
// random; every filled cell is assigned one of the chosen colors. Mirrors how
// real picture nonograms use only a few colors (subject + background, etc.).
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

// ── helpers ──────────────────────────────────────────────────
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Run-length clues for a single line of booleans. Empty line → [0].
function lineClues(line) {
  const clues = [];
  let run = 0;
  for (const v of line) {
    if (v) run++;
    else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues.length ? clues : [0];
}

// ── random picture ───────────────────────────────────────────
// Generate a grid at the target density, rejecting fully-empty rows/cols
// (those make a "0" clue, which is fine, but an all-empty grid is a dud).
function randomGrid(rows, cols, density) {
  const grid = [];
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const on = Math.random() < density;
      row.push(on ? 1 : 0);
      if (on) filled++;
    }
    grid.push(row);
  }
  // Reject near-empty / near-full grids — they tend to be trivial or ugly.
  const total = rows * cols;
  if (filled < total * 0.25 || filled > total * 0.75) return null;
  return grid;
}

// ── line solver (constraint propagation) ─────────────────────
// State per cell: -1 unknown, 0 blank, 1 filled.
// Returns true if `clue` can be satisfied for `line`, and writes the cells
// that are forced (same value in every valid placement) back into `line`.
//
// We enumerate valid placements of the clue's runs over the line, intersecting
// with the known cells, then for each cell mark it filled/blank if ALL valid
// placements agree. If no valid placement exists → contradiction (return false).
function solveLine(line, clue) {
  const n = line.length;
  // Special case: clue [0] means the whole line is blank.
  if (clue.length === 1 && clue[0] === 0) {
    for (let i = 0; i < n; i++) {
      if (line[i] === 1) return false;
      line[i] = 0;
    }
    return true;
  }

  // Accumulators: for each cell, can it be filled / can it be blank across
  // all valid placements?
  const canFill = new Array(n).fill(false);
  const canBlank = new Array(n).fill(false);
  let anyValid = false;

  // Recursively place run `ci` starting at position `pos`.
  const placement = new Array(n).fill(0); // 1=filled in this placement
  function place(ci, pos) {
    if (ci === clue.length) {
      // Remaining cells are blank; validate against known line.
      for (let i = pos; i < n; i++) placement[i] = 0;
      // Check consistency with known cells
      for (let i = 0; i < n; i++) {
        if (line[i] === 1 && placement[i] !== 1) return;
        if (line[i] === 0 && placement[i] !== 0) return;
      }
      anyValid = true;
      for (let i = 0; i < n; i++) {
        if (placement[i] === 1) canFill[i] = true; else canBlank[i] = true;
      }
      return;
    }
    const runLen = clue[ci];
    // Remaining runs need at least sum+gaps space.
    let need = 0;
    for (let k = ci; k < clue.length; k++) need += clue[k];
    need += clue.length - 1 - ci; // gaps between remaining runs
    const lastStart = n - need;
    for (let start = pos; start <= lastStart; start++) {
      // Cells [pos, start) are blank, [start, start+runLen) filled.
      let ok = true;
      for (let i = pos; i < start; i++) {
        if (line[i] === 1) { ok = false; break; }
      }
      if (!ok) continue;
      for (let i = start; i < start + runLen; i++) {
        if (line[i] === 0) { ok = false; break; }
      }
      if (!ok) continue;
      // Gap cell after the run (if any) must be blankable.
      const after = start + runLen;
      if (ci < clue.length - 1 && after < n && line[after] === 1) {
        // need a gap here but it's known filled → invalid
        continue;
      }
      // Commit this run into placement
      for (let i = pos; i < start; i++) placement[i] = 0;
      for (let i = start; i < after; i++) placement[i] = 1;
      const nextPos = after + (ci < clue.length - 1 ? 1 : 0);
      if (after < n && ci < clue.length - 1) placement[after] = 0;
      place(ci + 1, nextPos);
    }
  }
  place(0, 0);

  if (!anyValid) return false;

  for (let i = 0; i < n; i++) {
    if (canFill[i] && !canBlank[i]) {
      if (line[i] === 0) return false;
      line[i] = 1;
    } else if (canBlank[i] && !canFill[i]) {
      if (line[i] === 1) return false;
      line[i] = 0;
    }
  }
  return true;
}

// Try to solve the whole puzzle from clues alone via iterative line solving.
// Returns 'unique' if fully solved, 'ambiguous' if it stalls with unknowns,
// 'contradiction' if a line can't be satisfied.
function lineSolve(rows, cols, rowClues, colClues) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(-1));

  let changed = true;
  let guard = 0;
  while (changed) {
    if (++guard > rows * cols * 4 + 50) break; // safety
    changed = false;

    // Rows
    for (let r = 0; r < rows; r++) {
      const before = grid[r].join(',');
      if (!solveLine(grid[r], rowClues[r])) return 'contradiction';
      if (grid[r].join(',') !== before) changed = true;
    }
    // Cols
    for (let c = 0; c < cols; c++) {
      const col = new Array(rows);
      for (let r = 0; r < rows; r++) col[r] = grid[r][c];
      const before = col.join(',');
      if (!solveLine(col, colClues[c])) return 'contradiction';
      if (col.join(',') !== before) {
        changed = true;
        for (let r = 0; r < rows; r++) grid[r][c] = col[r];
      }
    }
  }

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] === -1) return 'ambiguous';
  return 'unique';
}

// ── generate a single puzzle ─────────────────────────────────
function generateOne(cfg) {
  const { rows, cols, density } = cfg;
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = randomGrid(rows, cols, density);
    if (!grid) continue;

    const rowClues = grid.map(lineClues);
    const colClues = [];
    for (let c = 0; c < cols; c++) {
      const col = grid.map(row => row[c]);
      colClues.push(lineClues(col));
    }

    if (lineSolve(rows, cols, rowClues, colClues) !== 'unique') continue;

    // Pick this puzzle's palette and assign each filled cell a color index.
    // Clues are based on filled/blank only (monochrome logic); color is purely
    // decorative, so it doesn't affect solvability or uniqueness.
    const palette = shuffle([...COLOR_POOL]).slice(0, cfg.palette);
    // Per-cell color index as a single char ("." = blank). Palette size ≤ 8,
    // so a single digit per cell is enough.
    const colorRows = grid.map(row =>
      row.map(v => v ? String(Math.floor(Math.random() * palette.length)) : '.').join(''));

    return {
      rows, cols,
      solution: grid.map(row => row.join('')),
      rowClues,
      colClues,
      palette,
      colors: colorRows,   // per-cell color index ("." = blank)
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
      const p = generateOne(cfg);
      if (!p) {
        failed++;
        if (failed > 500) { console.error(`  too many failures (${failed}), stopping early`); break; }
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
