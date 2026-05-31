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
const COIN_REWARDS = { easy: 4, medium: 8, hard: 14 };
const SAVE_KEY = 'nonogram_resume';

// Cell states
const EMPTY = 0, FILLED = 1, MARK = 2;

/* ── STATE ── */
let ROWS, COLS;
let solution = [];        // ROWS×COLS of 0/1 (the answer)
let rowClues = [], colClues = [];
let userGrid = [];        // ROWS×COLS of EMPTY/FILLED/MARK
let selectedCell = null;
let paused = false, revealed = false;
let seconds = 0, timerInterval = null;
let undoStack = [];
let currentDifficulty = 'easy';
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
    const p = bank[index];
    callback({
      solution: p.solution.map(s => s.split('').map(Number)),
      rowClues: p.rowClues,
      colClues: p.colClues,
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
    userGrid, seconds,
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
    btn.innerHTML = `<div class="diff-label"><span class="diff-dot ${cfg.dot}"></span>${cfg.label} · ${cfg.rows}×${cfg.cols}</div><div>${bs}</div>`;
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
  undoStack = []; selectedCell = null; revealed = false;
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

  runGeneration(diff, ({ solution: sol, rowClues: rc, colClues: cc }) => {
    try {
      const cfg = DIFFICULTIES[diff];
      ROWS = cfg.rows; COLS = cfg.cols;
      solution = sol;
      rowClues = rc; colClues = cc;
      userGrid = Array.from({ length: ROWS }, () => new Array(COLS).fill(EMPTY));

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
  userGrid = saved.userGrid;
  seconds = saved.seconds;
  revealed = false; paused = false; undoStack = []; selectedCell = null;

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
  el.innerHTML = '';
  const v = userGrid[r][c];
  if (v === FILLED) el.classList.add('filled');
  else if (v === MARK) { el.classList.add('marked'); el.innerHTML = '<span class="x-mark">✕</span>'; }
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

/* ── INPUT: tap to cycle, drag to paint ── */
// Tap cycles EMPTY → FILLED → MARK → EMPTY.
function cycleValue(v) {
  if (v === EMPTY) return FILLED;
  if (v === FILLED) return MARK;
  return EMPTY;
}

function applyCell(r, c, value, batch) {
  const prev = userGrid[r][c];
  if (prev === value) return false;
  if (batch) batch.push({ r, c, prev });
  userGrid[r][c] = value;
  renderCell(r, c);
  return true;
}

function pointerDownCell(r, c) {
  if (paused || revealed) return;
  dragging = true;
  dragChanges = [];
  // First cell determines the drag mode: tapping cycles, but for a drag we
  // paint a single target value derived from the first cell's NEW value.
  const newVal = cycleValue(userGrid[r][c]);
  dragMode = newVal;
  applyCell(r, c, newVal, dragChanges);
  afterCellChange(r, c);
}

function pointerEnterCell(r, c) {
  if (!dragging || paused || revealed) return;
  if (dragMode === null) return;
  // While dragging, paint dragMode onto cells (but only overwrite cells that
  // differ — and don't flip already-painted cells back and forth).
  if (userGrid[r][c] !== dragMode) {
    applyCell(r, c, dragMode, dragChanges);
    afterCellChange(r, c);
  }
}

function pointerUp() {
  if (!dragging) return;
  dragging = false;
  if (dragChanges && dragChanges.length > 0) {
    undoStack.push({ changes: dragChanges });
    updateUndoBtn();
    refreshClueSatisfaction();
    checkWin();
  }
  dragChanges = null;
  dragMode = null;
}

// Light per-cell refresh during a drag (cheap); full check on pointer-up.
function afterCellChange(r, c) {
  const strip = document.querySelector(`.row-clue[data-row="${r}"]`);
  if (strip && getSetting('nonogram', 'autoDisable')) {
    strip.classList.toggle('done', lineMatchesClue(userGrid[r], rowClues[r]));
  }
  const cstrip = document.querySelector(`.col-clue[data-col="${c}"]`);
  if (cstrip && getSetting('nonogram', 'autoDisable')) {
    const col = userGrid.map(row => row[c]);
    cstrip.classList.toggle('done', lineMatchesClue(col, colClues[c]));
  }
}

/* ── UNDO ── */
function undoMove() {
  if (undoStack.length === 0 || paused || revealed) return;
  const m = undoStack.pop();
  for (let i = m.changes.length - 1; i >= 0; i--) {
    const { r, c, prev } = m.changes[i];
    userGrid[r][c] = prev;
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

  // Slide 2: tap to fill / mark
  document.getElementById('tutVis2').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;">
      ${miniGrid(['0'])}
      <span style="color:var(--text-dim);">→</span>
      ${miniGrid(['1'])}
      <span style="color:var(--text-dim);">→</span>
      ${miniGrid(['x'])}
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
// Resolve a cell to its TRUE value (filled or marked-blank) as a hint.
function revealHintCell(r, c) {
  const want = solution[r][c] === 1 ? FILLED : MARK;
  const prev = userGrid[r][c];
  if (prev !== want) {
    undoStack.push({ changes: [{ r, c, prev }] });
    updateUndoBtn();
  }
  userGrid[r][c] = want;
  renderCell(r, c);
  getCellEl(r, c).classList.add('hint-cell');
  refreshClueSatisfaction();
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

/* ── POINTER WIRING (delegated on the board) ── */
function initPointerHandlers() {
  const board = document.getElementById('board');

  board.addEventListener('pointerdown', e => {
    const cell = e.target.closest('.nono-cell');
    if (!cell) return;
    e.preventDefault();
    const r = +cell.dataset.row, c = +cell.dataset.col;
    setSelected(r, c);
    // Don't capture on the board — capturing breaks pointerenter on siblings.
    pointerDownCell(r, c);
  });

  board.addEventListener('pointerover', e => {
    if (!dragging) return;
    const cell = e.target.closest('.nono-cell');
    if (!cell) return;
    pointerEnterCell(+cell.dataset.row, +cell.dataset.col);
  });

  // End the drag anywhere.
  document.addEventListener('pointerup', pointerUp);
  document.addEventListener('pointercancel', pointerUp);
}

/* ── KEYBOARD ── */
document.addEventListener('keydown', e => {
  if (paused || revealed) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoMove(); return; }
  if (!selectedCell) return;
  const { row, col } = selectedCell;
  // Space / F fills, X marks, Backspace clears
  if (e.key === ' ' || e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    const v = userGrid[row][col] === FILLED ? EMPTY : FILLED;
    undoStack.push({ changes: [{ r: row, c: col, prev: userGrid[row][col] }] });
    userGrid[row][col] = v; renderCell(row, col); updateUndoBtn();
    refreshClueSatisfaction(); checkWin();
  }
  if (e.key === 'x' || e.key === 'X') {
    const v = userGrid[row][col] === MARK ? EMPTY : MARK;
    undoStack.push({ changes: [{ r: row, c: col, prev: userGrid[row][col] }] });
    userGrid[row][col] = v; renderCell(row, col); updateUndoBtn();
    refreshClueSatisfaction();
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
