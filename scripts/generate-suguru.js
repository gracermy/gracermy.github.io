#!/usr/bin/env node
/**
 * Suguru puzzle bank generator.
 * Generates puzzles for each difficulty and APPENDS them to existing JSON files.
 *
 * Usage:  node scripts/generate-suguru.js
 *         node scripts/generate-suguru.js --counts 50,50,30
 */

const fs = require('fs');
const path = require('path');

const DIFFICULTIES = {
  easy:   { rows: 5, cols: 5, clueRatio: 0.45 },
  medium: { rows: 7, cols: 7, clueRatio: 0.30 },
  hard:   { rows: 7, cols: 7, clueRatio: 0.18 },
};
const MAX_CAGE_SIZE = 5;
const DEFAULT_COUNTS = { easy: 150, medium: 150, hard: 100 };
const OUT_DIR = path.join(__dirname, '..', 'games', 'suguru', 'puzzles');

// ── helpers ──────────────────────────────────────────────────
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function neighbors4(r, c, rows, cols) {
  return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]
    .filter(([nr,nc]) => nr >= 0 && nr < rows && nc >= 0 && nc < cols);
}

function neighbors8(r, c, rows, cols) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push([nr, nc]);
  }
  return out;
}

// ── cage layout ──────────────────────────────────────────────
// Target sizes weighted toward 3-5 cell cages (avoids many tiny cages
// which would create impossible "1 touches 1" situations).
function pickCageSize() {
  const r = Math.random();
  if (r < 0.05) return 1;
  if (r < 0.20) return 2;
  if (r < 0.50) return 3;
  if (r < 0.80) return 4;
  return 5;
}

function generateCages(rows, cols) {
  const total = rows * cols;
  const assigned = new Array(total).fill(-1);
  const cageList = [];
  const order = shuffle([...Array(total).keys()]);

  for (const start of order) {
    if (assigned[start] !== -1) continue;
    const cageId = cageList.length;
    const size = pickCageSize();
    const members = [start];
    assigned[start] = cageId;

    const sr = Math.floor(start / cols), sc = start % cols;
    const frontier = [];
    for (const [nr, nc] of neighbors4(sr, sc, rows, cols)) {
      if (assigned[nr * cols + nc] === -1) frontier.push(nr * cols + nc);
    }
    shuffle(frontier);

    while (members.length < size && frontier.length > 0) {
      const next = frontier.shift();
      if (assigned[next] !== -1) continue;
      assigned[next] = cageId;
      members.push(next);
      const nr = Math.floor(next / cols), nc = next % cols;
      for (const [nnr, nnc] of neighbors4(nr, nc, rows, cols)) {
        const ni = nnr * cols + nnc;
        if (assigned[ni] === -1 && !frontier.includes(ni)) frontier.push(ni);
      }
    }
    cageList.push({ id: cageId, cells: members, size: members.length });
  }

  // Greedy repair: merge orphaned 1-cell cages into a larger neighbour
  // when possible, to reduce dead layouts where 1s would need to touch.
  for (const cage of cageList) {
    if (cage.size !== 1) continue;
    const cell = cage.cells[0];
    const r = Math.floor(cell / cols), c = cell % cols;
    // Find a neighbouring cage with size < MAX_CAGE_SIZE we can merge into
    let bestNeighbour = null;
    for (const [nr, nc] of neighbors4(r, c, rows, cols)) {
      const otherId = assigned[nr * cols + nc];
      if (otherId === cage.id) continue;
      const other = cageList[otherId];
      if (other.size < MAX_CAGE_SIZE && (!bestNeighbour || other.size < bestNeighbour.size)) {
        bestNeighbour = other;
      }
    }
    if (bestNeighbour) {
      bestNeighbour.cells.push(cell);
      bestNeighbour.size++;
      assigned[cell] = bestNeighbour.id;
      cage.cells = [];
      cage.size = 0;
    }
  }
  // Filter out emptied cages and re-id
  const filtered = cageList.filter(c => c.size > 0).map((c, i) => ({ ...c, id: i }));
  const cageMap = new Array(total);
  for (const cage of filtered) for (const ci of cage.cells) cageMap[ci] = cage.id;
  return { cageList: filtered, cageMap };
}

// ── solver ───────────────────────────────────────────────────
function buildPeers(rows, cols, cageList, cageMap) {
  const total = rows * cols;
  const peers = new Array(total);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = r * cols + c;
      const seen = new Set();
      for (const [nr, nc] of neighbors8(r, c, rows, cols)) seen.add(nr * cols + nc);
      for (const pc of cageList[cageMap[ci]].cells) seen.add(pc);
      seen.delete(ci);
      peers[ci] = [...seen];
    }
  }
  return peers;
}

function popcount(x) {
  // Count set bits in 5-bit number (max cage size 5)
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}

function generateSolution(rows, cols, cageList, cageMap, deadline) {
  const peers = buildPeers(rows, cols, cageList, cageMap);
  const total = rows * cols;
  const board = new Int8Array(total);
  const domain = new Int8Array(total);
  for (let ci = 0; ci < total; ci++) {
    domain[ci] = (1 << cageList[cageMap[ci]].size) - 1;
  }

  function solve() {
    if (Date.now() > deadline) return false;

    // Pick the unfilled cell with the smallest domain (MRV heuristic)
    let bestCi = -1, bestSize = 99;
    for (let ci = 0; ci < total; ci++) {
      if (board[ci] !== 0) continue;
      const s = popcount(domain[ci]);
      if (s === 0) return false; // dead branch
      if (s < bestSize) { bestSize = s; bestCi = ci; if (s === 1) break; }
    }
    if (bestCi === -1) return true; // all filled

    const ci = bestCi;
    const maxVal = cageList[cageMap[ci]].size;
    const avail = [];
    for (let v = 1; v <= maxVal; v++) {
      if (domain[ci] & (1 << (v - 1))) avail.push(v);
    }
    shuffle(avail);

    for (const v of avail) {
      const bit = 1 << (v - 1);
      const affected = [];
      let ok = true;
      for (const pi of peers[ci]) {
        if (domain[pi] & bit) {
          domain[pi] ^= bit;
          affected.push(pi);
          if (domain[pi] === 0 && board[pi] === 0) { ok = false; break; }
        }
      }
      if (ok) {
        board[ci] = v;
        const savedDomain = domain[ci];
        domain[ci] = bit;
        if (solve()) return true;
        board[ci] = 0;
        domain[ci] = savedDomain;
      }
      for (const pi of affected) domain[pi] |= bit;
    }
    return false;
  }

  if (!solve()) return null;
  const result = [];
  for (let r = 0; r < rows; r++) result.push([...board.slice(r * cols, (r + 1) * cols)]);
  return result;
}

function removeClues(sol, clueRatio) {
  const rows = sol.length, cols = sol[0].length;
  const total = rows * cols;
  const puzzle = sol.map(r => [...r]);
  const toRemove = total - Math.round(total * clueRatio);
  const order = shuffle([...Array(total).keys()]);
  for (let i = 0; i < toRemove; i++) {
    const r = Math.floor(order[i] / cols), c = order[i] % cols;
    puzzle[r][c] = 0;
  }
  return puzzle;
}

// ── generate a single puzzle (with retry on solver timeout) ──
function generateOne(cfg) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { cageList, cageMap } = generateCages(cfg.rows, cfg.cols);
    const deadline = Date.now() + 3000; // 3s budget per attempt
    const solution = generateSolution(cfg.rows, cfg.cols, cageList, cageMap, deadline);
    if (!solution) continue;
    const puzzle = removeClues(solution, cfg.clueRatio);
    return { solution, puzzle, cageList, cageMap, createdAt: new Date().toISOString() };
  }
  return null;
}

// ── load existing bank, append new puzzles ───────────────────
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
  const arg = process.argv.find(a => a.startsWith('--counts='));
  if (!arg) {
    const idx = process.argv.indexOf('--counts');
    if (idx !== -1 && process.argv[idx+1]) {
      const [e,m,h] = process.argv[idx+1].split(',').map(Number);
      return { easy: e, medium: m, hard: h };
    }
    return DEFAULT_COUNTS;
  }
  const [e,m,h] = arg.split('=')[1].split(',').map(Number);
  return { easy: e, medium: m, hard: h };
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
      if (!p) { failed++; if (failed > 50) { console.error(`  too many failures (${failed}), stopping early`); break; } continue; }
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
