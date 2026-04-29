/* ═══════════════════════════════════════
   FILTER PIPELINE
════════════════════════════════════════ */
function sCurve(val, strength) {
  const n = val / 255;
  const c = n < 0.5 ? 0.5 * Math.pow(2*n, 1+strength) : 1 - 0.5 * Math.pow(2*(1-n), 1+strength);
  return c * 255;
}
function sc(v) { return Math.min(255, Math.max(0, v)); }

function colorGrade(r, g, b, sh, mid, hi) {
  const lum = (r*0.299 + g*0.587 + b*0.114) / 255;
  const sw = Math.max(0, 1 - lum*3);
  const hw = Math.max(0, lum*3 - 2);
  const mw = 1 - sw - hw;
  return [
    sc(r + sh[0]*sw + mid[0]*mw + hi[0]*hw),
    sc(g + sh[1]*sw + mid[1]*mw + hi[1]*hw),
    sc(b + sh[2]*sw + mid[2]*mw + hi[2]*hw)
  ];
}

function addGrain(ctx, w, h, intensity, size) {
  const img = ctx.getImageData(0,0,w,h); const d = img.data; const s = size||1;
  for (let y=0; y<h; y+=s) for (let x=0; x<w; x+=s) {
    const noise = (Math.random()-0.5)*intensity;
    for (let dy=0; dy<s&&y+dy<h; dy++) for (let dx=0; dx<s&&x+dx<w; dx++) {
      const i = ((y+dy)*w+(x+dx))*4;
      d[i]+=noise; d[i+1]+=noise; d[i+2]+=noise;
    }
  }
  ctx.putImageData(img,0,0);
}

function addVignette(ctx, w, h, strength, squeeze) {
  const cx=w/2, cy=h/2, max=Math.sqrt(cx*cx+cy*cy), inner=(squeeze||0.4)*max;
  const g = ctx.createRadialGradient(cx,cy,inner,cx,cy,max);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(0.45,`rgba(0,0,0,${strength*0.25})`);
  g.addColorStop(0.75,`rgba(0,0,0,${strength*0.6})`);
  g.addColorStop(1,`rgba(0,0,0,${strength})`);
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
}

function addFlash(ctx, w, h, intensity, warmth) {
  const cx=w/2, cy=h*0.4, max=Math.max(w,h)*0.7, wr=warmth||0;
  const g = ctx.createRadialGradient(cx,cy,0,cx,cy,max);
  g.addColorStop(0,`rgba(255,${250-wr*12},${235-wr*25},${intensity})`);
  g.addColorStop(0.18,`rgba(255,${248-wr*10},${232-wr*22},${intensity*0.5})`);
  g.addColorStop(0.45,`rgba(255,${245-wr*8},${228-wr*18},${intensity*0.12})`);
  g.addColorStop(0.7,'rgba(0,0,0,0)');
  ctx.globalCompositeOperation='screen';
  ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation='source-over';
}

function addHalation(ctx, w, h, strength, tint) {
  const tc=document.createElement('canvas'); tc.width=w; tc.height=h;
  const t=tc.getContext('2d'); t.drawImage(ctx.canvas,0,0);
  const img=t.getImageData(0,0,w,h); const d=img.data;
  for (let i=0; i<d.length; i+=4) {
    const lum = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
    if (lum<170) { d[i]=d[i+1]=d[i+2]=0; d[i+3]=0; }
    else { d[i]=sc(d[i]+(tint?.[0]||0)); d[i+1]=sc(d[i+1]+(tint?.[1]||0)); d[i+2]=sc(d[i+2]+(tint?.[2]||0)); }
  }
  t.putImageData(img,0,0);
  ctx.globalCompositeOperation='screen'; ctx.globalAlpha=strength;
  ctx.filter=`blur(${Math.max(10,w*0.025)}px)`;
  ctx.drawImage(tc,0,0);
  ctx.filter='none'; ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
}

function smoothHighlights(ctx, w, h, amount) {
  const tc=document.createElement('canvas'); tc.width=w; tc.height=h;
  const t=tc.getContext('2d');
  t.filter=`blur(${Math.max(3,w*0.008)}px)`; t.drawImage(ctx.canvas,0,0); t.filter='none';
  const orig=ctx.getImageData(0,0,w,h), blur=t.getImageData(0,0,w,h);
  const od=orig.data, bd=blur.data;
  for (let i=0; i<od.length; i+=4) {
    const lum = (od[i]*0.299+od[i+1]*0.587+od[i+2]*0.114)/255;
    const blend = lum>0.25 ? amount*Math.min(1,(lum-0.25)*2) : 0;
    od[i]  =od[i]*(1-blend)+bd[i]*blend;
    od[i+1]=od[i+1]*(1-blend)+bd[i+1]*blend;
    od[i+2]=od[i+2]*(1-blend)+bd[i+2]*blend;
  }
  ctx.putImageData(orig,0,0);
}

const FILTERS = {
  warm_film: {
    name: 'Warm Film', quote: 'Little forever',
    cssPreview: 'sepia(0.25) saturate(1.05) contrast(1.05) brightness(1.02)',
    apply(ctx,w,h) {
      const img=ctx.getImageData(0,0,w,h); const d=img.data;
      for (let i=0;i<d.length;i+=4) {
        let r=sCurve(d[i],0.4),g=sCurve(d[i+1],0.3),b=sCurve(d[i+2],0.3);
        [r,g,b]=colorGrade(r,g,b,[12,4,-8],[6,2,-4],[10,6,-12]);
        const avg=(r+g+b)/3;
        d[i]=sc(r*0.88+avg*0.12); d[i+1]=sc(g*0.88+avg*0.12); d[i+2]=sc(b*0.88+avg*0.12);
      }
      ctx.putImageData(img,0,0);
      smoothHighlights(ctx,w,h,0.15); addHalation(ctx,w,h,0.12,[20,8,0]);
      addFlash(ctx,w,h,0.15,1); addGrain(ctx,w,h,16,1); addVignette(ctx,w,h,0.45,0.35);
    }
  },
  cinematic_cool: {
    name: 'Cool', quote: 'Time passes. This stays.',
    cssPreview: 'saturate(0.7) contrast(1.05) brightness(0.95) hue-rotate(-5deg)',
    apply(ctx,w,h) {
      const img=ctx.getImageData(0,0,w,h); const d=img.data;
      for (let i=0;i<d.length;i+=4) {
        let r=sCurve(d[i],0.3),g=sCurve(d[i+1],0.3),b=sCurve(d[i+2],0.35);
        [r,g,b]=colorGrade(r,g,b,[-6,2,14],[-2,0,4],[6,2,-4]);
        const avg=(r+g+b)/3;
        d[i]=sc(r*0.75+avg*0.25); d[i+1]=sc(g*0.78+avg*0.22); d[i+2]=sc(b*0.8+avg*0.2);
        d[i]=d[i]*0.9+22; d[i+1]=d[i+1]*0.9+24; d[i+2]=d[i+2]*0.9+28;
      }
      ctx.putImageData(img,0,0);
      smoothHighlights(ctx,w,h,0.12); addHalation(ctx,w,h,0.06,[0,4,12]);
      addGrain(ctx,w,h,12,1); addVignette(ctx,w,h,0.35,0.4);
    }
  },
  warm_noir: {
    name: 'Warm Noir', quote: 'Between takes',
    cssPreview: 'sepia(0.45) saturate(0.9) contrast(1.15) brightness(0.92)',
    apply(ctx,w,h) {
      const img=ctx.getImageData(0,0,w,h); const d=img.data;
      for (let i=0;i<d.length;i+=4) {
        let r=sCurve(d[i],0.55),g=sCurve(d[i+1],0.5),b=sCurve(d[i+2],0.45);
        [r,g,b]=colorGrade(r,g,b,[6,-2,-16],[12,6,-8],[18,10,-10]);
        const avg=(r+g+b)/3;
        d[i]=sc(r*0.9+avg*0.1); d[i+1]=sc(g*0.9+avg*0.1); d[i+2]=sc(b*0.85+avg*0.15);
      }
      ctx.putImageData(img,0,0);
      smoothHighlights(ctx,w,h,0.18); addHalation(ctx,w,h,0.16,[22,12,0]);
      addFlash(ctx,w,h,0.1,2); addGrain(ctx,w,h,14,1); addVignette(ctx,w,h,0.55,0.3);
    }
  },
  flash_booth: {
    name: 'Flash Booth', quote: 'Analog hearts, digital times',
    cssPreview: 'grayscale(1) contrast(1.15) brightness(1.05) sepia(0.15)',
    apply(ctx,w,h) {
      const img=ctx.getImageData(0,0,w,h); const d=img.data;
      for (let i=0;i<d.length;i+=4) {
        let gray=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
        gray=sCurve(gray,0.5)*0.84+34;
        d[i]=sc(gray+10); d[i+1]=sc(gray+5); d[i+2]=sc(gray-6);
      }
      ctx.putImageData(img,0,0);
      smoothHighlights(ctx,w,h,0.2); addHalation(ctx,w,h,0.2,[20,10,0]);
      addFlash(ctx,w,h,0.28,1.5); addGrain(ctx,w,h,28,2); addVignette(ctx,w,h,0.65,0.25);
    }
  },
  sepia_booth: {
    name: 'Sepia', quote: 'A memory in progress',
    cssPreview: 'grayscale(1) sepia(0.45) contrast(1.05) brightness(1.05)',
    apply(ctx,w,h) {
      const img=ctx.getImageData(0,0,w,h); const d=img.data;
      for (let i=0;i<d.length;i+=4) {
        let gray=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
        gray=sCurve(gray,0.35)*0.76+52;
        const l=gray/255;
        d[i]=sc(gray+18+l*8); d[i+1]=sc(gray+8+l*2); d[i+2]=sc(gray-16-(1-l)*12);
      }
      ctx.putImageData(img,0,0);
      smoothHighlights(ctx,w,h,0.28); addHalation(ctx,w,h,0.18,[18,8,-4]);
      addFlash(ctx,w,h,0.24,2); addGrain(ctx,w,h,22,1); addVignette(ctx,w,h,0.55,0.28);
    }
  },
  silver_booth: {
    name: 'Silver', quote: 'Proof we were here',
    cssPreview: 'grayscale(1) contrast(1.05) brightness(1.05)',
    apply(ctx,w,h) {
      const img=ctx.getImageData(0,0,w,h); const d=img.data;
      for (let i=0;i<d.length;i+=4) {
        let gray=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
        gray=sCurve(gray,0.3)*0.8+42;
        const l=gray/255;
        d[i]=sc(gray+2+l*4); d[i+1]=sc(gray+3+l*2); d[i+2]=sc(gray+6-l*2);
      }
      ctx.putImageData(img,0,0);
      smoothHighlights(ctx,w,h,0.25); addHalation(ctx,w,h,0.12,[4,4,6]);
      addFlash(ctx,w,h,0.18,0.3); addGrain(ctx,w,h,18,1); addVignette(ctx,w,h,0.5,0.3);
    }
  }
};

const FILTER_KEYS = ['warm_film','cinematic_cool','warm_noir','flash_booth','sepia_booth','silver_booth'];

const FRAME_COLORS = {
  white:    { bg: '#fdf8eb', text: '#5a5040' },
  black:    { bg: '#1a1410', text: '#c8bea8' },
  blush:    { bg: '#e8c4c0', text: '#5a3a38' },
  sage:     { bg: '#b8c9b0', text: '#3a4a38' },
  midnight: { bg: '#1e2240', text: '#c0c8e8' },
};

/* ═══════════════════════════════════════
   STATE
════════════════════════════════════════ */
let stream = null;
let facing = 'user';
let currentFilter = 'warm_film';
let currentFrameColor = 'white';
let capturedPhotos = [];
let isCapturing = false;
let fullStripCanvas = null; // cached for modal preview

/* ═══════════════════════════════════════
   SCREEN TRANSITIONS
════════════════════════════════════════ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ═══════════════════════════════════════
   WELCOME → CURTAIN OPEN → CUSTOMIZE
════════════════════════════════════════ */
function openCurtain() {
  const curtainLayer = document.getElementById('boothCurtain');
  const sub = document.getElementById('welcomeSub');

  // Update hint text
  if (sub) { sub.style.opacity = '0'; }

  // Trigger gather animation
  curtainLayer.classList.add('opening');

  // After curtain gathers, fade it out and enter booth
  setTimeout(() => {
    curtainLayer.classList.add('open');
    setTimeout(() => {
      enterBooth();
    }, 350);
  }, 900);
}

function enterBooth() {
  showScreen('screen-customize');
  buildCustFilterRow();
  updateStripPreview();
  setPreviewDate();
  initPreviewCamera();
}

/* ═══════════════════════════════════════
   CUSTOMIZE
════════════════════════════════════════ */
function initPreviewCamera() {
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false
  }).then(s => {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = s;
    const v = document.getElementById('previewVideo');
    v.srcObject = s;
    document.querySelector('.sp-frame-live').classList.toggle('no-mirror', facing === 'environment');
  }).catch(() => {
    showError('Camera unavailable', 'Please grant camera permission and reload. On iPhone, use Safari.');
  });
}

function flipPreviewCamera() {
  facing = facing === 'user' ? 'environment' : 'user';
  initPreviewCamera();
}

function buildCustFilterRow() {
  const row = document.getElementById('custFilterRow');
  row.innerHTML = '';
  FILTER_KEYS.forEach(key => {
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (key === currentFilter ? ' active' : '');
    btn.textContent = FILTERS[key].name;
    btn.onclick = () => selectFilter(key);
    row.appendChild(btn);
  });
}

function selectFilter(key) {
  currentFilter = key;
  document.querySelectorAll('.filter-chip').forEach((c, i) => {
    c.classList.toggle('active', FILTER_KEYS[i] === key);
  });
  document.getElementById('previewVideo').style.filter = FILTERS[key].cssPreview;
  document.getElementById('previewQuote').textContent = FILTERS[key].quote;
}

function selectColor(color) {
  currentFrameColor = color;
  document.querySelectorAll('.cs-opt').forEach(c => {
    c.classList.toggle('active', c.dataset.color === color);
  });
  updateStripPreview();
}

function updateStripPreview() {
  const strip = document.getElementById('stripPreview');
  strip.className = strip.className.replace(/\bfc-\S+/g, '').trim();
  strip.classList.add('fc-' + currentFrameColor);
}

function setPreviewDate() {
  const now = new Date();
  document.getElementById('previewDate').textContent =
    `${now.getFullYear()} · ${String(now.getMonth()+1).padStart(2,'0')} · ${String(now.getDate()).padStart(2,'0')}`;
}

function leaveCustomize() {
  stopCamera();
  showScreen('screen-welcome');
  // Reset curtain state so it shows closed again
  const curtainLayer = document.getElementById('boothCurtain');
  if (curtainLayer) {
    curtainLayer.classList.remove('opening', 'open');
    curtainLayer.style.opacity = '';
  }
  const sub = document.getElementById('welcomeSub');
  if (sub) sub.style.opacity = '1';
}

/* ═══════════════════════════════════════
   BEGIN SESSION
════════════════════════════════════════ */
async function beginSession() {
  const capVideo = document.getElementById('captureVideo');
  if (stream) {
    capVideo.srcObject = stream;
    document.getElementById('viewfinder').classList.toggle('no-mirror', facing === 'environment');
  }
  showScreen('screen-capture');
  await wait(300);
  await startCapture();
}

/* ═══════════════════════════════════════
   CAPTURE
════════════════════════════════════════ */
async function startCapture() {
  if (isCapturing) return;
  isCapturing = true;
  capturedPhotos = [];

  for (let i = 0; i < 4; i++) {
    document.getElementById('capStatus').textContent = `Photo ${i+1} of 4`;
    document.getElementById('photoProgress').textContent = `Photo ${i+1} of 4`;
    await countdown(3);
    capturePhoto(i);
    await wait(700);
  }

  document.getElementById('capStatus').textContent = 'Developing…';
  isCapturing = false;
  showScreen('screen-developing');
  await wait(700);
  await processPhotos();
  buildFullStripCanvas();
  showResult();
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function countdown(seconds) {
  const display = document.getElementById('countdown');
  const num = document.getElementById('countdownNum');
  display.classList.add('active');
  for (let s = seconds; s > 0; s--) {
    num.textContent = s;
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
    await wait(1000);
  }
  display.classList.remove('active');
}

function capturePhoto(index) {
  const flash = document.getElementById('flash');
  flash.classList.remove('firing');
  void flash.offsetWidth;
  flash.classList.add('firing');

  const video = document.getElementById('captureVideo');
  const SIZE = 600;
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  const vw = video.videoWidth, vh = video.videoHeight;
  const minDim = Math.min(vw, vh);
  const sx = (vw - minDim) / 2, sy = (vh - minDim) / 2;
  if (facing === 'user') { ctx.translate(SIZE, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, SIZE, SIZE);
  capturedPhotos.push(c);

  const mini = document.getElementById('csm' + index);
  const thumb = document.createElement('canvas');
  thumb.width = 54; thumb.height = 54;
  thumb.getContext('2d').drawImage(c, 0, 0, 54, 54);
  mini.innerHTML = '';
  mini.appendChild(thumb);
  mini.classList.add('done');
}

async function processPhotos() {
  const filter = FILTERS[currentFilter];
  for (let i = 0; i < 4; i++) {
    const final = document.getElementById('finalCanvas' + i);
    final.width = capturedPhotos[i].width;
    final.height = capturedPhotos[i].height;
    const ctx = final.getContext('2d');
    ctx.drawImage(capturedPhotos[i], 0, 0);
    filter.apply(ctx, final.width, final.height);
    await wait(50);
  }
}

/* ═══════════════════════════════════════
   RESULT
════════════════════════════════════════ */
function showResult() {
  const fc = FRAME_COLORS[currentFrameColor];
  const inner = document.getElementById('resultStripInner');
  inner.style.background = fc.bg;
  inner.style.color = fc.text;

  document.getElementById('stripQuote').textContent = FILTERS[currentFilter].quote;
  const now = new Date();
  document.getElementById('stripDate').textContent =
    `${now.getFullYear()} · ${String(now.getMonth()+1).padStart(2,'0')} · ${String(now.getDate()).padStart(2,'0')}`;

  showScreen('screen-result');
  stopCamera();

  // Retrigger print animation
  inner.style.animation = 'none';
  void inner.offsetWidth;
  inner.style.animation = '';
}

/* ═══════════════════════════════════════
   DOWNLOAD MODAL
════════════════════════════════════════ */
function buildFullStripCanvas() {
  const FRAME_SIZE = 600, PADDING = 28, FRAME_GAP = 14, FOOTER_H = 120;
  const W = FRAME_SIZE + PADDING * 2;
  const H = PADDING + (FRAME_SIZE + FRAME_GAP) * 4 - FRAME_GAP + FOOTER_H;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const fc = FRAME_COLORS[currentFrameColor];
  ctx.fillStyle = fc.bg;
  ctx.fillRect(0, 0, W, H);

  // paper grain texture
  const isDark = ['black','midnight'].includes(currentFrameColor);
  for (let i = 0; i < 900; i++) {
    const alpha = Math.random() * (isDark ? 0.06 : 0.04);
    ctx.fillStyle = isDark ? `rgba(200,190,168,${alpha})` : `rgba(184,140,74,${alpha})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }

  for (let i = 0; i < 4; i++) {
    const y = PADDING + i * (FRAME_SIZE + FRAME_GAP);
    ctx.drawImage(document.getElementById('finalCanvas' + i), PADDING, y, FRAME_SIZE, FRAME_SIZE);
  }

  const footerY = PADDING + (FRAME_SIZE + FRAME_GAP) * 4 - FRAME_GAP + 36;
  ctx.fillStyle = fc.text;
  ctx.font = 'italic 28px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(FILTERS[currentFilter].quote, W / 2, footerY);

  ctx.globalAlpha = 0.7;
  ctx.font = '15px "Courier New", monospace';
  const now = new Date();
  ctx.fillText(
    `${now.getFullYear()} · ${String(now.getMonth()+1).padStart(2,'0')} · ${String(now.getDate()).padStart(2,'0')}`,
    W / 2, footerY + 26
  );
  ctx.globalAlpha = 0.5;
  ctx.font = '13px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('@gracermy', W - PADDING + 8, H - 12);
  ctx.globalAlpha = 1;

  fullStripCanvas = canvas;
}

function showDownloadModal() {
  if (!fullStripCanvas) return;

  const modal = document.getElementById('downloadModal');
  const stripHolder = document.getElementById('dlModalStrip');

  // Show a scaled-down preview image in the modal
  stripHolder.innerHTML = '';
  const img = document.createElement('img');
  img.src = fullStripCanvas.toDataURL('image/jpeg', 0.88);
  img.style.width = '100%';
  img.alt = 'Your photo strip preview';
  stripHolder.appendChild(img);

  // Reset download button
  const btn = document.getElementById('dlModalBtn');
  btn.classList.remove('done');
  btn.textContent = '';
  const span1 = document.createElement('span'); span1.textContent = '↓';
  const span2 = document.createElement('span'); span2.textContent = ' Download Strip';
  btn.appendChild(span1); btn.appendChild(span2);

  modal.classList.add('active');
}

function closeDownloadModal() {
  document.getElementById('downloadModal').classList.remove('active');
}

function triggerDownload() {
  if (!fullStripCanvas) return;

  const btn = document.getElementById('dlModalBtn');
  btn.classList.add('done');
  btn.textContent = '✓ Saved!';

  fullStripCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `photobooth_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');

  // Auto-close modal after brief confirmation
  setTimeout(() => closeDownloadModal(), 1600);
}

/* ═══════════════════════════════════════
   RETAKE — go back to welcome screen
════════════════════════════════════════ */
function retakeBooth() {
  capturedPhotos = [];
  fullStripCanvas = null;

  // Reset curtain to closed state
  const curtainLayer = document.getElementById('boothCurtain');
  if (curtainLayer) {
    curtainLayer.classList.remove('opening', 'open');
    curtainLayer.style.opacity = '';
    curtainLayer.style.transition = 'none';
    // force reflow then re-enable transition
    void curtainLayer.offsetWidth;
    curtainLayer.style.transition = '';
  }
  const sub = document.getElementById('welcomeSub');
  if (sub) { sub.style.opacity = '0'; void sub.offsetWidth; sub.style.opacity = '1'; }

  stopCamera();
  showScreen('screen-welcome');
}

/* ═══════════════════════════════════════
   UTILS
════════════════════════════════════════ */
function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

function showError(title, msg) {
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('errorModal').classList.add('active');
}

// Close modals on overlay click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('downloadModal').addEventListener('click', function(e) {
    if (e.target === this) closeDownloadModal();
  });
  document.getElementById('errorModal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('active');
  });
});
