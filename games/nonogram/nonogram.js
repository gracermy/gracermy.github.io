/* ═══════════════════════════════════════════════════
   NONOGRAM.JS  (Pixle)  — COLORED nonograms
   Cell value model:
     EMPTY = 0
     1..K  = filled with palette[value-1]
     MARK  = -1  (✕, "definitely blank")
   Clues are colored: each is [length, colorIdx]. Same-color runs need a gap;
   different-color runs may touch. Win when every cell's color matches the
   solution. Easy puzzles have 1 color (classic picross); medium/hard mix
   1- and 2-color puzzles.
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

// Cell states. Colors are 1..K; EMPTY and MARK are sentinels.
const EMPTY = 0, MARK = -1;
function isColor(v) { return v >= 1; }

/* ── STATE ── */
let ROWS, COLS;
let solution = [];        // ROWS×COLS: 0 blank, 1..K color value
let palette = [];         // this puzzle's flat colors (index = value-1)
let rowClues = [], colClues = [];  // each clue = [[len, colorIdx], ...]
let userGrid = [];        // ROWS×COLS of EMPTY / 1..K / MARK
let autoMarked = [];      // ROWS×COLS bool — true if ✕ placed automatically
let selectedCell = null;
let paused = false, revealed = false;
let seconds = 0, timerInterval = null;
let undoStack = [];
let currentDifficulty = 'easy';
let inputMode = 1;        // active tool: a color value 1..K, or MARK
let wasPausedBefore = false;

// Drag-paint state
let dragging = false;
let dragMode = null;      // target value applied during the drag
let dragChanges = null;   // batch of {r,c,prev,prevAuto} for one undo entry
let dragStart = null;
let dragMoved = false;

/* ── UTILS ── */
function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/* ── PUZZLE BANK (pre-generated, fetched from JSON) ── */
const PLAYED_KEY_PREFIX = 'nonogram_played_';
const BANK_VERSION_KEY = 'nonogram_bank_version';
const CURRENT_BANK_VERSION = 3; // bump when JSON banks are regenerated
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
      // solution string: '0' blank, '1'..'K' color value
      solution: p.solution.map(s => s.split('').map(Number)),
      rowClues: p.rowClues,   // [[len, colorIdx], ...]
      colClues: p.colClues,
      palette: p.palette || [DEFAULT_FILL],
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
    palette,
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
  inputMode = 1; buildToolbar();
  updateUndoBtn(); buildGrid();
  clearInterval(timerInterval); startTimer();
  clearSavedGame();
}
function doGiveUp() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  clearInterval(timerInterval); revealed = true; paused = true;
  selectedCell = null;
  // Reveal: show the true picture (with colors).
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    userGrid[r][c] = solution[r][c]; // 0 blank, or color value
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

  runGeneration(diff, ({ solution: sol, rowClues: rc, colClues: cc, palette: pal }) => {
    try {
      const cfg = DIFFICULTIES[diff];
      ROWS = cfg.rows; COLS = cfg.cols;
      solution = sol;
      rowClues = rc; colClues = cc;
      palette = pal;
      userGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));
      autoMarked = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
      inputMode = 1; buildToolbar();

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
  userGrid = saved.userGrid;
  autoMarked = saved.autoMarked || userGrid.map(row => row.map(() => false));
  seconds = saved.seconds;
  revealed = false; paused = false; undoStack = []; selectedCell = null;
  inputMode = 1; buildToolbar();

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

  // Column clue strips (each number tinted in its run's color)
  for (let c = 0; c < COLS; c++) {
    const strip = document.createElement('div');
    strip.className = 'col-clue';
    strip.dataset.col = c;
    appendClueNumbers(strip, colClues[c]);
    board.appendChild(strip);
  }

  // Rows: clue strip + cells
  for (let r = 0; r < ROWS; r++) {
    const strip = document.createElement('div');
    strip.className = 'row-clue';
    strip.dataset.row = r;
    appendClueNumbers(strip, rowClues[r]);
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

// Render a clue strip's numbers, each tinted with its run's color.
function appendClueNumbers(strip, clue) {
  for (const [len, colorIdx] of clue) {
    const s = document.createElement('span');
    s.textContent = len;
    s.style.color = palette[colorIdx] || DEFAULT_FILL;
    s.dataset.color = colorIdx;
    strip.appendChild(s);
  }
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
  if (isColor(v)) {
    el.classList.add('filled');
    el.style.background = palette[v - 1] || DEFAULT_FILL;
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

/* ── CLUE SATISFACTION ── */
// Compute the colored runs of a line: a new run starts on a color change or a
// non-color cell (EMPTY/MARK both count as "blank" for run purposes).
function lineRuns(values) {
  const runs = [];
  let len = 0, color = 0;
  for (const v of values) {
    const col = isColor(v) ? v : 0;
    if (col === 0) {
      if (len > 0) runs.push([len, color - 1]);
      len = 0; color = 0;
    } else if (col === color) {
      len++;
    } else {
      if (len > 0) runs.push([len, color - 1]);
      len = 1; color = col;
    }
  }
  if (len > 0) runs.push([len, color - 1]);
  return runs;
}

// A line matches its clue when its colored runs equal the clue in length AND
// color sequence.
function lineMatchesClue(values, clue) {
  const runs = lineRuns(values);
  if (runs.length !== clue.length) return false;
  for (let i = 0; i < runs.length; i++) {
    if (runs[i][0] !== clue[i][0] || runs[i][1] !== clue[i][1]) return false;
  }
  return true;
}

// Per-number strikethrough: match the line's completed runs to the clue
// numbers one-to-one, in order from the start (left for rows, top for cols).
// The Nth run strikes the Nth clue number when their LENGTHS match; we stop at
// the first mismatch. Each run claims exactly ONE number, so with a duplicate
// clue like "1 1 1" a single run of 1 strikes only the first (top/left) one —
// no double-counting from both ends. Color isn't required to strike.
function struckClueFlags(values, clue) {
  const runs = lineRuns(values);          // each run is already "closed"
  const struck = new Array(clue.length).fill(false);
  let i = 0;
  while (i < clue.length && i < runs.length && runs[i][0] === clue[i][0]) {
    struck[i] = true; i++;
  }
  return struck;
}

function applyStrikes(strip, values, clue) {
  const flags = struckClueFlags(values, clue);
  const spans = strip.querySelectorAll('span');
  spans.forEach((sp, idx) => sp.classList.toggle('struck', !!flags[idx]));
}

function refreshClueSatisfaction() {
  // Strike individual clue numbers as their runs form (regardless of
  // correctness); when the whole line matches, the strip also gets `done`
  // (which the existing auto-mark already keys off via lineMatchesClue).
  for (let r = 0; r < ROWS; r++) {
    const strip = document.querySelector(`.row-clue[data-row="${r}"]`);
    if (!strip) continue;
    applyStrikes(strip, userGrid[r], rowClues[r]);
  }
  for (let c = 0; c < COLS; c++) {
    const strip = document.querySelector(`.col-clue[data-col="${c}"]`);
    if (!strip) continue;
    const col = userGrid.map(row => row[c]);
    applyStrikes(strip, col, colClues[c]);
  }
}

/* ── TOOLBAR (per-color Fill buttons + Mark) ── */
// Built dynamically from the puzzle's palette: one Fill button per color (just
// "Fill" when monochrome), plus a Mark button. The active tool decides what a
// tap/drag paints.
function buildToolbar() {
  const bar = document.getElementById('modeToggle');
  if (!bar) return;
  bar.innerHTML = '';
  palette.forEach((color, i) => {
    const val = i + 1;
    const btn = document.createElement('button');
    btn.className = 'mode-btn';
    btn.dataset.mode = val;
    btn.onclick = () => setInputMode(val);
    btn.innerHTML = `<span class="mode-swatch" style="background:${color}"></span>`;
    bar.appendChild(btn);
  });
  const markBtn = document.createElement('button');
  markBtn.className = 'mode-btn';
  markBtn.dataset.mode = MARK;
  markBtn.onclick = () => setInputMode(MARK);
  markBtn.innerHTML = `<span class="mode-x">✕</span>`;
  bar.appendChild(markBtn);
  updateModeUI();
}
function setInputMode(mode) {
  inputMode = mode;
  updateModeUI();
}
function updateModeUI() {
  document.querySelectorAll('#modeToggle .mode-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.mode) === inputMode);
  });
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

// A single TAP cycles the cell through three states. The active tool decides
// the first value:
//   tool = a color C:  blank → C → MARK → blank
//   tool = MARK:        blank → MARK → (color 1) → blank
// (tap1 = tool value, tap2 = the "opposite", tap3 = reset to blank)
function tapCycle(current) {
  const opposite = inputMode === MARK ? 1 : MARK;
  if (current === EMPTY) return inputMode;
  if (current === inputMode) return opposite;
  return EMPTY; // current === opposite (or anything else) → reset
}

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
    // Recompute auto-marks for the whole board, folding the resulting ✕ changes
    // into THIS stroke's undo entry so one undo reverts everything together.
    recomputeAutoMarks(dragChanges);

    undoStack.push({ changes: dragChanges });
    updateUndoBtn();
    refreshClueSatisfaction();
    checkWin();
  }
  dragChanges = null;
  dragMode = null;
}

/* ── AUTO-MARK ── */
// Rule: a cell gets an automatic ✕ when its row's filled cells match the row
// clue OR its column's filled cells match the column clue. An auto-✕ is removed
// when NEITHER its row nor its column matches any more. Manual ✕ (autoMarked
// false) are never touched.
//
// We recompute the whole board after each move — at most 15×15 cells, so it's
// cheap and avoids the cross-line edge cases (a row's ✕ being stripped because
// the crossing column isn't done yet). Changes fold into `batch` so one undo
// reverts the move plus all the auto-marks it caused.
function setCellAuto(r, c, value, isAuto, batch) {
  const prev = userGrid[r][c];
  const prevAuto = autoMarked[r][c];
  if (prev === value && prevAuto === isAuto) return;
  batch.push({ r, c, prev, prevAuto });
  userGrid[r][c] = value;
  autoMarked[r][c] = isAuto;
  renderCell(r, c);
}

function recomputeAutoMarks(batch) {
  // Gated by the "Auto-mark blanks" setting. When OFF, strip any existing
  // auto-✕ and do nothing further (manual ✕ untouched).
  if (!getSetting('nonogram', 'autoDisable')) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (autoMarked[r][c] && userGrid[r][c] === MARK) setCellAuto(r, c, EMPTY, false, batch);
    return;
  }
  // Which rows / cols currently satisfy their clue?
  const rowDone = new Array(ROWS);
  for (let r = 0; r < ROWS; r++) rowDone[r] = lineMatchesClue(userGrid[r], rowClues[r]);
  const colDone = new Array(COLS);
  for (let c = 0; c < COLS; c++) {
    const col = userGrid.map(row => row[c]);
    colDone[c] = lineMatchesClue(col, colClues[c]);
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const justified = rowDone[r] || colDone[c];
      if (justified && userGrid[r][c] === EMPTY) {
        setCellAuto(r, c, MARK, true, batch);          // place auto ✕
      } else if (!justified && autoMarked[r][c] && userGrid[r][c] === MARK) {
        setCellAuto(r, c, EMPTY, false, batch);        // remove orphaned auto ✕
      }
    }
  }
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
// Win when every cell's COLOR matches the solution. A blank solution cell may
// be EMPTY or MARK (✕ doesn't count as filled). We never flag mistakes
// mid-play (lenient mode).
function checkWin() {
  if (paused || revealed) return;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const want = solution[r][c];            // 0 blank, or color value
      const have = userGrid[r][c];
      if (want === 0) {
        if (isColor(have)) return;            // should be blank but is colored
      } else {
        if (have !== want) return;            // wrong color (or empty/mark)
      }
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

// spec chars: '0' empty · 'x' mark · '1'/'2'/'3' filled with tutorial colors.
const TUT_COLORS = { '1': '#f472b6', '2': '#60a5fa', '3': '#34d399' };
function miniGrid(spec) {
  let h = `<div style="display:grid;grid-template-columns:repeat(${spec[0].length},26px);grid-template-rows:repeat(${spec.length},26px);gap:2px;">`;
  for (const row of spec) {
    for (const ch of row) {
      let bg = 'rgba(255,255,255,0.04)', content = '', color = 'var(--text-dim)';
      if (TUT_COLORS[ch]) bg = TUT_COLORS[ch];
      if (ch === 'x') content = '✕';
      h += `<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;background:${bg};border:1px solid rgba(255,255,255,0.06);font-size:0.7rem;color:${color};">${content}</div>`;
    }
  }
  return h + '</div>';
}

function buildTutVisuals() {
  // Slide 1: colored clues describe runs
  document.getElementById('tutVis1').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;font-weight:700;display:flex;gap:6px;"><span style="color:${TUT_COLORS['1']}">2</span><span style="color:${TUT_COLORS['2']}">2</span></div>
        ${miniGrid(['11220'])}
      </div>
      <div style="font-size:0.72rem;color:var(--text-dim);text-align:center;">"2 2" in pink then blue → the two colours may touch (different colours need no gap).</div>
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
  // Toggling auto-mark mid-game: apply it immediately (add or strip auto-✕),
  // as one undoable step.
  if (document.getElementById('board').childElementCount && !revealed) {
    const batch = [];
    recomputeAutoMarks(batch);
    if (batch.length > 0) { undoStack.push({ changes: batch }); updateUndoBtn(); }
    refreshClueSatisfaction();
  }
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
  recomputeAutoMarks(batch);
  if (batch.length > 0) {
    undoStack.push({ changes: batch });
    updateUndoBtn();
  }
  refreshClueSatisfaction();
}

// Resolve a cell to its TRUE state as a hint: the solution's color if filled,
// otherwise ✕ (definitely blank).
function revealHintCell(r, c) {
  const want = solution[r][c] === 0 ? MARK : solution[r][c]; // color value or ✕
  commitSingle(r, c, want);
  getCellEl(r, c).classList.add('hint-cell');
}
function useRandomHint() {
  if (getCoins() < HINT_COST_RANDOM) return;
  // Find cells whose current state doesn't match the solution (wrong/blank).
  const wrong = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const want = solution[r][c];          // 0 blank, or color value
    const have = userGrid[r][c];
    const correct = want === 0 ? !isColor(have) : have === want;
    if (!correct) wrong.push([r, c]);
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
  if (e.key === 'm' || e.key === 'M') { setInputMode(MARK); return; }
  // Number keys 1..K pick a color tool.
  const num = parseInt(e.key);
  if (num >= 1 && num <= palette.length) { setInputMode(num); return; }
  if (!selectedCell) return;
  const { row, col } = selectedCell;
  // Space / F places the active color (toggle off if already that color).
  if (e.key === ' ' || e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    const color = isColor(inputMode) ? inputMode : 1;
    commitSingle(row, col, userGrid[row][col] === color ? EMPTY : color);
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
