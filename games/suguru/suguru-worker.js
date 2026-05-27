/* Web Worker — runs puzzle generation off the main thread */

const MAX_CAGE_SIZE = 5;

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

/* ── CAGE GENERATION ── */
function generateCages(rows, cols) {
  const total = rows * cols;
  const assigned = new Array(total).fill(-1);
  const cageList = [];
  const order = shuffle([...Array(total).keys()]);

  for (const start of order) {
    if (assigned[start] !== -1) continue;
    const cageId = cageList.length;
    // Bias toward smaller cages for cleaner puzzles
    const size = 1 + Math.floor(Math.random() * Math.random() * MAX_CAGE_SIZE);
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

  const cageMap = new Array(total);
  for (const cage of cageList) {
    for (const ci of cage.cells) cageMap[ci] = cage.id;
  }
  return { cageList, cageMap };
}

/* ── SOLVER WITH CONSTRAINT PROPAGATION ── */
function buildLookups(rows, cols, cageList, cageMap) {
  // For each cell, precompute the union of 8-neighbors + cage peers
  // (deduplicated) as a flat index array for fast iteration
  const peers = new Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ci = r * cols + c;
      const seen = new Set();
      seen.add(ci);
      for (const [nr, nc] of neighbors8(r, c, rows, cols)) seen.add(nr * cols + nc);
      for (const pc of cageList[cageMap[ci]].cells) seen.add(pc);
      seen.delete(ci);
      peers[ci] = [...seen];
    }
  }
  return peers;
}

function generateSolution(rows, cols, cageList, cageMap) {
  const peers = buildLookups(rows, cols, cageList, cageMap);
  const total = rows * cols;
  const board = new Int8Array(total); // 0 = empty

  // Domain: for each cell, a bitmask of still-possible values (bit k = value k+1)
  // E.g. cage size 3 → initial domain = 0b111 = 7
  const domain = new Int8Array(total);
  for (let ci = 0; ci < total; ci++) {
    domain[ci] = (1 << cageList[cageMap[ci]].size) - 1;
  }

  // Sort cells: smallest domain first (most constrained)
  const order = shuffle([...Array(total).keys()]);
  order.sort((a, b) => cageList[cageMap[a]].size - cageList[cageMap[b]].size);

  function solve(step) {
    if (step === total) return true;
    const ci = order[step];
    const r = Math.floor(ci / cols), c = ci % cols;
    const maxVal = cageList[cageMap[ci]].size;

    // Build available values from domain, in random order
    const avail = [];
    for (let v = 1; v <= maxVal; v++) {
      if (domain[ci] & (1 << (v - 1))) avail.push(v);
    }
    shuffle(avail);

    for (const v of avail) {
      const bit = 1 << (v - 1);
      // Constraint propagation: remove v from all peers' domains
      const affected = [];
      let ok = true;
      for (const pi of peers[ci]) {
        if (domain[pi] & bit) {
          domain[pi] ^= bit;
          affected.push(pi);
          // If a peer's domain is now empty, this branch is dead
          if (domain[pi] === 0 && board[pi] === 0) { ok = false; break; }
        }
      }
      if (ok) {
        board[ci] = v;
        domain[ci] = bit; // lock this cell's domain
        if (solve(step + 1)) return true;
        board[ci] = 0;
        domain[ci] = (1 << maxVal) - 1; // restore
      }
      // Restore peers' domains
      for (const pi of affected) domain[pi] |= bit;
    }
    return false;
  }

  if (!solve(0)) return null;

  // Convert flat array back to 2D
  const result = [];
  for (let r = 0; r < rows; r++) result.push([...board.slice(r * cols, (r + 1) * cols)]);
  return result;
}

/* ── CLUE REMOVAL ── */
function generatePuzzle(sol, clueRatio) {
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

/* ── ENTRY POINT ── */
self.onmessage = function(e) {
  const { diff, rows, cols, clueRatio } = e.data;

  const { cageList, cageMap } = generateCages(rows, cols);
  const solution = generateSolution(rows, cols, cageList, cageMap);
  if (!solution) { self.postMessage({ error: 'generation failed' }); return; }

  const puzzle = generatePuzzle(solution, clueRatio);

  self.postMessage({ solution, puzzle, cageList, cageMap });
};
