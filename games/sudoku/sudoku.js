/* ═══ TUTORIAL ═══ */
const TUT_TOTAL = 6;
let tutSlide = 0, wasPausedBefore = false;

function buildTutVisuals() {
  const v1 = document.getElementById('tutVis1');
  const sample = [
    [5,3,0,0,7,0,0,0,0],[6,0,0,1,9,5,0,0,0],[0,9,8,0,0,0,0,6,0],
    [8,0,0,0,6,0,0,0,3],[4,0,0,8,0,3,0,0,1],[7,0,0,0,2,0,0,0,6],
    [0,6,0,0,0,0,2,8,0],[0,0,0,4,1,9,0,0,5],[0,0,0,0,8,0,0,7,9]
  ];
  let h = '<div class="tut-grid g9">';
  for(let r=0;r<9;r++) for(let c=0;c<9;c++){
    const v=sample[r][c];
    let cls = v ? ' tg-clue' : '';
    if(c===2||c===5) cls += ' tg-br';
    if(r===2||r===5) cls += ' tg-bb';
    h+=`<div class="tg-cell${cls}">${v||''}</div>`;
  }
  v1.innerHTML = h+'</div>';

  const v2 = document.getElementById('tutVis2');
  let h2 = '<div style="display:flex;flex-direction:column;gap:12px;align-items:center;">';
  h2 += '<div style="display:flex;gap:2px;">';
  for(let i=1;i<=9;i++) h2+=`<div class="tg-cell tg-clue tg-hl" style="width:24px;height:24px;font-size:0.55rem;">${i}</div>`;
  h2 += '</div><div style="font-size:0.65rem;color:var(--text-dim);">Each row = 1–9</div>';
  h2 += '<div style="display:flex;flex-direction:column;gap:2px;">';
  for(let i=1;i<=9;i++) h2+=`<div class="tg-cell tg-clue tg-hl" style="width:24px;height:24px;font-size:0.55rem;">${i}</div>`;
  h2 += '</div><div style="font-size:0.65rem;color:var(--text-dim);">Each column = 1–9</div>';
  h2 += '</div>';
  v2.innerHTML = h2;

  const v3 = document.getElementById('tutVis3');
  const selR=4, selC=4;
  const boxR=3, boxC=3;
  let h3 = '<div class="tut-grid g9">';
  for(let r=0;r<9;r++) for(let c=0;c<9;c++){
    const v=sample[r][c];
    const isSel = r===selR&&c===selC;
    const isHl = !isSel && (r===selR||c===selC||(r>=boxR&&r<boxR+3&&c>=boxC&&c<boxC+3));
    let cls = v ? ' tg-clue' : '';
    if(isSel) cls += ' tg-sel';
    if(isHl) cls += ' tg-hl';
    if(c===2||c===5) cls += ' tg-br';
    if(r===2||r===5) cls += ' tg-bb';
    h3+=`<div class="tg-cell${cls}">${v||''}</div>`;
  }
  v3.innerHTML = h3+'</div>';

  const v4 = document.getElementById('tutVis4');
  const elimRow = [1,3,4,5,6,7,8,9,0];
  let h4 = '<div style="display:flex;flex-direction:column;gap:10px;align-items:center;">';
  h4 += '<div style="display:flex;gap:2px;">';
  for(let i=0;i<9;i++){
    const v = elimRow[i];
    if(v) h4+=`<div class="tg-cell tg-clue tg-hl" style="width:28px;height:28px;font-size:0.6rem;">${v}</div>`;
    else h4+=`<div class="tg-cell tg-q tg-sel" style="width:28px;height:28px;">?</div>`;
  }
  h4 += '</div><div style="display:flex;align-items:center;gap:6px;margin-top:4px;">';
  h4 += '<span style="font-size:0.7rem;color:var(--text-dim);">Missing:</span>';
  h4 += '<span style="font-family:JetBrains Mono;font-size:0.85rem;font-weight:700;color:var(--blue);">2</span>';
  h4 += '</div></div>';
  v4.innerHTML = h4;

  const v5 = document.getElementById('tutVis5');
  let h5 = '<div class="tut-grid g9">';
  for(let r=0;r<9;r++) for(let c=0;c<9;c++){
    const v=sample[r][c];
    const is7 = v===7;
    let cls = v ? ' tg-clue' : '';
    if(is7) cls += ' tg-bold';
    if(c===2||c===5) cls += ' tg-br';
    if(r===2||r===5) cls += ' tg-bb';
    h5+=`<div class="tg-cell${cls}">${v||''}</div>`;
  }
  v5.innerHTML = h5+'</div>';

  const v6 = document.getElementById('tutVis6');
  let h6 = '<div style="display:flex;flex-direction:column;gap:12px;align-items:center;">';
  h6 += '<div style="display:flex;gap:2px;">';
  const errRow = [{v:5,c:'tg-clue'},{v:3,c:'tg-clue'},{v:4,c:'tg-user'},{v:6,c:'tg-user'},{v:7,c:'tg-clue'},{v:9,c:'tg-err'},{v:1,c:'tg-user'},{v:8,c:'tg-err'},{v:2,c:'tg-user'}];
  for(const cell of errRow) h6+=`<div class="tg-cell ${cell.c}" style="width:28px;height:28px;font-size:0.6rem;">${cell.v}</div>`;
  h6 += '</div>';
  h6 += '<div style="display:flex;align-items:center;gap:8px;font-size:0.7rem;color:var(--text-dim);">';
  h6 += '<span style="color:var(--pink);">● wrong</span>';
  h6 += '<span style="color:var(--blue);">● filled</span>';
  h6 += '<span style="color:rgba(255,255,255,0.85);">● clue</span>';
  h6 += '</div></div>';
  v6.innerHTML = h6;
}

function buildTutDots() {
  const d = document.getElementById('tutDots'); d.innerHTML = '';
  for(let i=0;i<TUT_TOTAL;i++) d.innerHTML += `<div class="tut-dot${i===0?' active':''}" data-i="${i}"></div>`;
}

function tutNav(dir) {
  tutSlide += dir;
  if (tutSlide >= TUT_TOTAL) { closeTutorial(); return; }
  if (tutSlide < 0) tutSlide = 0;
  updateTutSlide();
}

function updateTutSlide() {
  document.querySelectorAll('.tut-slide').forEach((s,i) => s.classList.toggle('active', i===tutSlide));
  document.querySelectorAll('.tut-dot').forEach((d,i) => d.classList.toggle('active', i===tutSlide));
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

/* ═══ GAME LOGIC ═══ */
const DIFFICULTIES = { easy:{label:'Easy',clues:38,dot:'easy'}, medium:{label:'Medium',clues:30,dot:'medium'}, hard:{label:'Hard',clues:24,dot:'hard'} };
let solution=[],puzzle=[],userGrid=[],clueMap=[],selectedCell=null;
let timerInterval=null,seconds=0,paused=false,currentDifficulty='easy',revealed=false;
let undoStack=[],errorCells=new Set();

const COIN_REWARDS = { easy: 3, medium: 6, hard: 10 };

function fmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}

function updateCoinUI() {
  const c = getCoins();
  document.getElementById('homeCoinCount').textContent = c;
  document.getElementById('gameCoinCount').textContent = c;
}

function showDailyOverlay(reward, streak, totalCoins) {
  const profile = loadProfile();
  document.getElementById('dailyOverlayTitle').textContent =
    profile.totalSolved === 0 ? 'Hello!' : 'Welcome back!';
  document.getElementById('dailyOverlayStreak').textContent =
    streak > 1 ? `🔥 ${streak}-day streak` : '';
  document.getElementById('dailyOverlayBalance').textContent = totalCoins;

  /* count-up the reward amount */
  const amountEl = document.getElementById('dailyOverlayAmount');
  amountEl.textContent = '0';
  let current = 0;
  const duration = 600;
  const steps = 20;
  const increment = reward / steps;
  const interval = duration / steps;
  const counter = setInterval(() => {
    current = Math.min(current + increment, reward);
    amountEl.textContent = Math.round(current);
    if (current >= reward) clearInterval(counter);
  }, interval);

  document.getElementById('dailyOverlay').classList.add('active');
}

function dismissDailyOverlay() {
  document.getElementById('dailyOverlay').classList.remove('active');
}

function buildHome(){
  const el=document.getElementById('diffSelect');el.innerHTML='';
  for(const[k,cfg]of Object.entries(DIFFICULTIES)){
    const btn=document.createElement('button');btn.className='diff-btn';
    const best=getBestTime('sudoku',k);
    const bs=best?`<span class="best-badge">Best ${fmt(best)}</span>`:'';
    btn.innerHTML=`<div class="diff-label"><span class="diff-dot ${cfg.dot}"></span>${cfg.label}</div><div class="diff-meta">${bs}</div>`;
    btn.onclick=()=>startGame(k);el.appendChild(btn);
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
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
function cancelAnyModal(){document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active'));paused=false;}
function confirmHome(){if(revealed){doGoHome();return;}paused=true;document.getElementById('confirmModal').classList.add('active');}
function doGoHome(){document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active'));clearInterval(timerInterval);revealed=false;buildHome();showScreen('home');}
function confirmGiveUp(){if(revealed)return;paused=true;document.getElementById('giveUpModal').classList.add('active');}
function confirmRestart(){if(revealed)return;paused=true;document.getElementById('restartModal').classList.add('active');}

function doRestart(){document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active'));userGrid=puzzle.map(r=>[...r]);undoStack=[];errorCells=new Set();selectedCell=null;revealed=false;document.getElementById('picker').classList.remove('visible');updateUndoBtn();buildGrid();clearInterval(timerInterval);startTimer();}

function doGiveUp(){
  document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active'));
  clearInterval(timerInterval);revealed=true;paused=true;
  document.getElementById('picker').classList.remove('visible');
  document.getElementById('btnFinish').disabled=true;
  ['btnGiveUp','btnPause','btnRestart','btnUndo','btnInfo','btnHint'].forEach(id=>document.getElementById(id).style.display='none');
  selectedCell=null;
  document.querySelectorAll('.cell').forEach(c=>c.classList.remove('selected','constrained','same-number','error-cell'));
  let cc=0,wc=0,ec=0;
  for(let r=0;r<9;r++)for(let c=0;c<9;c++){if(clueMap[r][c])continue;const el=getCellEl(r,c),uv=userGrid[r][c],sv=solution[r][c];el.classList.remove('user-filled');if(uv===0){el.textContent=sv;el.classList.add('reveal-filled');ec++;}else if(uv===sv){el.classList.add('reveal-correct');cc++;}else{el.textContent=sv;el.classList.add('reveal-wrong');wc++;}}
  const t=cc+wc+ec;
  document.getElementById('revealStats').innerHTML=`<span class="g">✓ ${cc} correct</span> · <span class="r">✕ ${wc} wrong</span> · <span class="r">○ ${ec} empty</span><br>out of ${t} cells to fill`;
  document.getElementById('revealedBar').classList.add('active');
}

function startTimer(){seconds=0;paused=false;clearInterval(timerInterval);updateTimer();timerInterval=setInterval(()=>{if(!paused){seconds++;updateTimer();}},1000);}
function updateTimer(){document.getElementById('timer').textContent=fmt(seconds);}

function togglePause(){if(revealed)return;paused=!paused;document.getElementById('pauseOverlay').classList.toggle('active',paused);document.querySelectorAll('.cell').forEach(c=>c.classList.toggle('hidden-cell',paused));document.getElementById('pauseIcon').innerHTML=paused?'<polygon points="6,4 20,12 6,20"/>':'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';if(paused){document.getElementById('picker').classList.remove('visible');selectedCell=null;document.querySelectorAll('.cell').forEach(c=>c.classList.remove('selected','constrained','same-number'));}}

function undoMove(){if(undoStack.length===0||paused||revealed)return;const m=undoStack.pop();userGrid[m.row][m.col]=m.prevVal;const el=getCellEl(m.row,m.col);el.textContent=m.prevVal===0?'':m.prevVal;el.classList.remove('user-filled','error-cell');errorCells.delete(`${m.row},${m.col}`);if(m.prevVal!==0)el.classList.add('user-filled');updateUndoBtn();selectCell(m.row,m.col);}
function updateUndoBtn(){document.getElementById('btnUndo').disabled=undoStack.length===0;}

function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function isValid(b,r,c,n){for(let i=0;i<9;i++)if(b[r][i]===n||b[i][c]===n)return false;const br=Math.floor(r/3)*3,bc=Math.floor(c/3)*3;for(let rr=br;rr<br+3;rr++)for(let cc=bc;cc<bc+3;cc++)if(b[rr][cc]===n)return false;return true;}
function generateSolution(){const b=Array.from({length:9},()=>Array(9).fill(0));function solve(b){for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(b[r][c]===0){for(const n of shuffle([1,2,3,4,5,6,7,8,9]))if(isValid(b,r,c,n)){b[r][c]=n;if(solve(b))return true;b[r][c]=0;}return false;}return true;}solve(b);return b;}
function countSolutions(board,limit){let count=0;function solve(b){if(count>=limit)return;for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(b[r][c]===0){for(let n=1;n<=9;n++)if(isValid(b,r,c,n)){b[r][c]=n;solve(b);b[r][c]=0;if(count>=limit)return;}return;}count++;}solve(board);return count;}
function generatePuzzle(sol,numClues){const p=sol.map(r=>[...r]);const cells=shuffle([...Array(81).keys()]);let rem=0;const target=81-numClues;for(const idx of cells){if(rem>=target)break;const r=Math.floor(idx/9),c=idx%9;const bk=p[r][c];p[r][c]=0;if(countSolutions(p.map(r=>[...r]),2)!==1)p[r][c]=bk;else rem++;}return p;}

function startGame(diff){
  currentDifficulty=diff;revealed=false;undoStack=[];errorCells=new Set();
  document.getElementById('loading').classList.add('active');
  setTimeout(()=>{
    solution=generateSolution();puzzle=generatePuzzle(solution,DIFFICULTIES[diff].clues);
    userGrid=puzzle.map(r=>[...r]);clueMap=puzzle.map(r=>r.map(v=>v!==0));selectedCell=null;
    const tag=document.getElementById('diffTag');tag.textContent=DIFFICULTIES[diff].label;tag.className='diff-tag '+diff;
    document.getElementById('btnFinish').disabled=false;
    ['btnGiveUp','btnPause','btnRestart','btnUndo','btnInfo','btnHint'].forEach(id=>document.getElementById(id).style.display='');
    document.getElementById('revealedBar').classList.remove('active');
    updateUndoBtn();buildGrid();
    document.getElementById('loading').classList.remove('active');
    showScreen('game');startTimer();updateCoinUI();
    document.getElementById('picker').classList.remove('visible');
    document.getElementById('pauseOverlay').classList.remove('active');
    document.getElementById('pauseIcon').innerHTML='<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
  },50);
}

function buildGrid(){const g=document.getElementById('grid');g.innerHTML='';for(let r=0;r<9;r++)for(let c=0;c<9;c++){const d=document.createElement('div');d.className='cell';d.dataset.row=r;d.dataset.col=c;if(clueMap[r][c]){d.classList.add('clue');d.textContent=puzzle[r][c];}d.addEventListener('click',()=>selectCell(r,c));g.appendChild(d);}}

function selectCell(row,col){
  if(paused||revealed)return;
  document.querySelectorAll('.cell').forEach(c=>c.classList.remove('selected','constrained','same-number'));
  getCellEl(row,col).classList.add('selected');
  const br=Math.floor(row/3)*3,bc=Math.floor(col/3)*3;
  for(let r=0;r<9;r++)for(let c=0;c<9;c++){if(r===row&&c===col)continue;if(r===row||c===col||(r>=br&&r<br+3&&c>=bc&&c<bc+3))getCellEl(r,c).classList.add('constrained');}
  const val=userGrid[row][col];
  if(val!==0)for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(userGrid[r][c]===val)getCellEl(r,c).classList.add('same-number');
  if(clueMap[row][col]){selectedCell=null;document.getElementById('picker').classList.remove('visible');}
  else{selectedCell={row,col};document.getElementById('picker').classList.add('visible');}
}
function getCellEl(r,c){return document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);}

function placeNumber(num){
  if(!selectedCell||paused||revealed)return;
  const{row,col}=selectedCell;if(clueMap[row][col])return;
  const prev=userGrid[row][col];if(prev===num)return;
  undoStack.push({row,col,prevVal:prev});updateUndoBtn();
  userGrid[row][col]=num;const el=getCellEl(row,col);
  el.textContent=num===0?'':num;
  el.classList.remove('error-cell');errorCells.delete(`${row},${col}`);
  el.classList.toggle('user-filled',num!==0);
  document.querySelectorAll('.cell').forEach(c=>c.classList.remove('same-number'));
  if(num!==0)for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(userGrid[r][c]===num)getCellEl(r,c).classList.add('same-number');
}

/* ═══ HINTS ═══ */
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
  document.getElementById('hintChosen').querySelector('.hint-option-desc').textContent =
    hasSelected ? 'Reveals the cell you have selected.' : 'Select an empty cell first, then come back.';
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
  const el = getCellEl(row, col);
  el.textContent = val;
  el.classList.remove('user-filled', 'error-cell');
  errorCells.delete(`${row},${col}`);
  el.classList.add('hint-revealed');
  updateCoinUI();
}

function useRandomHint() {
  if (!spendCoins(HINT_COST_RANDOM)) return;
  closeHintShop();
  const empty = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    if (!clueMap[r][c] && userGrid[r][c] === 0) empty.push([r, c]);
  }
  if (empty.length === 0) return;
  const [r, c] = empty[Math.floor(Math.random() * empty.length)];
  revealCell(r, c);
  selectCell(r, c);
}

function useChosenHint() {
  if (!selectedCell) return;
  if (!spendCoins(HINT_COST_CHOSEN)) return;
  closeHintShop();
  const { row, col } = selectedCell;
  revealCell(row, col);
  selectCell(row, col);
}

function checkSolution(){
  if(paused||revealed)return;clearInterval(timerInterval);
  for(let r=0;r<9;r++)for(let c=0;c<9;c++)if(userGrid[r][c]===0){showModal('incomplete');return;}
  let hasErr=false;
  errorCells.forEach(k=>{const[r,c]=k.split(',').map(Number);getCellEl(r,c).classList.remove('error-cell');});
  errorCells=new Set();
  for(let r=0;r<9;r++)for(let c=0;c<9;c++){if(clueMap[r][c])continue;if(userGrid[r][c]!==solution[r][c]){hasErr=true;errorCells.add(`${r},${c}`);getCellEl(r,c).classList.add('error-cell');}}
  showModal(hasErr?'errors':'success');
}

function showModal(type){
  const modal=document.getElementById('modal'),icon=document.getElementById('modal-icon'),title=document.getElementById('modal-title'),text=document.getElementById('modal-text'),bestEl=document.getElementById('modal-best'),actions=document.getElementById('modal-actions');
  bestEl.style.display='none';actions.innerHTML='';
  if(type==='success'){
    const isNew=submitBestTime('sudoku',currentDifficulty,seconds);
    const reward=COIN_REWARDS[currentDifficulty]||3;
    addCoins(reward);
    icon.textContent='✦';icon.style.color='var(--pink)';title.textContent='Brilliant!';
    text.textContent=`Solved in ${fmt(seconds)}.`;
    bestEl.style.display='block';
    bestEl.innerHTML=`<div class="coin-reward-row"><span class="coin-earned-label">+<span id="coinCountUp">0</span> ◈ earned</span></div>${isNew?'<div class="new-best-line">★ New best time!</div>':''}`;
    actions.innerHTML=`<button class="btn-primary" onclick="closeModal();startGame('${currentDifficulty}')">Play Again</button><button class="btn-secondary" onclick="closeModal();doGoHome()">Home</button>`;
    /* count-up animation */
    let cur=0;
    const steps=20, duration=700, inc=reward/steps;
    const countEl=document.getElementById('coinCountUp');
    const iv=setInterval(()=>{
      cur=Math.min(cur+inc,reward);
      countEl.textContent=Math.round(cur);
      if(cur>=reward){clearInterval(iv);updateCoinUI();}
    },duration/steps);
  }
  else if(type==='incomplete'){icon.textContent='○';icon.style.color='var(--text-dim)';title.textContent='Not Done Yet';text.textContent='Some cells are still empty.';actions.innerHTML=`<button class="btn-primary" onclick="closeModal();resumeTimer()">Continue</button>`;}
  else if(type==='errors'){icon.textContent='✕';icon.style.color='var(--error)';title.textContent='Not Quite';text.textContent='Some values are incorrect. The wrong cells are highlighted.';actions.innerHTML=`<button class="btn-primary" onclick="closeModal();resumeTimer()">Try Again</button>`;}
  modal.classList.add('active');
}
function closeModal(){document.getElementById('modal').classList.remove('active');}
function resumeTimer(){timerInterval=setInterval(()=>{if(!paused){seconds++;updateTimer();}},1000);}

document.addEventListener('keydown',(e)=>{if(paused||revealed)return;if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undoMove();return;}if(!selectedCell)return;const n=parseInt(e.key);if(n>=1&&n<=9)placeNumber(n);if(e.key==='Backspace'||e.key==='Delete')placeNumber(0);});

buildHome();
buildTutDots();
buildTutVisuals();
updateTutSlide();

/* Daily reward — runs once per calendar day */
const daily = claimDailyReward();
if (daily.awarded) {
  updateCoinUI();
  showDailyOverlay(daily.reward, daily.streak, daily.coins);
}
