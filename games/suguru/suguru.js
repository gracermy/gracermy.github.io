/* ═══════════════════════════════════════════════════
   SUGURU.JS
   Rules:
   - Grid divided into cages; a cage of size N holds 1–N (no repeats).
   - No two identical numbers may touch, even diagonally.
   ═══════════════════════════════════════════════════ */

/* ── CONSTANTS ── */
const DIFFICULTIES = {
  easy:   { label: 'Easy',   rows: 5, cols: 5, dot: 'easy',   clueRatio: 0.45 },
  medium: { label: 'Medium', rows: 7, cols: 7, dot: 'medium', clueRatio: 0.30 },
  hard:   { label: 'Hard',   rows: 7, cols: 7, dot: 'hard',   clueRatio: 0.18 },
};
const COIN_REWARDS = { easy: 4, medium: 8, hard: 14 };
const SAVE_KEY = 'suguru_resume';
const MAX_CAGE_SIZE = 5;

/* ── STATE ── */
let ROWS, COLS;
let solution = [], cageMap = [], cages = [];
let userGrid = [], clueMap = [], candidateGrid = [];
let selectedCell = null;
let paused = false, revealed = false;
let seconds = 0, timerInterval = null;
let undoStack = [], errorCells = new Set();
let pencilMode = false;
let currentDifficulty = 'easy';
let wasPausedBefore = false;

/* ── UTILS ── */
function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function idx(r, c) { return r * COLS + c; }


/* ── PUZZLE BANK (pre-generated, fetched from JSON) ── */
const PLAYED_KEY_PREFIX = 'suguru_played_';
const BANK_VERSION_KEY = 'suguru_bank_version';
const CURRENT_BANK_VERSION = 2; // bump when JSON banks are regenerated
const bankCache = {}; // diff → array of puzzles

// Clear stale played-index lists if the bank has been regenerated.
(function migratePlayedLists() {
  const v = parseInt(localStorage.getItem(BANK_VERSION_KEY) || '0');
  if (v !== CURRENT_BANK_VERSION) {
    for (const diff of ['easy', 'medium', 'hard']) {
      localStorage.removeItem(PLAYED_KEY_PREFIX + diff);
    }
    localStorage.setItem(BANK_VERSION_KEY, String(CURRENT_BANK_VERSION));
  }
})();

async function loadBank(diff) {
  if (bankCache[diff]) return bankCache[diff];
  const res = await fetch(`puzzles/${diff}.json`);
  if (!res.ok) throw new Error(`Failed to load ${diff} bank`);
  const data = await res.json();
  bankCache[diff] = data.puzzles;
  return bankCache[diff];
}

function getPlayedSet(diff) {
  try {
    const raw = localStorage.getItem(PLAYED_KEY_PREFIX + diff);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function markPlayed(diff, index) {
  const set = getPlayedSet(diff);
  set.add(index);
  localStorage.setItem(PLAYED_KEY_PREFIX + diff, JSON.stringify([...set]));
}

function pickNextPuzzle(diff, bank) {
  let played = getPlayedSet(diff);
  // Silent loop: if exhausted, reset and start over
  if (played.size >= bank.length) {
    localStorage.removeItem(PLAYED_KEY_PREFIX + diff);
    played = new Set();
  }
  const unplayed = [];
  for (let i = 0; i < bank.length; i++) if (!played.has(i)) unplayed.push(i);
  return unplayed[Math.floor(Math.random() * unplayed.length)];
}

async function runGeneration(diff, callback) {
  try {
    const bank = await loadBank(diff);
    if (!bank || bank.length === 0) throw new Error(`${diff} bank is empty`);
    const index = pickNextPuzzle(diff, bank);
    markPlayed(diff, index);
    const p = bank[index];
    callback({
      solution: p.solution,
      puzzle: p.puzzle,
      cageList: p.cageList,
      cageMap: p.cageMap,
    });
  } catch (err) {
    console.error('Suguru puzzle load failed:', err);
    document.getElementById('loading').classList.remove('active');
    alert(`Could not load puzzle: ${err.message}\n\nPlease refresh and try again.`);
  }
}

/* ── COIN UI ── */
function updateCoinUI() {
  const c = getCoins();
  document.getElementById('homeCoinCount').textContent = c;
  document.getElementById('gameCoinCount').textContent = c;
}

/* ── SAVE / LOAD ── */
function saveGameState() {
  if (revealed) { clearSavedGame(); return; }
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    difficulty: currentDifficulty,
    rows: ROWS, cols: COLS,
    solution, cageMap, cages,
    userGrid, clueMap, seconds,
    candidates: candidateGrid.map(r => r.map(s => [...s]))
  }));
}

function clearSavedGame() { localStorage.removeItem(SAVE_KEY); }

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    s.candidates = s.candidates.map(r => r.map(arr => new Set(arr)));
    return s;
  } catch { return null; }
}

/* ── DAILY OVERLAY ── */
function renderDailyCalendar(schedule, coinIconSrc) {
  const el = document.getElementById('dailyCalendar');
  if (!el || !schedule) return;
  el.innerHTML = schedule.map(d => {
    const classes = ['daily-day'];
    if (d.claimed) classes.push('claimed');
    if (d.isToday) classes.push('today');
    if (d.special) classes.push('day7');
    return `<div class="${classes.join(' ')}">
      <span class="dd-label">${d.isToday ? 'Today' : `Day ${d.cycleDay}`}</span>
      <span class="dd-reward">${d.reward}<img src="${coinIconSrc}" alt="coins"></span>
    </div>`;
  }).join('');
}

function showDailyOverlay(reward, streak, totalCoins, schedule) {
  const profile = loadProfile();
  document.getElementById('dailyOverlayTitle').textContent =
    profile.totalSolved === 0 ? 'Hello!' : 'Welcome back!';
  document.getElementById('dailyOverlayStreak').textContent =
    streak > 1 ? `🔥 ${streak}-day streak` : '';
  document.getElementById('dailyOverlayBalance').textContent = totalCoins;

  renderDailyCalendar(schedule, '../sudoku/icons/coin.svg');

  const amountEl = document.getElementById('dailyOverlayAmount');
  amountEl.textContent = '0';
  let current = 0;
  const steps = 20, duration = 600, inc = reward / steps;
  const iv = setInterval(() => {
    current = Math.min(current + inc, reward);
    amountEl.textContent = Math.round(current);
    if (current >= reward) clearInterval(iv);
  }, duration / steps);

  document.getElementById('dailyOverlay').classList.add('active');
}

function dismissDailyOverlay() {
  document.getElementById('dailyOverlay').classList.remove('active');
}

/* ── HOME ── */
function buildHome() {
  const el = document.getElementById('diffSelect'); el.innerHTML = '';

  const saved = loadSavedGame();
  const resumeWrap = document.getElementById('resumeWrap');
  if (saved) {
    const cfg = DIFFICULTIES[saved.difficulty];
    resumeWrap.innerHTML = `
      <button class="btn-resume-game" onclick="resumeGame()">
        <div class="resume-left">
          <span class="resume-label">Continue</span>
          <span class="resume-sub">
            <span class="diff-dot ${cfg.dot}" style="display:inline-block;"></span>
            ${cfg.label} · ${fmt(saved.seconds)}
          </span>
        </div>
        <span class="resume-arrow">→</span>
      </button>`;
    resumeWrap.style.display = '';
  } else {
    resumeWrap.innerHTML = '';
    resumeWrap.style.display = 'none';
  }

  for (const [k, cfg] of Object.entries(DIFFICULTIES)) {
    const btn = document.createElement('button'); btn.className = 'diff-btn';
    const best = getBestTime('suguru', k);
    const bs = best ? `<span class="best-badge">Best ${fmt(best)}</span>` : '';
    btn.innerHTML = `<div class="diff-label"><span class="diff-dot ${cfg.dot}"></span>${cfg.label}</div><div>${bs}</div>`;
    btn.onclick = () => startGame(k);
    el.appendChild(btn);
  }

  updateCoinUI();
  const profile = loadProfile();
  const streakEl = document.getElementById('streakBadge');
  if (profile.streak >= 2) {
    streakEl.textContent = `🔥 ${profile.streak}`;
    streakEl.style.display = '';
  } else {
    streakEl.style.display = 'none';
  }
}

/* ── SCREEN HELPERS ── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function cancelAnyModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  if (!revealed) paused = false;
}
function confirmHome() {
  if (revealed) { doGoHome(); return; }
  paused = true;
  document.getElementById('confirmModal').classList.add('active');
}
function doGoHome() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  clearInterval(timerInterval);
  if (!revealed) saveGameState(); else clearSavedGame();
  revealed = false;
  buildHome();
  showScreen('home');
}
function confirmGiveUp() {
  if (revealed) return;
  paused = true;
  document.getElementById('giveUpModal').classList.add('active');
}
function confirmRestart() {
  if (revealed) return;
  paused = true;
  document.getElementById('restartModal').classList.add('active');
}
function doRestart() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  userGrid = clueMap.map((row, r) => row.map((isClue, c) => isClue ? solution[r][c] : 0));
  candidateGrid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => new Set()));
  undoStack = []; errorCells = new Set(); selectedCell = null; revealed = false;
  document.getElementById('picker').classList.remove('visible');
  updateUndoBtn(); buildGrid();
  clearInterval(timerInterval); startTimer();
  setPencilMode(false); clearSavedGame();
}
function doGiveUp() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  clearInterval(timerInterval); revealed = true; paused = true;
  document.getElementById('picker').classList.remove('visible');
  selectedCell = null;
  document.querySelectorAll('.cell').forEach(c =>
    c.classList.remove('selected', 'same-cage', 'same-number', 'error-cell'));

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (clueMap[r][c]) continue;
    const el = getCellEl(r, c);
    el.classList.remove('user-filled', 'has-candidates');
    el.innerHTML = '';
    const uv = userGrid[r][c], sv = solution[r][c];
    el.textContent = sv;
    if (uv === 0) el.classList.add('reveal-filled');
    else if (uv === sv) el.classList.add('reveal-correct');
    else el.classList.add('reveal-wrong');
  }
  clearSavedGame();
}

/* ── GAME START ── */
function startGame(diff) {
  currentDifficulty = diff;
  revealed = false; undoStack = []; errorCells = new Set(); selectedCell = null;
  document.getElementById('loading').classList.add('active');

  runGeneration(diff, ({ solution: sol, puzzle: puz, cageList, cageMap: cm }) => {
    try {
      const cfg = DIFFICULTIES[diff];
      ROWS = cfg.rows; COLS = cfg.cols;
      solution = sol;
      cages = cageList;
      cageMap = cm;

      userGrid = puz.map(r => [...r]);
      clueMap = puz.map(r => r.map(v => v !== 0));
      candidateGrid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => new Set()));

      const tag = document.getElementById('diffTag');
      tag.textContent = cfg.label; tag.className = 'diff-tag ' + diff;

      buildGrid();
      document.getElementById('loading').classList.remove('active');
      showScreen('game');
      startTimer(); updateCoinUI();
      document.getElementById('picker').classList.remove('visible');
      document.getElementById('pauseOverlay').classList.remove('active');
      document.getElementById('pauseIcon').src = '../sudoku/icons/pause.svg';
      setPencilMode(false);
      updateUndoBtn();
      clearSavedGame();
    } catch (err) {
      console.error('Suguru render failed:', err);
      document.getElementById('loading').classList.remove('active');
      alert(`Could not render puzzle: ${err.message}`);
    }
  });
}

function resumeGame() {
  const saved = loadSavedGame();
  if (!saved) return;
  currentDifficulty = saved.difficulty;
  ROWS = saved.rows; COLS = saved.cols;
  solution = saved.solution;
  cageMap = saved.cageMap;
  cages = saved.cages;
  userGrid = saved.userGrid;
  clueMap = saved.clueMap;
  candidateGrid = saved.candidates;
  seconds = saved.seconds;
  revealed = false; paused = false; undoStack = []; errorCells = new Set(); selectedCell = null;

  const cfg = DIFFICULTIES[currentDifficulty];
  const tag = document.getElementById('diffTag');
  tag.textContent = cfg.label; tag.className = 'diff-tag ' + currentDifficulty;

  buildGrid();
  showScreen('game');
  clearInterval(timerInterval); updateTimer();
  timerInterval = setInterval(() => { if (!paused) { seconds++; updateTimer(); } }, 1000);
  updateCoinUI();
  document.getElementById('picker').classList.remove('visible');
  document.getElementById('pauseOverlay').classList.remove('active');
  document.getElementById('pauseIcon').src = '../sudoku/icons/pause.svg';
  setPencilMode(false); updateUndoBtn();
  pencilMode = false;
}

/* ── GRID RENDER ── */
function buildGrid() {
  const g = document.getElementById('grid');
  g.innerHTML = '';
  g.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  g.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.row = r; d.dataset.col = c;
    d.dataset.cage = cageMap[idx(r, c)];

    // Cage boundary borders
    applyBorderClasses(d, r, c);

    if (clueMap[r][c]) {
      d.classList.add('clue');
      d.textContent = solution[r][c];
    } else {
      renderCell(r, c, d);
    }
    d.addEventListener('click', () => selectCell(r, c));
    g.appendChild(d);
  }

  // Build picker based on largest cage
  const maxSize = Math.max(...cages.map(cg => cg.size));
  buildPicker(maxSize);
}

function applyBorderClasses(el, r, c) {
  const myId = cageMap[idx(r, c)];
  if (r === 0 || cageMap[idx(r-1, c)] !== myId) el.classList.add('border-top');
  if (c === COLS-1 || cageMap[idx(r, c+1)] !== myId) el.classList.add('border-right');
  if (r === ROWS-1 || cageMap[idx(r+1, c)] !== myId) el.classList.add('border-bottom');
  if (c === 0 || cageMap[idx(r, c-1)] !== myId) el.classList.add('border-left');
}

function renderCell(r, c, el) {
  el = el || getCellEl(r, c);
  if (clueMap[r][c]) return;
  const val = userGrid[r][c];
  const cands = candidateGrid[r][c];

  el.classList.remove('has-candidates', 'user-filled', 'reveal-correct', 'reveal-wrong', 'reveal-filled');
  el.innerHTML = '';

  if (val !== 0) {
    el.textContent = val;
    if (!el.classList.contains('error-cell')) el.classList.add('user-filled');
  } else if (cands.size > 0) {
    el.classList.add('has-candidates');
    const cageSize = cages[cageMap[idx(r, c)]].size;
    const grid = document.createElement('div');
    grid.className = 'candidates-grid';
    // Layout: up to 3 columns
    const cols = Math.min(cageSize, 3);
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let n = 1; n <= cageSize; n++) {
      const sp = document.createElement('span');
      sp.className = 'cand-num';
      sp.textContent = cands.has(n) ? n : '';
      grid.appendChild(sp);
    }
    el.appendChild(grid);
  }
}

function getCellEl(r, c) {
  return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
}

/* ── PICKER ── */
function buildPicker(maxSize) {
  const digitsEl = document.getElementById('pickerDigits');
  digitsEl.innerHTML = '';
  digitsEl.style.gridTemplateColumns = `repeat(${Math.min(maxSize, 5)}, 1fr)`;
  for (let n = 1; n <= maxSize; n++) {
    const btn = document.createElement('button');
    btn.className = 'num-btn'; btn.textContent = n;
    btn.dataset.num = n;
    btn.addEventListener('click', () => placeNumber(n));
    digitsEl.appendChild(btn);
  }
}

function updatePickerForCell(r, c) {
  const cageId = cageMap[idx(r, c)];
  const cage = cages[cageId];
  const cageSize = cage.size;
  const autoDisable = getSetting('suguru', 'autoDisable');

  // Pencil mode: always free input (any valid-size digit is allowed).
  // Answer mode + autoDisable OFF: also free.
  // Answer mode + autoDisable ON: dim cage peers + 8-dir neighbours.
  const blocked = new Set();
  if (!pencilMode && autoDisable) {
    // Values already used in this cage (excluding the selected cell itself)
    for (const ci of cage.cells) {
      const cr = Math.floor(ci / COLS), cc = ci % COLS;
      if (cr === r && cc === c) continue;
      const v = clueMap[cr][cc] ? solution[cr][cc] : userGrid[cr][cc];
      if (v !== 0) blocked.add(v);
    }
    // Values held by any 8-directional neighbour (no-touch rule)
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const v = clueMap[nr][nc] ? solution[nr][nc] : userGrid[nr][nc];
      if (v !== 0) blocked.add(v);
    }
  }

  document.querySelectorAll('#pickerDigits .num-btn').forEach(btn => {
    const n = parseInt(btn.dataset.num);
    btn.classList.toggle('dimmed', n > cageSize || blocked.has(n));
  });
}

/* ── SELECTION ── */
function selectCell(r, c) {
  if (paused || revealed) return;
  document.querySelectorAll('.cell').forEach(cell =>
    cell.classList.remove('selected', 'same-cage', 'same-number'));

  const el = getCellEl(r, c);
  el.classList.add('selected');

  // Highlight same cage
  const myId = cageMap[idx(r, c)];
  for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
    if (rr === r && cc === c) continue;
    if (cageMap[idx(rr, cc)] === myId) getCellEl(rr, cc).classList.add('same-cage');
  }

  // Highlight same number
  const val = userGrid[r][c] || (clueMap[r][c] ? solution[r][c] : 0);
  if (val !== 0) {
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
      const v = clueMap[rr][cc] ? solution[rr][cc] : userGrid[rr][cc];
      if (v === val && !(rr === r && cc === c)) getCellEl(rr, cc).classList.add('same-number');
    }
  }

  if (clueMap[r][c]) {
    selectedCell = null;
    document.getElementById('picker').classList.remove('visible');
  } else {
    selectedCell = { row: r, col: c };
    updatePickerForCell(r, c);
    document.getElementById('picker').classList.add('visible');
  }
}

/* ── PENCIL MODE ── */
function setPencilMode(on) {
  pencilMode = on;
  document.getElementById('btnPencil').classList.toggle('pencil-active', on);
  // Picker dim rules differ between pencil and answer mode — refresh.
  if (selectedCell) updatePickerForCell(selectedCell.row, selectedCell.col);
}
function togglePencilMode() { setPencilMode(!pencilMode); }

/* ── PLACE NUMBER ── */
function placeNumber(num) {
  if (!selectedCell || paused || revealed) return;
  const { row, col } = selectedCell;
  if (clueMap[row][col]) return;

  undoStack.push({
    row, col,
    prevVal: userGrid[row][col],
    prevCandidates: new Set(candidateGrid[row][col]),
    cagePencilChanges: []   // [{r, c, hadNum}] for cage peers that had `num` stripped
  });
  updateUndoBtn();

  if (pencilMode) {
    if (num === 0) {
      candidateGrid[row][col].clear();
    } else {
      if (userGrid[row][col] !== 0) { undoStack.pop(); updateUndoBtn(); return; }
      if (candidateGrid[row][col].has(num)) candidateGrid[row][col].delete(num);
      else candidateGrid[row][col].add(num);
    }
    renderCell(row, col);
    return;
  }

  if (userGrid[row][col] === num) { undoStack.pop(); updateUndoBtn(); return; }
  userGrid[row][col] = num;
  const el = getCellEl(row, col);
  el.classList.remove('error-cell'); errorCells.delete(`${row},${col}`);
  if (num !== 0) candidateGrid[row][col].clear();
  renderCell(row, col);

  // Auto-clean pencil candidates: if user placed a real number, remove that
  // number from pencil candidates of any cell where it could no longer be
  // valid — same-cage peers AND all 8-directional neighbours (no-touch rule).
  if (num !== 0) {
    const undoEntry = undoStack[undoStack.length - 1];
    const visited = new Set();
    const affected = [];

    // Same-cage cells
    const cageId = cageMap[idx(row, col)];
    for (const ci of cages[cageId].cells) {
      const cr = Math.floor(ci / COLS), cc = ci % COLS;
      if (cr === row && cc === col) continue;
      const key = cr * COLS + cc;
      if (!visited.has(key)) { visited.add(key); affected.push([cr, cc]); }
    }

    // 8-directional neighbours
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const key = nr * COLS + nc;
      if (!visited.has(key)) { visited.add(key); affected.push([nr, nc]); }
    }

    for (const [cr, cc] of affected) {
      if (candidateGrid[cr][cc].has(num)) {
        candidateGrid[cr][cc].delete(num);
        undoEntry.cagePencilChanges.push({ r: cr, c: cc, num });
        renderCell(cr, cc);
      }
    }
  }

  // Refresh same-number highlights
  document.querySelectorAll('.cell').forEach(c => c.classList.remove('same-number'));
  if (num !== 0) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = clueMap[r][c] ? solution[r][c] : userGrid[r][c];
      if (v === num && !(r === row && c === col)) getCellEl(r, c).classList.add('same-number');
    }
  }

  // Refresh picker so just-used values get dimmed (or re-enabled on erase)
  updatePickerForCell(row, col);

  // Auto-check when grid is full
  let allFilled = true;
  for (let r = 0; r < ROWS && allFilled; r++)
    for (let c = 0; c < COLS && allFilled; c++)
      if (!clueMap[r][c] && userGrid[r][c] === 0) allFilled = false;
  if (allFilled) checkSolution();
}

/* ── UNDO ── */
function undoMove() {
  if (undoStack.length === 0 || paused || revealed) return;
  const m = undoStack.pop();
  userGrid[m.row][m.col] = m.prevVal;
  candidateGrid[m.row][m.col] = m.prevCandidates;
  errorCells.delete(`${m.row},${m.col}`);
  renderCell(m.row, m.col);

  // Restore any cage-peer pencil candidates that were auto-stripped
  if (m.cagePencilChanges) {
    for (const change of m.cagePencilChanges) {
      candidateGrid[change.r][change.c].add(change.num);
      renderCell(change.r, change.c);
    }
  }

  updateUndoBtn();
  selectCell(m.row, m.col);
}
function updateUndoBtn() {
  document.getElementById('btnUndo').disabled = undoStack.length === 0;
}

/* ── TIMER ── */
function startTimer() {
  seconds = 0; paused = false;
  clearInterval(timerInterval); updateTimer();
  timerInterval = setInterval(() => { if (!paused) { seconds++; updateTimer(); } }, 1000);
}
function updateTimer() {
  document.getElementById('timer').textContent = fmt(seconds);
}
function togglePause() {
  if (revealed) return;
  paused = !paused;
  document.getElementById('pauseOverlay').classList.toggle('active', paused);
  document.querySelectorAll('.cell').forEach(c => c.classList.toggle('hidden-cell', paused));
  document.getElementById('pauseIcon').src = paused
    ? '../sudoku/icons/play.svg'
    : '../sudoku/icons/pause.svg';
  if (paused) {
    document.getElementById('picker').classList.remove('visible');
    selectedCell = null;
    document.querySelectorAll('.cell').forEach(c =>
      c.classList.remove('selected', 'same-cage', 'same-number'));
  }
}

/* ── CHECK SOLUTION ── */
function checkSolution() {
  if (paused || revealed) return;
  errorCells.forEach(k => {
    const [r, c] = k.split(',').map(Number);
    const el = getCellEl(r, c);
    if (el) el.classList.remove('error-cell');
  });
  errorCells = new Set();

  let hasErr = false;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (clueMap[r][c]) continue;
    if (userGrid[r][c] !== solution[r][c]) {
      hasErr = true;
      errorCells.add(`${r},${c}`);
      getCellEl(r, c).classList.add('error-cell');
    }
  }
  if (hasErr) return;

  clearInterval(timerInterval);
  revealed = true;
  clearSavedGame();
  showModal('success');
}

/* ── WIN MODAL ── */
function showModal(type) {
  const modal = document.getElementById('modal');
  const icon = document.getElementById('modal-icon');
  const title = document.getElementById('modal-title');
  const text = document.getElementById('modal-text');
  const bestEl = document.getElementById('modal-best');
  const actions = document.getElementById('modal-actions');
  bestEl.style.display = 'none'; actions.innerHTML = '';

  if (type === 'success') {
    const timerOn = loadSettings('suguru').showTimer;
    const isNew = timerOn ? submitBestTime('suguru', currentDifficulty, seconds) : false;
    if (!timerOn) {
      const profile = loadProfile();
      profile.totalSolved = (profile.totalSolved || 0) + 1;
      saveProfile(profile);
    }
    const reward = COIN_REWARDS[currentDifficulty] || 4;
    addCoins(reward);
    icon.textContent = '✦'; icon.style.color = 'var(--pink)';
    title.textContent = 'Brilliant!';
    text.textContent = timerOn ? `Solved in ${fmt(seconds)}.` : 'Solved!';
    bestEl.style.display = 'block';
    bestEl.innerHTML = `
      <div class="coin-reward-row">
        <span class="coin-earned-label">+<span id="coinCountUp">0</span>
        <img src="../sudoku/icons/coin.svg" class="coin-icon-img coin-icon-lg" alt="coins"> earned</span>
      </div>
      ${isNew ? '<div class="new-best-line">★ New best time!</div>' : ''}`;
    actions.innerHTML = `
      <button class="btn-primary" onclick="closeModal();startGame('${currentDifficulty}')">Play Again</button>
      <button class="btn-secondary" onclick="closeModal();doGoHome()">Home</button>`;
    let cur = 0;
    const steps = 20, duration = 700, inc = reward / steps;
    const countEl = document.getElementById('coinCountUp');
    const iv = setInterval(() => {
      cur = Math.min(cur + inc, reward);
      countEl.textContent = Math.round(cur);
      if (cur >= reward) { clearInterval(iv); updateCoinUI(); }
    }, duration / steps);
  }
  modal.classList.add('active');
}
function closeModal() { document.getElementById('modal').classList.remove('active'); }

/* ── TUTORIAL ── */
const TUT_TOTAL = 5;
let tutSlide = 0;

function buildTutVisuals() {
  // Slide 1: cage overview — small 4×4 sample
  const sampleCages = [0,0,1,1, 0,2,1,3, 2,2,3,3, 2,4,4,3];
  const sampleSol =   [1,2,1,2, 3,1,3,1, 2,3,2,3, 1,2,1,2];
  const v1 = document.getElementById('tutVis1');
  let h = '<div class="tut-grid" style="display:grid;grid-template-columns:repeat(4,32px);grid-template-rows:repeat(4,32px);gap:0;">';
  const colors = ['rgba(96,165,250,0.25)','rgba(244,114,182,0.25)','rgba(52,211,153,0.25)','rgba(251,191,36,0.25)','rgba(167,139,250,0.25)'];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(i/4), c = i%4;
    const cid = sampleCages[i];
    const borders = [];
    if (r===0||sampleCages[i-4]!==cid) borders.push('border-top:2px solid rgba(255,255,255,0.5)');
    if (c===3||sampleCages[i+1]!==cid) borders.push('border-right:2px solid rgba(255,255,255,0.5)');
    if (r===3||sampleCages[i+4]!==cid) borders.push('border-bottom:2px solid rgba(255,255,255,0.5)');
    if (c===0||sampleCages[i-1]!==cid) borders.push('border-left:2px solid rgba(255,255,255,0.5)');
    h += `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;font-size:0.7rem;font-weight:700;color:rgba(255,255,255,0.9);background:${colors[cid]};border:1px solid rgba(255,255,255,0.05);${borders.join(';')}">${sampleSol[i]}</div>`;
  }
  v1.innerHTML = h + '</div>';

  // Slide 2: no-touch — show two 5s that can't be adjacent
  const v2 = document.getElementById('tutVis2');
  const grid2 = [0,0,0,0, 5,0,0,0, 0,0,5,0, 0,0,0,0];
  let h2 = '<div style="display:grid;grid-template-columns:repeat(4,32px);grid-template-rows:repeat(4,32px);gap:2px;">';
  for (let i = 0; i < 16; i++) {
    const v = grid2[i];
    const isNum = v !== 0;
    h2 += `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;font-size:0.75rem;font-weight:700;background:rgba(255,255,255,0.04);border-radius:4px;border:1px solid rgba(255,255,255,0.06);color:${isNum?'var(--error)':'transparent'};">${v||'·'}</div>`;
  }
  // Mark the 8 neighbours around the first 5 (index 4, row1 col0)
  v2.innerHTML = h2 + '</div><div style="font-size:0.72rem;color:var(--text-dim);margin-top:8px;text-align:center;">Same number cannot touch — even diagonally</div>';

  // Slide 3: picking — show the picker UI mockup
  const v3 = document.getElementById('tutVis3');
  v3.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:140px;">
        ${[1,2,3].map(n=>`<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1.5px solid rgba(244,114,182,0.3);background:rgba(255,255,255,0.04);font-family:JetBrains Mono,monospace;font-size:1rem;font-weight:700;color:var(--text);">${n}</div>`).join('')}
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);">Cage size 3 → only 1, 2, 3 are valid</div>
    </div>`;

  // Slide 4: elimination
  const v4 = document.getElementById('tutVis4');
  v4.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <div style="display:flex;gap:4px;">
        ${['1','2','?'].map((n,i)=>`<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1.5px solid ${i<2?'rgba(52,211,153,0.4)':'rgba(244,114,182,0.5)'};background:${i<2?'rgba(52,211,153,0.08)':'rgba(244,114,182,0.08)'};font-family:JetBrains Mono,monospace;font-size:0.9rem;font-weight:700;color:${i<2?'var(--success)':'var(--pink)'};">${n}</div>`).join('')}
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Cage has 1 and 2 — the last cell must be 3</div>
    </div>`;

  // Slide 5: errors turn pink
  const v5 = document.getElementById('tutVis5');
  v5.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <div style="display:flex;gap:4px;">
        ${[{v:3,ok:true},{v:1,ok:true},{v:2,ok:false},{v:3,ok:true}].map(({v,ok})=>`<div style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1.5px solid ${ok?'rgba(255,255,255,0.08)':'rgba(251,113,133,0.5)'};background:${ok?'rgba(255,255,255,0.04)':'rgba(251,113,133,0.08)'};font-family:JetBrains Mono,monospace;font-size:0.9rem;font-weight:700;color:${ok?'var(--text)':'var(--error)'};">${v}</div>`).join('')}
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Wrong cells turn pink when the board is full — fix them!</div>
    </div>`;
}

function buildTutDots() {
  const d = document.getElementById('tutDots'); d.innerHTML = '';
  for (let i = 0; i < TUT_TOTAL; i++)
    d.innerHTML += `<div class="tut-dot${i===0?' active':''}" data-i="${i}"></div>`;
}

function tutNav(dir) {
  tutSlide += dir;
  if (tutSlide >= TUT_TOTAL) { closeTutorial(); return; }
  if (tutSlide < 0) tutSlide = 0;
  updateTutSlide();
}

function updateTutSlide() {
  document.querySelectorAll('.tut-slide').forEach((s, i) => s.classList.toggle('active', i === tutSlide));
  document.querySelectorAll('.tut-dot').forEach((d, i) => d.classList.toggle('active', i === tutSlide));
  document.getElementById('tutCounter').textContent = `${tutSlide+1} / ${TUT_TOTAL}`;
  document.getElementById('tutPrev').style.visibility = tutSlide === 0 ? 'hidden' : 'visible';
  document.getElementById('tutNext').textContent = tutSlide === TUT_TOTAL - 1 ? 'Got it' : 'Next';
}

function openTutorial() {
  wasPausedBefore = paused;
  if (!paused && document.getElementById('game').classList.contains('active')) paused = true;
  tutSlide = 0; updateTutSlide();
  document.getElementById('tutorial').classList.add('active');
}
function closeTutorial() {
  document.getElementById('tutorial').classList.remove('active');
  if (!wasPausedBefore && document.getElementById('game').classList.contains('active')) paused = false;
}

/* ── SETTINGS ── */
function openSettings() {
  const s = loadSettings('suguru');
  document.getElementById('setAutoDisable').checked = s.autoDisable;
  document.getElementById('setShowTimer').checked = s.showTimer;
  document.getElementById('settingsModal').classList.add('active');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}
function onSettingChange(key, value) {
  setSetting('suguru', key, value);
  applySettings();
}
function applySettings() {
  const s = loadSettings('suguru');
  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.style.display = s.showTimer ? '' : 'none';
  if (selectedCell) updatePickerForCell(selectedCell.row, selectedCell.col);
}

/* ── HINT SHOP ── */
const HINT_COST_RANDOM = 2;
const HINT_COST_CHOSEN = 5;
let hintWasPausedBefore = false;

function openHintShop() {
  if (revealed) return;
  hintWasPausedBefore = paused;
  document.getElementById('hintModalCoins').textContent = getCoins();
  const hasSelected = selectedCell && !clueMap[selectedCell.row][selectedCell.col];
  const canAffordRandom = getCoins() >= HINT_COST_RANDOM;
  const canAffordChosen = getCoins() >= HINT_COST_CHOSEN;
  document.getElementById('hintRandom').disabled = !canAffordRandom;
  document.getElementById('hintChosen').disabled = !canAffordChosen || !hasSelected;
  const chosenDesc = document.getElementById('hintChosen').querySelector('.hint-option-desc');
  chosenDesc.textContent = hasSelected
    ? 'Reveals the cell you have selected.'
    : 'Select an empty cell first, then come back.';
  paused = true;
  document.getElementById('hintModal').classList.add('active');
}
function closeHintShop() {
  document.getElementById('hintModal').classList.remove('active');
  paused = hintWasPausedBefore;
}
function revealCell(row, col) {
  const val = solution[row][col];
  userGrid[row][col] = val;
  candidateGrid[row][col].clear();
  const el = getCellEl(row, col);
  el.classList.remove('user-filled', 'error-cell', 'has-candidates');
  el.innerHTML = '';
  el.textContent = val;
  el.classList.add('hint-revealed');
  errorCells.delete(`${row},${col}`);
  updateCoinUI();
}
function useRandomHint() {
  if (!spendCoins(HINT_COST_RANDOM)) return;
  closeHintShop();
  const empty = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!clueMap[r][c] && userGrid[r][c] === 0) empty.push([r, c]);
  }
  if (empty.length === 0) return;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  revealCell(r, c); selectCell(r, c);
  // After hint, check if grid is full
  let allFilled = true;
  for (let rr = 0; rr < ROWS && allFilled; rr++)
    for (let cc = 0; cc < COLS && allFilled; cc++)
      if (!clueMap[rr][cc] && userGrid[rr][cc] === 0) allFilled = false;
  if (allFilled) checkSolution();
}
function useChosenHint() {
  if (!selectedCell) return;
  if (clueMap[selectedCell.row][selectedCell.col]) return;
  if (!spendCoins(HINT_COST_CHOSEN)) return;
  closeHintShop();
  const { row, col } = selectedCell;
  revealCell(row, col); selectCell(row, col);
  let allFilled = true;
  for (let rr = 0; rr < ROWS && allFilled; rr++)
    for (let cc = 0; cc < COLS && allFilled; cc++)
      if (!clueMap[rr][cc] && userGrid[rr][cc] === 0) allFilled = false;
  if (allFilled) checkSolution();
}

/* ── KEYBOARD ── */
document.addEventListener('keydown', e => {
  if (paused || revealed) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoMove(); return; }
  if (e.key === 'p' || e.key === 'P') { togglePencilMode(); return; }
  if (!selectedCell) return;
  const n = parseInt(e.key);
  if (n >= 1 && n <= MAX_CAGE_SIZE) placeNumber(n);
  if (e.key === 'Backspace' || e.key === 'Delete') placeNumber(0);
  // Arrow-key navigation
  const { row, col } = selectedCell;
  if (e.key === 'ArrowUp'    && row > 0)      { e.preventDefault(); selectCell(row-1, col); }
  if (e.key === 'ArrowDown'  && row < ROWS-1) { e.preventDefault(); selectCell(row+1, col); }
  if (e.key === 'ArrowLeft'  && col > 0)      { e.preventDefault(); selectCell(row, col-1); }
  if (e.key === 'ArrowRight' && col < COLS-1) { e.preventDefault(); selectCell(row, col+1); }
});

/* ── INIT ── */
buildHome();
buildTutDots();
buildTutVisuals();
updateTutSlide();
applySettings();

const daily = claimDailyReward();
if (daily.awarded) {
  updateCoinUI();
  showDailyOverlay(daily.reward, daily.streak, daily.coins, daily.schedule);
}
