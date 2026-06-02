/* ═══════════════════════════════════════════════════
   NONOGRAM.JS  (Pixle)
   Rules:
   - Fill cells so each row/column matches its run-length clues.
   - Cells cycle empty → filled → X (marked-blank) → empty on tap.
   - Drag to paint a line; the first cell's action sets the drag mode.
   - Win when the set of FILLED cells matches the solution (X marks ignored).
   ═══════════════════════════════════════════════════ */

/* ── CONSTANTS ── */
const DIFFICULTIES = {
  easy:   { label: 'Easy',   rows: 5,  cols: 5,  dot: 'easy'   },
  medium: { label: 'Medium', rows: 10, cols: 10, dot: 'medium' },
  hard:   { label: 'Hard',   rows: 15, cols: 15, dot: 'hard'   },
};
const DEFAULT_FILL = '#a78bfa'; // fallback if a puzzle has no palette data
const COIN_REWARDS = { easy: 4, medium: 8, hard: 14 };
const SAVE_KEY = 'nonogram_resume';

// Cell states
const EMPTY = 0, FILLED = 1, MARK = 2;

/* ── STATE ── */
let ROWS, COLS;
let solution = [];        // ROWS×COLS of 0/1 (the answer)
let colorMap = [];        // ROWS×COLS of palette index (-1 = blank) — decorative
let palette = [];         // this puzzle's flat colors
let rowClues = [], colClues = [];
let userGrid = [];        // ROWS×COLS of EMPTY/FILLED/MARK
let autoMarked = [];      // ROWS×COLS bool — true if an ✕ was placed automatically
let selectedCell = null;
let paused = false, revealed = false;
let seconds = 0, timerInterval = null;
let undoStack = [];
let currentDifficulty = 'easy';
let inputMode = FILLED;   // FILLED or MARK — the active tool (toggle)
let wasPausedBefore = false;

// Drag-paint state
let dragging = false;
let dragMode = null;      // target value applied during the drag
let dragChanges = null;   // batch of {r,c,prev} for one undo entry

/* ── UTILS ── */
function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ── PUZZLE BANK (pre-generated, fetched from JSON) ── */
const PLAYED_KEY_PREFIX = 'nonogram_played_';
const BANK_VERSION_KEY = 'nonogram_bank_version';
const CURRENT_BANK_VERSION = 2; // bump when JSON banks are regenerated
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
    const p = bank[index];
    callback({
      solution: p.solution.map(s => s.split('').map(Number)),
      rowClues: p.rowClues,
      colClues: p.colClues,
      palette: p.palette || [DEFAULT_FILL],
      colors: (p.colors || p.solution.map(s => s.replace(/1/g, '0').replace(/0/g, '.')))
        .map(s => s.split('').map(ch => ch === '.' ? -1 : Number(ch))),
    });
  } catch (err) {
    console.error('Nonogram puzzle load failed:', err);
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
    solution, rowClues, colClues,
    palette, colorMap,
    userGrid, autoMarked, seconds,
  }));
}
function clearSavedGame() { localStorage.removeItem(SAVE_KEY); }
function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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
    const best = getBestTime('nonogram', k);
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
  userGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
  autoMarked = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  undoStack = []; selectedCell = null; revealed = false;
  inputMode = FILLED; updateModeUI();
  updateUndoBtn(); buildGrid();
  clearInterval(timerInterval); startTimer();
  clearSavedGame();
}
function doGiveUp() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  clearInterval(timerInterval); revealed = true; paused = true;
  selectedCell = null;
  // Reveal: show the true picture.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    userGrid[r][c] = solution[r][c] ? FILLED : EMPTY;
  }
  buildGrid();
  document.querySelectorAll('.nono-cell.filled').forEach(el => el.classList.add('reveal-filled'));
  clearSavedGame();
}

/* ── GAME START ── */
function startGame(diff) {
  currentDifficulty = diff;
  revealed = false; undoStack = []; selectedCell = null;
  document.getElementById('loading').classList.add('active');

  runGeneration(diff, ({ solution: sol, rowClues: rc, colClues: cc, palette: pal, colors: col }) => {
    try {
      const cfg = DIFFICULTIES[diff];
      ROWS = cfg.rows; COLS = cfg.cols;
      solution = sol;
      rowClues = rc; colClues = cc;
      palette = pal; colorMap = col;
      userGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
      autoMarked = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
      inputMode = FILLED; updateModeUI();

      const tag = document.getElementById('diffTag');
      tag.textContent = cfg.label; tag.className = 'diff-tag ' + diff;

      buildGrid();
      document.getElementById('loading').classList.remove('active');
      showScreen('game');
      startTimer(); updateCoinUI();
      document.getElementById('pauseOverlay').classList.remove('active');
      document.getElementById('pauseIcon').src = '../sudoku/icons/pause.svg';
      updateUndoBtn();
      clearSavedGame();
    } catch (err) {
      console.error('Nonogram render failed:', err);
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
  rowClues = saved.rowClues; colClues = saved.colClues;
  palette = saved.palette || [DEFAULT_FILL];
  colorMap = saved.colorMap || solution.map(row => row.map(v => v ? 0 : -1));
  userGrid = saved.userGrid;
  autoMarked = saved.autoMarked || userGrid.map(row => row.map(() => false));
  seconds = saved.seconds;
  revealed = false; paused = false; undoStack = []; selectedCell = null;
  inputMode = FILLED; updateModeUI();

  const cfg = DIFFICULTIES[currentDifficulty];
  const tag = document.getElementById('diffTag');
  tag.textContent = cfg.label; tag.className = 'diff-tag ' + currentDifficulty;

  buildGrid();
  showScreen('game');
  clearInterval(timerInterval); updateTimer();
  timerInterval = setInterval(() => { if (!paused) { seconds++; updateTimer(); } }, 1000);
  updateCoinUI();
  document.getElementById('pauseOverlay').classList.remove('active');
  document.getElementById('pauseIcon').src = '../sudoku/icons/pause.svg';
  updateUndoBtn();
}

/* ── GRID RENDER ── */
// Layout: a corner cell, a row of column-clue strips, then for each row a
// row-clue strip followed by the cells. We build it with CSS grid:
//   grid-template-columns: [clue-gutter] repeat(COLS).
function buildGrid() {
  const wrapper = document.getElementById('gridWrapper');
  // Max clue depth determines gutter sizing
  const maxRowClue = Math.max(...rowClues.map(c => c.length));
  const maxColClue = Math.max(...colClues.map(c => c.length));

  const board = document.getElementById('board');
  board.innerHTML = '';
  board.style.gridTemplateColumns = `auto repeat(${COLS}, 1fr)`;
  board.style.gridTemplateRows = `auto repeat(${ROWS}, 1fr)`;
  board.dataset.size = COLS; // for font scaling hooks

  // Top-left corner spacer
  const corner = document.createElement('div');
  corner.className = 'nono-corner';
  board.appendChild(corner);

  // Column clue strips
  for (let c = 0; c < COLS; c++) {
    const strip = document.createElement('div');
    strip.className = 'col-clue';
    strip.dataset.col = c;
    for (const n of colClues[c]) {
      if (n === 0) continue;
      const s = document.createElement('span');
      s.textContent = n;
      strip.appendChild(s);
    }
    board.appendChild(strip);
  }

  // Rows: clue strip + cells
  for (let r = 0; r < ROWS; r++) {
    const strip = document.createElement('div');
    strip.className = 'row-clue';
    strip.dataset.row = r;
    for (const n of rowClues[r]) {
      if (n === 0) continue;
      const s = document.createElement('span');
      s.textContent = n;
      strip.appendChild(s);
    }
    board.appendChild(strip);

    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'nono-cell';
      cell.dataset.row = r; cell.dataset.col = c;
      // 5-cell block separators (heavier border every 5 cells)
      if (c % 5 === 0 && c !== 0) cell.classList.add('block-left');
      if (r % 5 === 0 && r !== 0) cell.classList.add('block-top');
      board.appendChild(cell);
    }
  }

  renderAllCells();
  refreshClueSatisfaction();
}

function getCellEl(r, c) {
  return document.querySelector(`.nono-cell[data-row="${r}"][data-col="${c}"]`);
}

function renderCell(r, c) {
  const el = getCellEl(r, c);
  if (!el) return;
  el.classList.remove('filled', 'marked', 'reveal-filled');
  el.style.background = '';
  el.innerHTML = '';
  const v = userGrid[r][c];
  if (v === FILLED) {
    el.classList.add('filled');
    // Use the cell's decorative color; if this cell isn't part of the picture
    // (a wrong guess), fall back to the puzzle's first palette color.
    const ci = colorMap[r] && colorMap[r][c] >= 0 ? colorMap[r][c] : 0;
    el.style.background = palette[ci] || palette[0] || DEFAULT_FILL;
  } else if (v === MARK) {
    el.classList.add('marked');
    el.innerHTML = '<span class="x-mark">✕</span>';
  }
}

function renderAllCells() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) renderCell(r, c);
}

/* ── SELECTION ── */
function setSelected(r, c) {
  document.querySelectorAll('.nono-cell.selected').forEach(el => el.classList.remove('selected'));
  selectedCell = { row: r, col: c };
  const el = getCellEl(r, c);
  if (el) el.classList.add('selected');
}

/* ── CLUE SATISFACTION (autoDisable setting) ── */
// When ON: a row/col clue strip dims once that line's FILLED cells exactly
// match its clue. Purely a visual aid — no effect on win logic.
function lineMatchesClue(values, clue) {
  const runs = [];
  let run = 0;
  for (const v of values) {
    if (v === FILLED) run++;
    else if (run > 0) { runs.push(run); run = 0; }
  }
  if (run > 0) runs.push(run);
  const target = (clue.length === 1 && clue[0] === 0) ? [] : clue;
  if (runs.length !== target.length) return false;
  for (let i = 0; i < runs.length; i++) if (runs[i] !== target[i]) return false;
  return true;
}

function refreshClueSatisfaction() {
  const on = getSetting('nonogram', 'autoDisable');
  // Rows
  for (let r = 0; r < ROWS; r++) {
    const strip = document.querySelector(`.row-clue[data-row="${r}"]`);
    if (!strip) continue;
    const done = on && lineMatchesClue(userGrid[r], rowClues[r]);
    strip.classList.toggle('done', done);
  }
  // Cols
  for (let c = 0; c < COLS; c++) {
    const strip = document.querySelector(`.col-clue[data-col="${c}"]`);
    if (!strip) continue;
    const col = userGrid.map(row => row[c]);
    const done = on && lineMatchesClue(col, colClues[c]);
    strip.classList.toggle('done', done);
  }
}

/* ── INPUT MODE (fill / mark toggle) ── */
function setInputMode(mode) {
  inputMode = mode;
  updateModeUI();
}
function toggleInputMode() {
  setInputMode(inputMode === FILLED ? MARK : FILLED);
}
function updateModeUI() {
  const fillBtn = document.getElementById('modeFill');
  const markBtn = document.getElementById('modeMark');
  if (!fillBtn || !markBtn) return;
  fillBtn.classList.toggle('active', inputMode === FILLED);
  markBtn.classList.toggle('active', inputMode === MARK);
}

/* ── INPUT: tap toggles in current mode, drag paints ── */
function applyCell(r, c, value, batch) {
  const prev = userGrid[r][c];
  if (prev === value) return false;
  if (batch) batch.push({ r, c, prev, prevAuto: autoMarked[r][c] });
  userGrid[r][c] = value;
  autoMarked[r][c] = false; // any manual change clears the auto flag
  renderCell(r, c);
  return true;
}

// A single TAP cycles the cell through three states, with the active tool
// deciding which value comes first:
//   tool = FILL:  blank → FILL → MARK → blank
//   tool = MARK:  blank → MARK → FILL → blank
// (i.e. tap1 = tool value, tap2 = the opposite, tap3 = reset to blank)
function tapCycle(current) {
  const opposite = inputMode === FILLED ? MARK : FILLED;
  if (current === EMPTY) return inputMode;
  if (current === inputMode) return opposite;
  return EMPTY; // current === opposite → reset
}

// Track whether the pointer moved after going down, to tell a tap from a drag.
let dragStart = null;     // { r, c } of the cell pressed
let dragMoved = false;    // becomes true once we enter a different cell

function pointerDownCell(r, c) {
  if (paused || revealed) return;
  dragging = true;
  dragChanges = [];
  dragStart = { r, c };
  dragMoved = false;
  // Provisionally treat this as a tap → cycle the pressed cell. If a drag
  // begins (pointer enters another cell), pointerEnterCell will convert the
  // stroke to a paint of the active tool's value.
  applyCell(r, c, tapCycle(userGrid[r][c]), dragChanges);
}

function pointerEnterCell(r, c) {
  if (!dragging || paused || revealed) return;
  if (r === dragStart.r && c === dragStart.c) return;

  if (!dragMoved) {
    // First real movement → this is a drag, not a tap. A drag PAINTS the
    // active tool's value (no 3-cycle). Reset the start cell to that value so
    // the whole stroke is consistent.
    dragMoved = true;
    dragMode = inputMode;
    applyCell(dragStart.r, dragStart.c, dragMode, dragChanges);
  }
  if (userGrid[r][c] !== dragMode) {
    applyCell(r, c, dragMode, dragChanges);
  }
}

function pointerUp() {
  if (!dragging) return;
  dragging = false;
  if (dragChanges && dragChanges.length > 0) {
    // Auto-mark every row/col touched by this stroke, recording the ✕ it adds
    // (or removes) into the SAME undo entry so one undo reverts everything.
    const rowsTouched = new Set(dragChanges.map(ch => ch.r));
    const colsTouched = new Set(dragChanges.map(ch => ch.c));
    for (const r of rowsTouched) autoMarkRow(r, dragChanges);
    for (const c of colsTouched) autoMarkCol(c, dragChanges);

    undoStack.push({ changes: dragChanges });
    updateUndoBtn();
    refreshClueSatisfaction();
    checkWin();
  }
  dragChanges = null;
  dragMode = null;
}

/* ── AUTO-MARK ── */
// When a line's FILLED cells match its clue (any arrangement, per spec), fill
// the remaining EMPTY cells with ✕. If the line no longer matches, remove the
// ✕ that WE placed automatically (manual ✕ are left alone). Changes are pushed
// into `batch` so they undo together with the move that triggered them.
function setCellAuto(r, c, value, isAuto, batch) {
  const prev = userGrid[r][c];
  const prevAuto = autoMarked[r][c];
  if (prev === value && prevAuto === isAuto) return;
  batch.push({ r, c, prev, prevAuto });
  userGrid[r][c] = value;
  autoMarked[r][c] = isAuto;
  renderCell(r, c);
}

function autoMarkLine(cells, clue, batch) {
  const values = cells.map(([r, c]) => userGrid[r][c]);
  if (lineMatchesClue(values, clue)) {
    // Fill every EMPTY cell with an auto ✕.
    for (const [r, c] of cells) {
      if (userGrid[r][c] === EMPTY) setCellAuto(r, c, MARK, true, batch);
    }
  } else {
    // Line broke — strip any ✕ we auto-placed on this line.
    for (const [r, c] of cells) {
      if (autoMarked[r][c] && userGrid[r][c] === MARK) setCellAuto(r, c, EMPTY, false, batch);
    }
  }
}
function autoMarkRow(r, batch) {
  const cells = [];
  for (let c = 0; c < COLS; c++) cells.push([r, c]);
  autoMarkLine(cells, rowClues[r], batch);
}
function autoMarkCol(c, batch) {
  const cells = [];
  for (let r = 0; r < ROWS; r++) cells.push([r, c]);
  autoMarkLine(cells, colClues[c], batch);
}

/* ── UNDO ── */
function undoMove() {
  if (undoStack.length === 0 || paused || revealed) return;
  const m = undoStack.pop();
  for (let i = m.changes.length - 1; i >= 0; i--) {
    const { r, c, prev, prevAuto } = m.changes[i];
    userGrid[r][c] = prev;
    autoMarked[r][c] = prevAuto || false;
    renderCell(r, c);
  }
  updateUndoBtn();
  refreshClueSatisfaction();
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
  document.getElementById('board').classList.toggle('hidden-board', paused);
  document.getElementById('pauseIcon').src = paused
    ? '../sudoku/icons/play.svg'
    : '../sudoku/icons/pause.svg';
}

/* ── WIN CHECK (lenient) ── */
// Win when the FILLED set matches the solution exactly. X marks are ignored.
// We never flag mistakes mid-play (lenient mode).
function checkWin() {
  if (paused || revealed) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const wantFilled = solution[r][c] === 1;
      const isFilled = userGrid[r][c] === FILLED;
      if (wantFilled !== isFilled) return;
    }
  }
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
    const timerOn = loadSettings('nonogram').showTimer;
    const isNew = timerOn ? submitBestTime('nonogram', currentDifficulty, seconds) : false;
    if (!timerOn) {
      const profile = loadProfile();
      profile.totalSolved = (profile.totalSolved || 0) + 1;
      saveProfile(profile);
    }
    const reward = COIN_REWARDS[currentDifficulty] || 4;
    addCoins(reward);
    icon.textContent = '✦'; icon.style.color = 'var(--purple)';
    title.textContent = 'Picture complete!';
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
const TUT_TOTAL = 4;
let tutSlide = 0;

function miniGrid(spec, accent) {
  // spec: array of strings using '1' filled, '0' empty, 'x' mark
  let h = `<div style="display:grid;grid-template-columns:repeat(${spec[0].length},26px);grid-template-rows:repeat(${spec.length},26px);gap:2px;">`;
  for (const row of spec) {
    for (const ch of row) {
      let bg = 'rgba(255,255,255,0.04)', content = '', color = 'var(--text-dim)';
      if (ch === '1') bg = accent || 'var(--purple)';
      if (ch === 'x') content = '✕';
      h += `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:${bg};border:1px solid rgba(255,255,255,0.06);font-size:0.7rem;color:${color};">${content}</div>`;
    }
  }
  return h + '</div>';
}

function buildTutVisuals() {
  // Slide 1: clues describe runs
  document.getElementById('tutVis1').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;font-weight:700;color:var(--purple);display:flex;gap:6px;"><span>2</span><span>1</span></div>
        ${miniGrid(['11010'])}
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Clue "2 1" → a run of 2, then a run of 1, with a gap between.</div>
    </div>`;

  // Slide 2: fill vs mark tools
  document.getElementById('tutVis2').innerHTML = `
    <div style="display:flex;align-items:center;gap:20px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        ${miniGrid(['1'])}
        <div style="font-size:0.7rem;color:var(--text-dim);">Fill</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        ${miniGrid(['x'])}
        <div style="font-size:0.7rem;color:var(--text-dim);">Mark ✕</div>
      </div>
    </div>`;

  // Slide 3: drag to paint
  document.getElementById('tutVis3').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      ${miniGrid(['11111'])}
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Press and drag across cells to fill a whole run at once.</div>
    </div>`;

  // Slide 4: complete picture
  document.getElementById('tutVis4').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      ${miniGrid(['01110','11011','11111','10101','01110'])}
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">Fill every cell the clues call for to reveal the picture.</div>
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
  const s = loadSettings('nonogram');
  document.getElementById('setAutoDisable').checked = s.autoDisable;
  document.getElementById('setShowTimer').checked = s.showTimer;
  document.getElementById('settingsModal').classList.add('active');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}
function onSettingChange(key, value) {
  setSetting('nonogram', key, value);
  applySettings();
}
function applySettings() {
  const s = loadSettings('nonogram');
  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.style.display = s.showTimer ? '' : 'none';
  if (document.getElementById('board').childElementCount) refreshClueSatisfaction();
}

/* ── HINT SHOP ── */
const HINT_COST_RANDOM = 2;
const HINT_COST_CHOSEN = 5;
let hintWasPausedBefore = false;

function openHintShop() {
  if (revealed) return;
  hintWasPausedBefore = paused;
  document.getElementById('hintModalCoins').textContent = getCoins();
  const hasSelected = selectedCell !== null;
  document.getElementById('hintRandom').disabled = getCoins() < HINT_COST_RANDOM;
  document.getElementById('hintChosen').disabled = getCoins() < HINT_COST_CHOSEN || !hasSelected;
  const chosenDesc = document.getElementById('hintChosen').querySelector('.hint-option-desc');
  chosenDesc.textContent = hasSelected
    ? 'Resolves the cell you have selected.'
    : 'Tap a cell first, then come back.';
  paused = true;
  document.getElementById('hintModal').classList.add('active');
}
function closeHintShop() {
  document.getElementById('hintModal').classList.remove('active');
  paused = hintWasPausedBefore;
}
// Commit a single-cell change, run auto-mark for its row+col, and record it
// all as ONE undo entry. Shared by keyboard input and hints.
function commitSingle(r, c, value) {
  const batch = [];
  applyCell(r, c, value, batch);
  autoMarkRow(r, batch);
  autoMarkCol(c, batch);
  if (batch.length > 0) {
    undoStack.push({ changes: batch });
    updateUndoBtn();
  }
  refreshClueSatisfaction();
}

// Resolve a cell to its TRUE value (filled or marked-blank) as a hint.
function revealHintCell(r, c) {
  const want = solution[r][c] === 1 ? FILLED : MARK;
  commitSingle(r, c, want);
  getCellEl(r, c).classList.add('hint-cell');
}
function useRandomHint() {
  if (getCoins() < HINT_COST_RANDOM) return;
  // Find cells that are currently wrong (filled-state doesn't match solution).
  const wrong = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const want = solution[r][c] === 1 ? FILLED : MARK;
    const isFilledNow = userGrid[r][c] === FILLED;
    const shouldFill = solution[r][c] === 1;
    if (isFilledNow !== shouldFill) wrong.push([r, c, want]);
  }
  if (wrong.length === 0) { closeHintShop(); return; }
  if (!spendCoins(HINT_COST_RANDOM)) return;
  closeHintShop();
  const [r, c] = wrong[Math.floor(Math.random() * wrong.length)];
  revealHintCell(r, c);
  updateCoinUI();
  checkWin();
}
function useChosenHint() {
  if (selectedCell === null) return;
  if (getCoins() < HINT_COST_CHOSEN) return;
  if (!spendCoins(HINT_COST_CHOSEN)) return;
  closeHintShop();
  revealHintCell(selectedCell.row, selectedCell.col);
  updateCoinUI();
  checkWin();
}

/* ── POINTER WIRING ── */
// On touch, the pointer is implicitly captured by the element the touch began
// on, so `pointerover`/`pointerenter` don't fire on the cells the finger moves
// across. To make drag-paint work on phones we instead hit-test with
// `elementFromPoint` on every `pointermove`.
function cellFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cell = el.closest && el.closest('.nono-cell');
  if (!cell) return null;
  return { r: +cell.dataset.row, c: +cell.dataset.col };
}

function initPointerHandlers() {
  const board = document.getElementById('board');

  board.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.nono-cell');
    if (!cell) return;
    e.preventDefault();
    const r = +cell.dataset.row, c = +cell.dataset.col;
    setSelected(r, c);
    // Release implicit capture so elementFromPoint hit-testing drives the drag.
    if (board.hasPointerCapture && board.hasPointerCapture(e.pointerId)) {
      board.releasePointerCapture(e.pointerId);
    }
    pointerDownCell(r, c);
  });

  // Drive the drag from pointermove + hit-testing (works for touch AND mouse).
  document.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    const hit = cellFromPoint(e.clientX, e.clientY);
    if (hit) pointerEnterCell(hit.r, hit.c);
  });

  // End the drag anywhere.
  document.addEventListener('pointerup', pointerUp);
  document.addEventListener('pointercancel', pointerUp);
}

/* ── KEYBOARD ── */
document.addEventListener('keydown', e => {
  if (paused || revealed) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoMove(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleInputMode(); return; }
  if (!selectedCell) return;
  const { row, col } = selectedCell;
  // Space / F fills (toggle), X marks (toggle)
  if (e.key === ' ' || e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    commitSingle(row, col, userGrid[row][col] === FILLED ? EMPTY : FILLED);
    checkWin();
  }
  if (e.key === 'x' || e.key === 'X') {
    commitSingle(row, col, userGrid[row][col] === MARK ? EMPTY : MARK);
  }
  if (e.key === 'ArrowUp'    && row > 0)      { e.preventDefault(); setSelected(row-1, col); }
  if (e.key === 'ArrowDown'  && row < ROWS-1) { e.preventDefault(); setSelected(row+1, col); }
  if (e.key === 'ArrowLeft'  && col > 0)      { e.preventDefault(); setSelected(row, col-1); }
  if (e.key === 'ArrowRight' && col < COLS-1) { e.preventDefault(); setSelected(row, col+1); }
});

/* ── INIT ── */
buildHome();
buildTutDots();
buildTutVisuals();
updateTutSlide();
applySettings();
initPointerHandlers();

const daily = claimDailyReward();
if (daily.awarded) {
  updateCoinUI();
  showDailyOverlay(daily.reward, daily.streak, daily.coins, daily.schedule);
}
