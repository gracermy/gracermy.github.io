/* ═══════════════════════════════════════════════════
   WORDLE.JS  —  Endless mode
   ═══════════════════════════════════════════════════ */

const WORD_LEN = 5;
const MAX_GUESSES = 6;
const COIN_REWARDS = [30, 20, 12, 7, 4, 2]; // by guess count (1..6)

/* ── STATE ── */
let answers = null;            // Set<string>
let answersList = [];          // for random pick
let guesses = null;            // Set<string>
let targetWord = '';
let currentRow = 0;
let currentCol = 0;
let board = [];                // 6 rows × 5 letters (uppercase) or ''
let evaluations = [];          // 6 rows × 5 of 'green'|'yellow'|'grey'|''
let keyState = {};             // letter → 'green'|'yellow'|'grey'
let gameOver = false;
let revealedByGiveUp = false;
let wasPausedBefore = false;

/* ── WORD LIST LOADING ── */
let wordsLoadedPromise = null;
function loadWords() {
  if (wordsLoadedPromise) return wordsLoadedPromise;
  wordsLoadedPromise = (async () => {
    const [aRes, gRes] = await Promise.all([
      fetch('words/answers.json'),
      fetch('words/guesses.json'),
    ]);
    const aData = await aRes.json();
    const gData = await gRes.json();
    // Unpack concatenated word strings
    answersList = [];
    for (let i = 0; i < aData.words.length; i += WORD_LEN) {
      answersList.push(aData.words.slice(i, i + WORD_LEN));
    }
    answers = new Set(answersList);
    const guessesList = [];
    for (let i = 0; i < gData.words.length; i += WORD_LEN) {
      guessesList.push(gData.words.slice(i, i + WORD_LEN));
    }
    guesses = new Set(guessesList);
  })();
  return wordsLoadedPromise;
}

/* ── COIN UI ── */
function updateCoinUI() {
  const c = getCoins();
  document.getElementById('homeCoinCount').textContent = c;
  document.getElementById('gameCoinCount').textContent = c;
}

/* ── DAILY OVERLAY (shared coin/streak system) ── */
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
  const stats = document.getElementById('bestStats');
  const best = getBestTime('wordle', 'endless'); // stored as best guess count
  stats.innerHTML = best
    ? `Best: <span class="stat-num">${best}</span> ${best === 1 ? 'guess' : 'guesses'}`
    : '';
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
}
function confirmHome() {
  if (gameOver) { doGoHome(); return; }
  document.getElementById('confirmModal').classList.add('active');
}
function doGoHome() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  buildHome();
  showScreen('home');
}
function confirmGiveUp() {
  if (gameOver) return;
  document.getElementById('giveUpModal').classList.add('active');
}
function doGiveUp() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  gameOver = true;
  revealedByGiveUp = true;
  showLossModal();
}

/* ── GAME START ── */
async function startGame() {
  document.getElementById('loading').classList.add('active');
  try {
    await loadWords();
  } catch (err) {
    document.getElementById('loading').classList.remove('active');
    alert('Could not load word list. Please refresh and try again.');
    return;
  }

  // Pick a random target word
  targetWord = answersList[Math.floor(Math.random() * answersList.length)];

  // Reset state
  currentRow = 0; currentCol = 0;
  board = Array.from({ length: MAX_GUESSES }, () => Array(WORD_LEN).fill(''));
  evaluations = Array.from({ length: MAX_GUESSES }, () => Array(WORD_LEN).fill(''));
  keyState = {};
  gameOver = false;
  revealedByGiveUp = false;

  buildBoard();
  buildKeyboard();
  document.getElementById('messageArea').innerHTML = '';
  document.getElementById('loading').classList.remove('active');
  showScreen('game');
  updateCoinUI();
}

/* ── BOARD RENDER ── */
function buildBoard() {
  const b = document.getElementById('board');
  b.innerHTML = '';
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement('div');
    row.className = 'board-row'; row.dataset.row = r;
    for (let c = 0; c < WORD_LEN; c++) {
      const t = document.createElement('div');
      t.className = 'tile'; t.dataset.row = r; t.dataset.col = c;
      row.appendChild(t);
    }
    b.appendChild(row);
  }
}

function getTile(r, c) {
  return document.querySelector(`.tile[data-row="${r}"][data-col="${c}"]`);
}

/* ── KEYBOARD RENDER ── */
const KBD_ROWS = [
  'QWERTYUIOP'.split(''),
  'ASDFGHJKL'.split(''),
  ['ENTER', ...'ZXCVBNM'.split(''), 'BACK'],
];

function buildKeyboard() {
  const k = document.getElementById('keyboard');
  k.innerHTML = '';
  for (const row of KBD_ROWS) {
    const r = document.createElement('div');
    r.className = 'kbd-row';
    for (const key of row) {
      const btn = document.createElement('button');
      btn.className = 'key';
      if (key === 'ENTER' || key === 'BACK') btn.classList.add('wide');
      btn.dataset.key = key;
      btn.textContent = key === 'BACK' ? '⌫' : key;
      btn.addEventListener('click', () => handleKeyInput(key));
      r.appendChild(btn);
    }
    k.appendChild(r);
  }
  refreshKeyboardColors();
}

function refreshKeyboardColors() {
  document.querySelectorAll('.key').forEach(btn => {
    btn.classList.remove('green', 'yellow', 'grey');
    const ch = btn.dataset.key;
    if (ch && ch.length === 1 && keyState[ch]) {
      btn.classList.add(keyState[ch]);
    }
  });
}

/* ── INPUT HANDLING ── */
function handleKeyInput(key) {
  if (gameOver) return;
  if (key === 'ENTER') return submitGuess();
  if (key === 'BACK' || key === 'BACKSPACE') return deleteLetter();
  if (/^[A-Z]$/.test(key)) return addLetter(key);
}

function addLetter(letter) {
  if (currentCol >= WORD_LEN) return;
  board[currentRow][currentCol] = letter;
  const t = getTile(currentRow, currentCol);
  t.textContent = letter;
  t.classList.add('filled');
  currentCol++;
}

function deleteLetter() {
  if (currentCol === 0) return;
  currentCol--;
  board[currentRow][currentCol] = '';
  const t = getTile(currentRow, currentCol);
  t.textContent = '';
  t.classList.remove('filled');
}

function showToast(msg, ms = 1400) {
  const area = document.getElementById('messageArea');
  area.innerHTML = `<span class="toast">${msg}</span>`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { area.innerHTML = ''; }, ms);
}

function shakeRow(r) {
  for (let c = 0; c < WORD_LEN; c++) {
    const t = getTile(r, c);
    t.classList.add('shake');
    setTimeout(() => t.classList.remove('shake'), 420);
  }
}

/* ── GUESS SUBMISSION ── */
function submitGuess() {
  if (currentCol < WORD_LEN) {
    showToast('Not enough letters'); shakeRow(currentRow); return;
  }
  const word = board[currentRow].join('').toLowerCase();
  if (!guesses.has(word) && !answers.has(word)) {
    showToast('Not in word list'); shakeRow(currentRow); return;
  }

  // Evaluate
  const target = targetWord;
  const result = Array(WORD_LEN).fill('grey');
  const targetChars = target.split('');
  const guessChars = word.split('');

  // First pass: greens
  for (let i = 0; i < WORD_LEN; i++) {
    if (guessChars[i] === targetChars[i]) {
      result[i] = 'green';
      targetChars[i] = null; // consumed
    }
  }
  // Second pass: yellows
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] !== 'green') {
      const idx = targetChars.indexOf(guessChars[i]);
      if (idx !== -1) {
        result[i] = 'yellow';
        targetChars[idx] = null;
      }
    }
  }
  evaluations[currentRow] = result;

  // Animate the row reveal
  for (let i = 0; i < WORD_LEN; i++) {
    const t = getTile(currentRow, i);
    setTimeout(() => {
      t.classList.add('flip');
      setTimeout(() => {
        t.classList.add(result[i]);
        t.classList.remove('filled');
      }, 250); // mid-flip
    }, i * 250);
  }

  // After all flips: update keyboard colors, check win/loss
  setTimeout(() => {
    // Update key state — only upgrade priority green > yellow > grey
    const priority = { green: 3, yellow: 2, grey: 1 };
    for (let i = 0; i < WORD_LEN; i++) {
      const letter = board[currentRow][i].toUpperCase();
      const newStatus = result[i];
      if (!keyState[letter] || priority[newStatus] > priority[keyState[letter]]) {
        keyState[letter] = newStatus;
      }
    }
    refreshKeyboardColors();

    if (result.every(r => r === 'green')) {
      gameOver = true;
      // Let the final tile's green be seen before the modal covers it.
      setTimeout(showWinModal, 600);
      return;
    }
    currentRow++;
    currentCol = 0;
    if (currentRow >= MAX_GUESSES) {
      gameOver = true;
      showLossModal();
    }
  }, WORD_LEN * 250 + 100);
}

/* ── MODALS ── */
function showWinModal() {
  const guessCount = currentRow + 1;
  const reward = COIN_REWARDS[guessCount - 1] || 2;
  addCoins(reward);
  const isNew = submitBestTime('wordle', 'endless', guessCount);

  const modal = document.getElementById('modal');
  document.getElementById('modal-icon').textContent = '✦';
  document.getElementById('modal-icon').style.color = 'var(--tile-yellow)';
  document.getElementById('modal-title').textContent = 'Brilliant!';
  document.getElementById('modal-text').textContent =
    `Solved in ${guessCount} ${guessCount === 1 ? 'guess' : 'guesses'}.`;
  const bestEl = document.getElementById('modal-best');
  bestEl.style.display = 'block';
  bestEl.innerHTML = `
    <div class="coin-reward-row">
      <span class="coin-earned-label">+<span id="coinCountUp">0</span>
      <img src="../sudoku/icons/coin.svg" class="coin-icon-img coin-icon-lg" alt="coins"> earned</span>
    </div>
    ${isNew ? '<div class="new-best-line">★ New best!</div>' : ''}`;
  document.getElementById('modal-actions').innerHTML = `
    <button class="btn-primary" onclick="closeModal();startGame()">Play Again</button>
    <button class="btn-share" onclick="shareResult()">Share</button>
    <button class="btn-secondary" onclick="closeModal();doGoHome()">Home</button>`;

  // Count-up animation
  let cur = 0;
  const steps = 20, duration = 700, inc = reward / steps;
  const countEl = document.getElementById('coinCountUp');
  const iv = setInterval(() => {
    cur = Math.min(cur + inc, reward);
    countEl.textContent = Math.round(cur);
    if (cur >= reward) { clearInterval(iv); updateCoinUI(); }
  }, duration / steps);

  modal.classList.add('active');
}

function showLossModal() {
  const modal = document.getElementById('modal');
  document.getElementById('modal-icon').textContent = revealedByGiveUp ? '⚑' : '✕';
  document.getElementById('modal-icon').style.color = 'var(--error)';
  document.getElementById('modal-title').textContent = revealedByGiveUp ? 'Revealed' : 'Out of guesses';
  document.getElementById('modal-text').innerHTML =
    `The word was<div class="reveal-word">${targetWord}</div>`;
  document.getElementById('modal-best').style.display = 'none';
  document.getElementById('modal-actions').innerHTML = `
    <button class="btn-primary" onclick="closeModal();startGame()">Try Again</button>
    <button class="btn-secondary" onclick="closeModal();doGoHome()">Home</button>`;
  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('modal').classList.remove('active');
}

/* ── SHARE ── */
function shareResult() {
  const lines = [];
  const guessCount = currentRow + 1;
  lines.push(`Wordle · gracermy.github.io  ${guessCount}/${MAX_GUESSES}`);
  lines.push('');
  for (let r = 0; r <= currentRow; r++) {
    let s = '';
    for (let c = 0; c < WORD_LEN; c++) {
      const e = evaluations[r][c];
      s += e === 'green' ? '🟩' : e === 'yellow' ? '🟨' : '⬛';
    }
    lines.push(s);
  }
  const text = lines.join('\n');

  // Mobile: open the OS share sheet. Desktop: copy to clipboard.
  if (navigator.share) {
    navigator.share({ text }).catch(() => {/* user cancelled — ignore */});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied to clipboard'),
      () => showToast('Could not copy')
    );
  } else {
    showToast('Clipboard not available');
  }
}

/* ── TUTORIAL ── */
const TUT_TOTAL = 4;
let tutSlide = 0;

function buildTutVisuals() {
  // Slide 1: six empty rows
  let h = '<div style="display:flex;flex-direction:column;gap:4px;">';
  for (let r = 0; r < 3; r++) {
    h += '<div class="tut-tile-row">';
    for (let c = 0; c < WORD_LEN; c++) h += '<div class="tut-tile empty"></div>';
    h += '</div>';
  }
  h += '</div>';
  document.getElementById('tutVis1').innerHTML = h;

  // Slide 2: green example — guess "PEACH" with target "PEACE"
  document.getElementById('tutVis2').innerHTML = `
    <div class="tut-tile-row">
      <div class="tut-tile green">P</div>
      <div class="tut-tile green">E</div>
      <div class="tut-tile green">A</div>
      <div class="tut-tile green">C</div>
      <div class="tut-tile grey">H</div>
    </div>`;

  // Slide 3: yellow example
  document.getElementById('tutVis3').innerHTML = `
    <div class="tut-tile-row">
      <div class="tut-tile grey">T</div>
      <div class="tut-tile yellow">R</div>
      <div class="tut-tile yellow">A</div>
      <div class="tut-tile grey">D</div>
      <div class="tut-tile grey">E</div>
    </div>`;

  // Slide 4: grey example
  document.getElementById('tutVis4').innerHTML = `
    <div class="tut-tile-row">
      <div class="tut-tile grey">B</div>
      <div class="tut-tile grey">L</div>
      <div class="tut-tile green">A</div>
      <div class="tut-tile grey">N</div>
      <div class="tut-tile grey">D</div>
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
  tutSlide = 0; updateTutSlide();
  document.getElementById('tutorial').classList.add('active');
}
function closeTutorial() {
  document.getElementById('tutorial').classList.remove('active');
}

/* ── HARDWARE KEYBOARD ── */
document.addEventListener('keydown', e => {
  if (gameOver) return;
  if (document.getElementById('tutorial').classList.contains('active')) return;
  if (document.querySelector('.modal-overlay.active')) return;
  if (!document.getElementById('game').classList.contains('active')) return;

  if (e.key === 'Enter') { e.preventDefault(); handleKeyInput('ENTER'); return; }
  if (e.key === 'Backspace') { e.preventDefault(); handleKeyInput('BACK'); return; }
  if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    handleKeyInput(e.key.toUpperCase());
  }
});

/* ── INIT ── */
buildHome();
buildTutDots();
buildTutVisuals();
updateTutSlide();

const daily = claimDailyReward();
if (daily.awarded) {
  updateCoinUI();
  showDailyOverlay(daily.reward, daily.streak, daily.coins, daily.schedule);
}
