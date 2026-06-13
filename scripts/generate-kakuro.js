#!/usr/bin/env node
/* ═══════════════════════════════════════════════════
   GENERATE-KAKURO.JS  (Crossum)
   Pre-generates uniquely-solvable Kakuro puzzles offline, mirroring the
   suguru/nonogram bank pattern.

   Pipeline per puzzle:
     1. Build a wall/white layout (top row + left col are walls; interior walls
        carved so every white run is length 2..maxRun, no length-1 runs).
     2. Fill the white cells with a backtracking solver honouring, per run:
        digits 1..9, all distinct, summing to nothing-yet (free fill) — we fill
        first, then DERIVE the run sums from the filled solution.
     3. Verify the derived clues yield a UNIQUE solution (solver early-exits at 2).
        Reject if 0 or >=2 solutions.

   Output bank entry:
     { rows, cols, cells: [ {t:'wall',down,right} | {t:'cell'} ], solution, id }
   ═══════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'games', 'kakuro', 'puzzles');

const DIFFICULTIES = {
  // Shorter maxRun ⇒ small per-run solution spaces ⇒ fast uniqueness check and a
  // high unique-solution rate. Difficulty scales by grid size, not run length.
  easy:   { rows: 5,  cols: 5,  maxRun: 3, interiorWallProb: 0.22 },
  medium: { rows: 7,  cols: 7,  maxRun: 3, interiorWallProb: 0.26 },
  hard:   { rows: 9,  cols: 9,  maxRun: 4, interiorWallProb: 0.24 },
};
const DEFAULT_COUNTS = { easy: 150, medium: 150, hard: 100 };

/* ── utils ── */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ── LAYOUT (constructive) ──
   Returns a 2D `wall` array (true=wall). Row 0 and col 0 are always walls (clue
   holders). Strategy: start from a fully-white interior (which is trivially
   interlocked) and GREEDILY carve interior walls one at a time, accepting a wall
   only if the layout stays valid afterwards (all runs 2..maxRun, full interlock,
   no isolated cells). Building up from a valid state — rather than repairing a
   random mess — reliably yields good layouts at 7×7 and 9×9. */
function buildLayout(R, C, interiorWallProb, maxRun) {
  const wall = Array.from({ length: R }, (_, r) =>
    Array.from({ length: C }, (_, c) => (r === 0 || c === 0)));

  // A solid white interior usually has runs longer than maxRun, so we MUST carve
  // enough walls to break them. Target roughly interiorWallProb of interior cells.
  const interior = [];
  for (let r = 1; r < R; r++) for (let c = 1; c < C; c++) interior.push([r, c]);
  shuffle(interior);

  // First pass: force-split any run exceeding maxRun (mandatory walls).
  // Then optional walls add variety. We test validity incrementally.
  const targetWalls = Math.round(interior.length * (interiorWallProb + 0.18));
  let placed = 0;
  for (const [r, c] of interior) {
    if (placed >= targetWalls) break;
    wall[r][c] = true;
    // accept only if no white cell became isolated. Long runs are fine here — they
    // get split afterwards. (Don't use full layoutValid: the solid start has long
    // runs, which would reject every placement.)
    if (noIsolated(wall, R, C)) { placed++; }
    else wall[r][c] = false;
  }

  // Even after optional walls, long runs may remain if no wall could be placed
  // without breaking interlock. Do a final mandatory split of any over-long run,
  // re-checking validity; if a split can't be made validly, this layout fails.
  if (!splitLongRuns(wall, R, C, maxRun)) return null;

  return layoutValid(wall, R, C, maxRun) ? wall : null;
}

/* Force-split runs longer than maxRun. Returns false if a needed split would
   break validity (caller discards the layout). */
function splitLongRuns(wall, R, C, maxRun) {
  const isW = (r, c) => r >= 1 && r < R && c >= 1 && c < C && !wall[r][c];
  for (let pass = 0; pass < 8; pass++) {
    let longFound = false;
    for (let r = 1; r < R; r++) {
      let c = 1;
      while (c < C) {
        if (!isW(r, c)) { c++; continue; }
        let cc = c; while (isW(r, cc)) cc++;
        if (cc - c > maxRun) {
          longFound = true;
          wall[r][c + maxRun] = true;
          if (!layoutValid(wall, R, C, maxRun)) return false;
        }
        c = cc;
      }
    }
    for (let c = 1; c < C; c++) {
      let r = 1;
      while (r < R) {
        if (!isW(r, c)) { r++; continue; }
        let rr = r; while (isW(rr, c)) rr++;
        if (rr - r > maxRun) {
          longFound = true;
          wall[r + maxRun][c] = true;
          if (!layoutValid(wall, R, C, maxRun)) return false;
        }
        r = rr;
      }
    }
    if (!longFound) return true;
  }
  return true;
}

/* No-isolated check (ignores maxRun): every white cell must have at least one
   white orthogonal neighbour, so it sits in some length>=2 run. Used while carving. */
function noIsolated(wall, R, C) {
  const isW = (r, c) => r >= 0 && r < R && c >= 0 && c < C && !wall[r][c];
  let any = false;
  for (let r = 1; r < R; r++) for (let c = 1; c < C; c++) {
    if (!isW(r, c)) continue;
    any = true;
    if (!isW(r, c - 1) && !isW(r, c + 1) && !isW(r - 1, c) && !isW(r + 1, c)) return false;
  }
  return any;
}

/* every white cell must be in an across-run AND a down-run of length>=2, and no
   run may exceed maxRun. */
function layoutValid(wall, R, C, maxRun) {
  const isW = (r, c) => r >= 0 && r < R && c >= 0 && c < C && !wall[r][c];
  let anyWhite = false;
  // run-length maps
  const acrossLen = Array.from({ length: R }, () => new Array(C).fill(0));
  const downLen   = Array.from({ length: R }, () => new Array(C).fill(0));

  for (let r = 0; r < R; r++) {
    let c = 0;
    while (c < C) {
      if (!isW(r, c)) { c++; continue; }
      let cc = c; while (isW(r, cc)) cc++;
      const len = cc - c;
      for (let k = c; k < cc; k++) acrossLen[r][k] = len;
      c = cc;
    }
  }
  for (let c = 0; c < C; c++) {
    let r = 0;
    while (r < R) {
      if (!isW(r, c)) { r++; continue; }
      let rr = r; while (isW(rr, c)) rr++;
      const len = rr - r;
      for (let k = r; k < rr; k++) downLen[k][c] = len;
      r = rr;
    }
  }

  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!isW(r, c)) continue;
    anyWhite = true;
    const a = acrossLen[r][c], d = downLen[r][c];
    // every white cell must belong to at least one run of length>=2 (no isolated
    // dead cells). Standard Kakuro: a cell may sit in a run in just one direction.
    if (a < 2 && d < 2) return false;
    // no run longer than maxRun
    if (a > maxRun || d > maxRun) return false;
  }
  return anyWhite;
}

/* ── derive run structure from a layout ── */
function runsFromLayout(wall, R, C) {
  const isW = (r, c) => r >= 0 && r < R && c >= 0 && c < C && !wall[r][c];
  const runs = [];   // {cells:[[r,c]...], type:'a'|'d'}
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (!wall[r][c]) continue;
    if (isW(r, c + 1)) { const cs = []; let cc = c + 1; while (isW(r, cc)) { cs.push([r, cc]); cc++; } if (cs.length >= 2) runs.push({ cells: cs, type: 'a', head: [r, c] }); }
    if (isW(r + 1, c)) { const cs = []; let rr = r + 1; while (isW(rr, c)) { cs.push([rr, c]); rr++; } if (cs.length >= 2) runs.push({ cells: cs, type: 'd', head: [r, c] }); }
  }
  return runs;
}

/* ── SOLVER over white cells; counts solutions up to `limit`.
   constraints: a known target sum per run (or null = "free fill" mode for
   the initial solution generation, where sums are not yet fixed). ── */
function solveCount(R, C, wall, runs, targets, limit) {
  const isW = (r, c) => !wall[r][c];
  const whites = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isW(r, c)) whites.push([r, c]);
  const key = (r, c) => r * C + c;
  const wIndex = new Map(); whites.forEach(([r, c], i) => wIndex.set(key(r, c), i));
  const val = new Array(whites.length).fill(0);

  // runs touching each white cell
  const cellRuns = whites.map(() => []);
  runs.forEach((run, ri) => run.cells.forEach(([r, c]) => cellRuns[wIndex.get(key(r, c))].push(ri)));

  // order whites by most-constrained (cells in shorter runs / more runs first) — MRV-ish
  const order = whites.map((_, i) => i).sort((a, b) => cellRuns[b].length - cellRuns[a].length);

  let budget = 40000; // node cap; if exhausted, abort fast (caller treats as non-unique)

  function placeOk(wi, d) {
    for (const ri of cellRuns[wi]) {
      const run = runs[ri];
      let sum = 0, filled = 0;
      const seen = new Set();
      for (const [r, c] of run.cells) {
        const idx = wIndex.get(key(r, c));
        const v = (idx === wi) ? d : val[idx];
        if (v !== 0) {
          if (seen.has(v)) return false;     // duplicate in run
          seen.add(v); sum += v; filled++;
        }
      }
      const target = targets ? targets[ri] : null;
      if (target != null) {
        if (sum > target) return false;
        if (filled === run.cells.length && sum !== target) return false;
        // pruning: remaining cells must be fillable to reach target with distinct unused digits
        const remaining = run.cells.length - filled;
        if (remaining > 0) {
          const need = target - sum;
          // min/max achievable with `remaining` distinct digits not in `seen`
          const avail = [];
          for (let x = 1; x <= 9; x++) if (!seen.has(x)) avail.push(x);
          if (avail.length < remaining) return false;
          const minAdd = avail.slice(0, remaining).reduce((a, b) => a + b, 0);
          const maxAdd = avail.slice(-remaining).reduce((a, b) => a + b, 0);
          if (need < minAdd || need > maxAdd) return false;
        }
      }
    }
    return true;
  }

  let found = 0, aborted = false;
  function bt(oi) {
    if (found >= limit || aborted) return;
    if (--budget <= 0) { aborted = true; return; }
    if (oi === order.length) { found++; return; }
    const wi = order[oi];
    for (let d = 1; d <= 9; d++) {
      if (placeOk(wi, d)) { val[wi] = d; bt(oi + 1); val[wi] = 0; if (found >= limit || aborted) return; }
    }
  }
  bt(0);
  return aborted ? Infinity : found; // Infinity ⇒ too hard to verify, reject as non-unique
}

/* find ONE solution (used to generate the initial fill, free mode) */
function solveOne(R, C, wall, runs) {
  const isW = (r, c) => !wall[r][c];
  const whites = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isW(r, c)) whites.push([r, c]);
  const key = (r, c) => r * C + c;
  const wIndex = new Map(); whites.forEach(([r, c], i) => wIndex.set(key(r, c), i));
  const val = new Array(whites.length).fill(0);
  const cellRuns = whites.map(() => []);
  runs.forEach((run, ri) => run.cells.forEach(([r, c]) => cellRuns[wIndex.get(key(r, c))].push(ri)));

  function okFree(wi, d) {
    for (const ri of cellRuns[wi]) {
      const run = runs[ri];
      const seen = new Set();
      for (const [r, c] of run.cells) {
        const idx = wIndex.get(key(r, c));
        const v = (idx === wi) ? d : val[idx];
        if (v !== 0) { if (seen.has(v)) return false; seen.add(v); }
      }
    }
    return true;
  }
  function bt(i) {
    if (i === whites.length) return true;
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (okFree(i, d)) { val[i] = d; if (bt(i + 1)) return true; val[i] = 0; }
    }
    return false;
  }
  if (!bt(0)) return null;
  const sol = Array.from({ length: R }, () => new Array(C).fill(0));
  whites.forEach(([r, c], i) => { sol[r][c] = val[i]; });
  return sol;
}

/* ── LOGICAL (PROPAGATION) SOLVER ──
   A puzzle is uniquely solvable iff this human-style solver fully determines every
   cell using only sound deductions. We use 9-bit candidate masks (bit (d-1) ⇒ digit
   d possible) and, per run, the precomputed set of digit-combinations that sum to the
   target with distinct digits. Two rules to fixpoint:
     (1) Combination filter: a digit survives in a run only if SOME valid combination
         for that run uses it AND is still consistent with current candidates.
     (2) Naked single: a cell with one candidate is fixed; remove it from run-mates.
   If every cell reaches a single candidate → unique. If it stalls with cells still
   ambiguous → not solvable by logic (reject). This both guarantees uniqueness and is
   fast (no exponential search). */

// precompute: combos[len][sum] = array of 9-bit masks, each a set of `len` distinct
// digits 1..9 summing to `sum`.
const COMBOS = (() => {
  const table = {};
  for (let len = 1; len <= 9; len++) {
    table[len] = {};
    const rec = (start, count, sum, mask) => {
      if (count === len) { (table[len][sum] ||= []).push(mask); return; }
      for (let d = start; d <= 9; d++) rec(d + 1, count + 1, sum + d, mask | (1 << (d - 1)));
    };
    rec(1, 0, 0, 0);
  }
  return table;
})();
const popcount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

/* Returns true if the puzzle (layout + run targets) is solvable by pure logic
   (⇒ unique). `runs` carry .cells; `targets[ri]` is the run's sum. */
function logicSolvable(R, C, wall, runs, targets) {
  const key = (r, c) => r * C + c;
  const cand = new Map();        // cellKey -> 9-bit mask
  const isW = (r, c) => !wall[r][c];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isW(r, c)) cand.set(key(r, c), 0x1FF);

  const runInfo = runs.map((run, ri) => ({
    cells: run.cells.map(([r, c]) => key(r, c)),
    len: run.cells.length,
    sum: targets[ri],
  }));

  let changed = true, guard = 0;
  while (changed && guard++ < 500) {
    changed = false;
    for (const run of runInfo) {
      const combos = COMBOS[run.len][run.sum];
      if (!combos) return false; // impossible run
      // current candidate masks for this run's cells
      const cellMasks = run.cells.map(k => cand.get(k));
      // a digit at position i is allowed only if some valid combo can place the run's
      // digit-set consistent with every cell's candidates. Compute, per cell, the OR of
      // all combos consistent with current masks; then a combo is consistent if each of
      // its digits can be assigned to distinct cells whose masks allow them.
      // For run sizes <= maxRun (small), do an exact assignment check per combo.
      let allowedPerCell = run.cells.map(() => 0);
      for (const combo of combos) {
        // digits in combo
        const digits = [];
        for (let d = 1; d <= 9; d++) if (combo & (1 << (d - 1))) digits.push(d);
        // can these `len` distinct digits be placed into the cells (each cell's mask
        // must allow its digit)? bipartite matching; len is tiny so brute permute.
        if (assignable(digits, cellMasks)) {
          // mark, per cell, which digits are reachable under SOME valid assignment
          markReachable(digits, cellMasks, allowedPerCell);
        }
      }
      for (let i = 0; i < run.cells.length; i++) {
        const k = run.cells[i];
        const nm = cand.get(k) & allowedPerCell[i];
        if (nm === 0) return false;
        if (nm !== cand.get(k)) { cand.set(k, nm); changed = true; }
      }
    }
    // naked singles: propagate fixed cells into run-mates (no-repeat)
    for (const run of runInfo) {
      for (const k of run.cells) {
        const m = cand.get(k);
        if (popcount(m) === 1) {
          for (const k2 of run.cells) if (k2 !== k && (cand.get(k2) & m)) { cand.set(k2, cand.get(k2) & ~m); changed = true; }
        }
      }
    }
  }
  // solved iff every cell is a single candidate
  for (const m of cand.values()) if (popcount(m) !== 1) return false;
  return true;
}

// can distinct `digits` be placed into cells (cellMasks) one-each, mask-consistent?
function assignable(digits, cellMasks) {
  const n = digits.length;
  const used = new Array(n).fill(false);
  const rec = (di) => {
    if (di === n) return true;
    const bit = 1 << (digits[di] - 1);
    for (let ci = 0; ci < n; ci++) if (!used[ci] && (cellMasks[ci] & bit)) {
      used[ci] = true; if (rec(di + 1)) { used[ci] = false; return true; } used[ci] = false;
    }
    return false;
  };
  return rec(0);
};
// for a consistent combo, OR each cell with digits it could take in some assignment
function markReachable(digits, cellMasks, allowedPerCell) {
  const n = digits.length;
  const used = new Array(n).fill(false);
  const rec = (di) => {
    if (di === n) return true;
    const bit = 1 << (digits[di] - 1);
    let any = false;
    for (let ci = 0; ci < n; ci++) if (!used[ci] && (cellMasks[ci] & bit)) {
      used[ci] = true;
      if (rec(di + 1)) { allowedPerCell[ci] |= bit; any = true; }
      used[ci] = false;
    }
    return any;
  };
  rec(0);
};

/* ── generate one puzzle ── */
const DEBUG = process.argv.includes('--debug');
const dbg = { layoutFail: 0, solveFail: 0, notUnique: 0 };

function generateOne(cfg) {
  const { rows: R, cols: C, maxRun, interiorWallProb } = cfg;
  for (let attempt = 0; attempt < 120; attempt++) {
    const wall = buildLayout(R, C, interiorWallProb, maxRun);
    if (!wall) { dbg.layoutFail++; continue; }
    const runs = runsFromLayout(wall, R, C);
    if (runs.length === 0) { dbg.layoutFail++; continue; }

    const sol = solveOne(R, C, wall, runs);
    if (!sol) { dbg.solveFail++; continue; }

    // derive targets from the solution
    const targets = runs.map(run => run.cells.reduce((s, [r, c]) => s + sol[r][c], 0));

    // uniqueness via logical solvability — a puzzle a human can deduce step-by-step
    // is uniquely solvable by construction (and pleasant to play).
    if (!logicSolvable(R, C, wall, runs, targets)) { dbg.notUnique++; continue; }

    // build output cells
    const cells = [];
    // map run head+type -> sum
    const rightSum = {}, downSum = {};
    runs.forEach((run, ri) => {
      const [hr, hc] = run.head;
      if (run.type === 'a') rightSum[hr * C + hc] = targets[ri];
      else downSum[hr * C + hc] = targets[ri];
    });
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (wall[r][c]) {
        const k = r * C + c;
        cells.push({ t: 'wall', down: downSum[k] ?? null, right: rightSum[k] ?? null });
      } else {
        cells.push({ t: 'cell' });
      }
    }
    const solution = sol.map(row => row.slice());
    return { rows: R, cols: C, cells, solution, createdAt: new Date().toISOString() };
  }
  return null;
}

/* ── bank io (matches suguru) ── */
function loadBank(file) {
  if (!fs.existsSync(file)) return { puzzles: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { puzzles: [] }; }
}
function saveBank(file, bank) { fs.writeFileSync(file, JSON.stringify(bank)); }

function parseCounts() {
  const arg = process.argv.find(a => a.startsWith('--counts='));
  if (arg) { const [e, m, h] = arg.split('=')[1].split(',').map(Number); return { easy: e, medium: m, hard: h }; }
  const idx = process.argv.indexOf('--counts');
  if (idx !== -1 && process.argv[idx + 1]) { const [e, m, h] = process.argv[idx + 1].split(',').map(Number); return { easy: e, medium: m, hard: h }; }
  return DEFAULT_COUNTS;
}

function main() {
  const counts = parseCounts();
  const fresh = process.argv.includes('--fresh');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [diff, cfg] of Object.entries(DIFFICULTIES)) {
    const target = counts[diff];
    if (!target) continue;
    const file = path.join(OUT_DIR, `${diff}.json`);
    const bank = fresh ? { puzzles: [] } : loadBank(file);
    const startCount = bank.puzzles.length;
    process.stdout.write(`\n[${diff}] starting with ${startCount}, generating ${target} more...\n`);

    let generated = 0, failed = 0;
    const t0 = Date.now();
    while (generated < target) {
      const p = generateOne(cfg);
      if (!p) { failed++; if (failed > 200) { console.error(`  too many failures (${failed}), stopping early`); break; } continue; }
      p.id = startCount + generated;
      bank.puzzles.push(p);
      generated++;
      if (generated % 10 === 0 || generated === target) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        process.stdout.write(`  ${generated}/${target} (${elapsed}s)\r`);
      }
    }
    process.stdout.write('\n');
    if (DEBUG) console.log(`  [debug] layoutFail=${dbg.layoutFail} solveFail=${dbg.solveFail} notUnique=${dbg.notUnique}`);
    dbg.layoutFail = dbg.solveFail = dbg.notUnique = 0;
    saveBank(file, bank);
    const sizeKB = (fs.statSync(file).size / 1024).toFixed(1);
    console.log(`  saved ${file} (${bank.puzzles.length} total, ${sizeKB} KB)`);
  }
  console.log('\nDone.');
}

main();
