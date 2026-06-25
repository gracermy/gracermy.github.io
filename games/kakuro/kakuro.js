/* ═══════════════════════════════════════════════════
   KAKURO.JS  (Crossum)
   Fill white cells with digits 1–9 so each run's cells are distinct and sum to
   the clue. Some white cells are pre-filled GIVENS (locked). Cell model:
     wall  cell → black, may carry {down, right} clue sums
     white cell → fillable; may be a GIVEN (fixed digit, not editable)
   Win when every white cell matches the solution.
   Structure adapted from suguru.js (Nettle); shares profile.js + icons.
   ═══════════════════════════════════════════════════ */

/* ── CONSTANTS ── */
const DIFFICULTIES = {
  easy:   { label: 'Easy',   dot: 'easy'   },
  medium: { label: 'Medium', dot: 'medium' },
  hard:   { label: 'Hard',   dot: 'hard'   },
};
const COIN_REWARDS = { easy: 4, medium: 8, hard: 14 };
const SAVE_KEY = 'kakuro_resume';
const MAX_DIGIT = 9;

/* ── STATE ── */
let ROWS, COLS;
let cells = [];           // flat array of {t:'wall',down,right} | {t:'cell',given?}
let solution = [];        // ROWS×COLS, 0 on walls, digit on white
let wallMap = [];         // ROWS×COLS bool, true = wall
let givenMap = [];        // ROWS×COLS, given digit or 0
let userGrid = [];        // ROWS×COLS, user's digit (0 empty) — givens pre-filled
let candidateGrid = [];   // ROWS×COLS of Set
let runsByCell = [];      // ROWS×COLS → array of run objects this cell belongs to
let allRuns = [];         // {cells:[[r,c]...], type:'a'|'d', sum, head:[r,c]}
let selectedCell = null;
let paused = false, revealed = false;
let seconds = 0, timerInterval = null;
let undoStack = [];
let errorCells = new Set();
let currentDifficulty = 'easy';
let pencilMode = false;
let wasPausedBefore = false;

/* ── UTILS ── */
function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function idx(r, c) { return r * COLS + c; }
function getCellEl(r, c) { return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`); }

/* ── PUZZLE BANK (pre-generated, fetched from JSON) ── */
const PLAYED_KEY_PREFIX = 'kakuro_played_';
const BANK_VERSION_KEY = 'kakuro_bank_version';
const CURRENT_BANK_VERSION = 1; // bump when JSON banks are regenerated
const bankCache = {};

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
    callback(bank[index]);
  } catch (err) {
    console.error('Crossum puzzle load failed:', err);
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

/* ── RUN STRUCTURE (derived from cells) ── */
function buildRuns() {
  allRuns = [];
  runsByCell = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => []));
  const isW = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS && !wallMap[r][c];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!wallMap[r][c]) continue;
    if (isW(r, c + 1)) {
      const cs = []; let cc = c + 1; while (isW(r, cc)) { cs.push([r, cc]); cc++; }
      if (cs.length >= 2) {   // length-1 "runs" carry no clue sum; skip (match generator)
        const cell = cells[idx(r, c)];
        const run = { cells: cs, type: 'a', sum: cell.right, head: [r, c] };
        allRuns.push(run); cs.forEach(([rr, ccc]) => runsByCell[rr][ccc].push(run));
      }
    }
    if (isW(r + 1, c)) {
      const cs = []; let rr = r + 1; while (isW(rr, c)) { cs.push([rr, c]); rr++; }
      if (cs.length >= 2) {
        const cell = cells[idx(r, c)];
        const run = { cells: cs, type: 'd', sum: cell.down, head: [r, c] };
        allRuns.push(run); cs.forEach(([rr2, cc2]) => runsByCell[rr2][cc2].push(run));
      }
    }
  }
}

/* ── SAVE / LOAD ── */
function saveGameState() {
  if (revealed) { clearSavedGame(); return; }
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    difficulty: currentDifficulty,
    rows: ROWS, cols: COLS, cells,
    solution, userGrid, seconds,
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
    const best = getBestTime('kakuro', k);
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
  // reset user grid to givens only
  userGrid = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => givenMap[r][c] || 0));
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
    c.classList.remove('selected', 'run-highlight', 'error-cell'));

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (wallMap[r][c] || givenMap[r][c]) continue;
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
function loadPuzzleIntoState(p) {
  ROWS = p.rows; COLS = p.cols; cells = p.cells;
  solution = p.solution.map(row => row.slice());
  wallMap = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => cells[idx(r, c)].t === 'wall'));
  givenMap = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => {
    const cell = cells[idx(r, c)];
    return (cell.t === 'cell' && cell.given) ? cell.given : 0;
  }));
  buildRuns();
}

function startGame(diff) {
  currentDifficulty = diff;
  revealed = false; undoStack = []; errorCells = new Set(); selectedCell = null;
  document.getElementById('loading').classList.add('active');

  runGeneration(diff, (p) => {
    try {
      loadPuzzleIntoState(p);
      userGrid = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => givenMap[r][c] || 0));
      candidateGrid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => new Set()));

      const cfg = DIFFICULTIES[diff];
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
      console.error('Crossum render failed:', err);
      document.getElementById('loading').classList.remove('active');
      alert(`Could not render puzzle: ${err.message}`);
    }
  });
}

function resumeGame() {
  const saved = loadSavedGame();
  if (!saved) return;
  currentDifficulty = saved.difficulty;
  loadPuzzleIntoState({ rows: saved.rows, cols: saved.cols, cells: saved.cells, solution: saved.solution });
  userGrid = saved.userGrid;
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
}

/* ── GRID RENDER ── */
function buildGrid() {
  const g = document.getElementById('grid');
  g.innerHTML = '';
  g.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
  g.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = document.createElement('div');
    d.dataset.row = r; d.dataset.col = c;

    if (wallMap[r][c]) {
      d.className = 'cell wall';
      const cell = cells[idx(r, c)];
      if (cell.down != null || cell.right != null) {
        d.classList.add('has-clue');
        if (cell.down != null) {
          const s = document.createElement('span'); s.className = 'clue-sum down'; s.textContent = cell.down; d.appendChild(s);
        }
        if (cell.right != null) {
          const s = document.createElement('span'); s.className = 'clue-sum right'; s.textContent = cell.right; d.appendChild(s);
        }
      }
    } else {
      d.className = 'cell white';
      renderCell(r, c, d);
      d.addEventListener('click', () => selectCell(r, c));
    }
    g.appendChild(d);
  }
  buildPicker();
}

function renderCell(r, c, el) {
  el = el || getCellEl(r, c);
  if (wallMap[r][c]) return;
  const val = userGrid[r][c];
  const cands = candidateGrid[r][c];
  const isGiven = givenMap[r][c] !== 0;

  el.classList.remove('has-candidates', 'user-filled', 'given', 'reveal-correct', 'reveal-wrong', 'reveal-filled');
  el.innerHTML = '';

  if (isGiven) {
    el.textContent = givenMap[r][c];
    el.classList.add('given');
    return;
  }
  if (val !== 0) {
    el.textContent = val;
    if (!el.classList.contains('error-cell')) el.classList.add('user-filled');
  } else if (cands.size > 0) {
    el.classList.add('has-candidates');
    const grid = document.createElement('div');
    grid.className = 'candidates-grid';
    for (let n = 1; n <= 9; n++) {
      const sp = document.createElement('span');
      sp.className = 'cand-num';
      sp.textContent = cands.has(n) ? n : '';
      grid.appendChild(sp);
    }
    el.appendChild(grid);
  }
}

/* ── PICKER ── */
function buildPicker() {
  const digitsEl = document.getElementById('pickerDigits');
  digitsEl.innerHTML = '';
  digitsEl.style.gridTemplateColumns = `repeat(9, 1fr)`;
  for (let n = 1; n <= 9; n++) {
    const btn = document.createElement('button');
    btn.className = 'num-btn'; btn.textContent = n;
    btn.dataset.num = n;
    btn.addEventListener('click', () => placeNumber(n));
    digitsEl.appendChild(btn);
  }
}

// Dim digits that can't legally go in the selected cell (used in its runs, or no
// run combination allows it). Gated on the "highlight/auto-disable" setting.
function updatePickerForCell(r, c) {
  const autoDisable = getSetting('kakuro', 'autoDisable');
  const blocked = new Set();
  if (!pencilMode && autoDisable) {
    for (const run of runsByCell[r][c]) {
      for (const [rr, cc] of run.cells) {
        if (rr === r && cc === c) continue;
        const v = userGrid[rr][cc];
        if (v !== 0) blocked.add(v);
      }
    }
  }
  document.querySelectorAll('#pickerDigits .num-btn').forEach(btn => {
    const n = parseInt(btn.dataset.num);
    btn.classList.toggle('dimmed', blocked.has(n));
  });
}

/* ── SELECTION ── */
function selectCell(r, c) {
  if (paused || revealed || wallMap[r][c]) return;
  document.querySelectorAll('.cell').forEach(cell =>
    cell.classList.remove('selected', 'run-highlight', 'same-number'));

  const el = getCellEl(r, c);

  // Highlight this cell's across-run and down-run
  for (const run of runsByCell[r][c]) {
    for (const [rr, cc] of run.cells) {
      if (rr === r && cc === c) continue;
      getCellEl(rr, cc).classList.add('run-highlight');
    }
  }
  el.classList.add('selected');

  // Highlight same number across the board
  const val = userGrid[r][c];
  if (val !== 0) {
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
      if (wallMap[rr][cc]) continue;
      if (userGrid[rr][cc] === val && !(rr === r && cc === c)) getCellEl(rr, cc).classList.add('same-number');
    }
  }

  // Given cells: select+highlight but no picker (not editable)
  if (givenMap[r][c]) {
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
  if (selectedCell) updatePickerForCell(selectedCell.row, selectedCell.col);
}
function togglePencilMode() { setPencilMode(!pencilMode); }

/* ── PLACE NUMBER ── */
function placeNumber(num) {
  if (!selectedCell || paused || revealed) return;
  const { row, col } = selectedCell;
  if (wallMap[row][col] || givenMap[row][col]) return;

  undoStack.push({
    row, col,
    prevVal: userGrid[row][col],
    prevCandidates: new Set(candidateGrid[row][col]),
    peerPencilChanges: []
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

  // Auto-clean pencil candidates: remove `num` from run-mates' candidates
  if (num !== 0) {
    const undoEntry = undoStack[undoStack.length - 1];
    const visited = new Set();
    for (const run of runsByCell[row][col]) {
      for (const [rr, cc] of run.cells) {
        if (rr === row && cc === col) continue;
        const key = rr * COLS + cc;
        if (visited.has(key)) continue; visited.add(key);
        if (candidateGrid[rr][cc].has(num)) {
          candidateGrid[rr][cc].delete(num);
          undoEntry.peerPencilChanges.push({ r: rr, c: cc, num });
          renderCell(rr, cc);
        }
      }
    }
  }

  // Refresh same-number highlights
  document.querySelectorAll('.cell').forEach(x => x.classList.remove('same-number'));
  if (num !== 0) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (wallMap[r][c]) continue;
      if (userGrid[r][c] === num && !(r === row && c === col)) getCellEl(r, c).classList.add('same-number');
    }
  }

  updatePickerForCell(row, col);

  // Auto-check when grid is full
  let allFilled = true;
  for (let r = 0; r < ROWS && allFilled; r++)
    for (let c = 0; c < COLS && allFilled; c++)
      if (!wallMap[r][c] && userGrid[r][c] === 0) allFilled = false;
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
  if (m.peerPencilChanges) {
    for (const change of m.peerPencilChanges) {
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
      c.classList.remove('selected', 'run-highlight', 'same-number'));
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
    if (wallMap[r][c] || givenMap[r][c]) continue;
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
    const timerOn = loadSettings('kakuro').showTimer;
    const isNew = timerOn ? submitBestTime('kakuro', currentDifficulty, seconds) : false;
    if (!timerOn) {
      const profile = loadProfile();
      profile.totalSolved = (profile.totalSolved || 0) + 1;
      saveProfile(profile);
    }
    const reward = COIN_REWARDS[currentDifficulty] || 4;
    addCoins(reward);
    icon.textContent = '✦'; icon.style.color = 'var(--amber)';
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

// small helper to render a mini Kakuro cell
function miniCell(content, opts = {}) {
  const { wall, clueDown, clueRight, color, bg, border } = opts;
  if (wall) {
    let inner = '';
    if (clueDown != null) inner += `<span style="position:absolute;left:2px;bottom:1px;font-size:0.5rem;color:#d6c4a8;">${clueDown}</span>`;
    if (clueRight != null) inner += `<span style="position:absolute;right:2px;top:1px;font-size:0.5rem;color:#d6c4a8;">${clueRight}</span>`;
    const slash = (clueDown != null || clueRight != null)
      ? 'background:linear-gradient(to top right, transparent calc(50% - 0.5px), rgba(255,255,255,0.18) calc(50% - 0.5px), rgba(255,255,255,0.18) calc(50% + 0.5px), transparent calc(50% + 0.5px));' : '';
    return `<div style="position:relative;width:34px;height:34px;background:#0f0b07;outline:0.5px solid rgba(255,255,255,0.1);${slash}">${inner}</div>`;
  }
  return `<div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-family:JetBrains Mono,monospace;font-size:0.95rem;font-weight:700;background:${bg||'rgba(255,255,255,0.045)'};outline:0.5px solid rgba(255,255,255,0.1);color:${color||'var(--text)'};${border||''}">${content||''}</div>`;
}
function miniRow(htmls) {
  return `<div style="display:flex;">${htmls.join('')}</div>`;
}

function buildTutVisuals() {
  // Slide 1: sums in the clues — a 3x3 corner with a right-clue and down-clue
  document.getElementById('tutVis1').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
      ${miniRow([miniCell('', { wall: true }), miniCell('', { wall: true, clueDown: 4 }), miniCell('', { wall: true, clueDown: 3 })])}
      ${miniRow([miniCell('', { wall: true, clueRight: 3 }), miniCell('1', { color: 'var(--amber)' }), miniCell('2', { color: 'var(--amber)' })])}
      ${miniRow([miniCell('', { wall: true, clueRight: 4 }), miniCell('3', { color: 'var(--amber)' }), miniCell('1', { color: 'var(--amber)' })])}
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Top-right = sum across →&nbsp; Bottom-left = sum down ↓</div>
    </div>`;

  // Slide 2: no repeats — a run of 4 with 1+3
  document.getElementById('tutVis2').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
      ${miniRow([miniCell('', { wall: true, clueRight: 4 }), miniCell('1', { color: 'var(--success)' }), miniCell('3', { color: 'var(--success)' })])}
      ${miniRow([miniCell('', { wall: true, clueRight: 4 }), miniCell('2', { color: 'var(--error)' }), miniCell('2', { color: 'var(--error)' })])}
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">4 = 1+3 ✓ &nbsp; never 2+2 ✗ (no repeats)</div>
    </div>`;

  // Slide 3: picking — picker mockup
  document.getElementById('tutVis3').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;width:180px;">
        ${[1,2,3,4,5].map(n=>`<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1.5px solid rgba(251,191,36,0.3);background:rgba(255,255,255,0.04);font-family:JetBrains Mono,monospace;font-size:0.95rem;font-weight:700;color:var(--text);">${n}</div>`).join('')}
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Tap a white cell, then a number. Use Pencil for notes.</div>
    </div>`;

  // Slide 4: extremes
  document.getElementById('tutVis4').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      ${miniRow([miniCell('', { wall: true, clueRight: 17 }), miniCell('8', { color: 'var(--amber)' }), miniCell('9', { color: 'var(--amber)' })])}
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Two cells summing to 17 must be 8 and 9. Start with forced sums!</div>
    </div>`;

  // Slide 5: errors + givens
  document.getElementById('tutVis5').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      ${miniRow([miniCell('', { wall: true, clueRight: 6 }), miniCell('2', { color: 'var(--text-dim)', bg: 'rgba(251,191,36,0.10)' }), miniCell('1', { color: 'var(--amber)' }), miniCell('2', { color: 'var(--error)' })])}
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Some cells start filled (givens, dimmed). Wrong cells turn red when the board is full.</div>
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
  const s = loadSettings('kakuro');
  document.getElementById('setAutoDisable').checked = s.autoDisable;
  document.getElementById('setShowTimer').checked = s.showTimer;
  document.getElementById('settingsModal').classList.add('active');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}
function onSettingChange(key, value) {
  setSetting('kakuro', key, value);
  applySettings();
}
function applySettings() {
  const s = loadSettings('kakuro');
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
  const hasSelected = selectedCell && !wallMap[selectedCell.row][selectedCell.col] && !givenMap[selectedCell.row][selectedCell.col];
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
function checkFullAfterHint() {
  let allFilled = true;
  for (let rr = 0; rr < ROWS && allFilled; rr++)
    for (let cc = 0; cc < COLS && allFilled; cc++)
      if (!wallMap[rr][cc] && userGrid[rr][cc] === 0) allFilled = false;
  if (allFilled) checkSolution();
}
function useRandomHint() {
  if (!spendCoins(HINT_COST_RANDOM)) return;
  closeHintShop();
  const empty = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!wallMap[r][c] && !givenMap[r][c] && userGrid[r][c] === 0) empty.push([r, c]);
  }
  if (empty.length === 0) return;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  revealCell(r, c); selectCell(r, c);
  checkFullAfterHint();
}
function useChosenHint() {
  if (!selectedCell) return;
  if (wallMap[selectedCell.row][selectedCell.col] || givenMap[selectedCell.row][selectedCell.col]) return;
  if (!spendCoins(HINT_COST_CHOSEN)) return;
  closeHintShop();
  const { row, col } = selectedCell;
  revealCell(row, col); selectCell(row, col);
  checkFullAfterHint();
}

/* ── KEYBOARD ── */
document.addEventListener('keydown', e => {
  if (paused || revealed) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoMove(); return; }
  if (e.key === 'p' || e.key === 'P') { togglePencilMode(); return; }
  if (!selectedCell) return;
  const n = parseInt(e.key);
  if (n >= 1 && n <= MAX_DIGIT) placeNumber(n);
  if (e.key === 'Backspace' || e.key === 'Delete') placeNumber(0);
  const { row, col } = selectedCell;
  // arrow nav — skip walls
  const move = (dr, dc) => {
    let nr = row + dr, nc = col + dc;
    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
      if (!wallMap[nr][nc]) { e.preventDefault(); selectCell(nr, nc); return; }
      nr += dr; nc += dc;
    }
  };
  if (e.key === 'ArrowUp')    move(-1, 0);
  if (e.key === 'ArrowDown')  move(1, 0);
  if (e.key === 'ArrowLeft')  move(0, -1);
  if (e.key === 'ArrowRight') move(0, 1);
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
