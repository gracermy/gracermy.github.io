// Our Advent Calendar — a 24-door calendar for two.
//
// Testing tip: add ?date=2026-12-10 to the address to pretend it's that day.
// Open two tabs, pick a different person in each, and watch them update live.

(function () {
  const CFG = window.ADVENT_CONFIG;
  const S = window.AdventStore;
  const $app = document.getElementById("app");

  const TYPES = {
    coupon:    { emo: "💌", label: "Love coupon" },
    question:  { emo: "💭", label: "Daily question" },
    spinner:   { emo: "🎡", label: "Date spinner" },
    memory:    { emo: "📸", label: "Memory day" },
    challenge: { emo: "✨", label: "Tiny challenge" },
  };

  // ── small helpers ──
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const now = () => Date.now();
  const fmt = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  // ── people ──
  let me = ls.get("advent_me");
  const person = (id) => CFG.PEOPLE.find((p) => p.id === id);
  const other = (id) => CFG.PEOPLE.find((p) => p.id !== id);
  const nm = (id) => esc(person(id)?.name);
  const partner = () => other(me).id;

  // ── dates ──
  function today() {
    const q = new URLSearchParams(location.search).get("date");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) { const [y, m, d] = q.split("-").map(Number); return new Date(y, m - 1, d); }
    const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  const doorDate = (d) => new Date(CFG.YEAR, 11, d);
  const isOpen = (d) => today() >= doorDate(d);
  const isToday = (d) => today().getTime() === doorDate(d).getTime();

  // ── schedule ──
  const schedule = window.AdventSchedule.buildSchedule(CFG);
  const dayInfo = (d) => schedule[d - 1];

  // A random colour per door (the same on both phones). A door never matches
  // the day before it, or the door directly above it in either grid layout:
  // 4 columns on phones (so day - 4) and 6 on wider screens (day - 6).
  const doorColors = (() => {
    const rand = window.AdventSchedule.rng(CFG.SEED * 31 + 7), out = [];
    const all = ["red", "green", "blue", "yellow"];
    for (let i = 0; i < 24; i++) {
      const choices = all.filter((c) => c !== out[i - 1] && c !== out[i - 4] && c !== out[i - 6]);
      out.push(choices[Math.floor(rand() * choices.length)]);
    }
    return out;
  })();

  // The content lives in the database (see scripts/advent-content.js), not in
  // this public code. A day's question/challenge/memory prompt only arrives
  // once that day has come; the spinner slices and coupon ideas are lists.
  const itemFor = (d) => S.get(`day:${d}:content`) || null;
  const list = (name) => S.get("pool:" + name) || [];
  const needsContent = (d) => ["question", "challenge", "memory"].includes(dayInfo(d).type);

  // ── derived state ──
  function questionScore(id) { // how many of the other's answers `id` guessed right
    let n = 0;
    for (const s of schedule) if (s.type === "question" && S.get(`day:${s.day}:judge:${other(id).id}`)?.correct) n++;
    return n;
  }

  // Something on this day is waiting for me to look at or do.
  function needsMe(d) {
    if (!isOpen(d)) return false;
    const { type } = dayInfo(d), p = partner(), k = (x) => S.get(`day:${d}:${x}`);
    switch (type) {
      case "coupon": return !k("coupon:" + me) || (k("coupon:" + p) && !ls.get(`advent_opened_${me}_${d}`));
      case "question": return !k("answer:" + me) || (k("answer:" + p) && !k("judge:" + me));
      case "spinner": return !k("spin");
      case "memory": return !k("memory:" + me) || (k("memory:" + p) && !ls.get(`advent_seenmem_${me}_${d}`));
      case "challenge": return !k("done:" + me);
    }
  }

  // ── what changed (banner + live toasts) ──
  function describe(key, v) {
    const m = key.match(/^day:(\d+):(\w+)(?::(\w))?$/);
    if (!m) return null;
    const d = m[1], what = m[2], P = nm(v.by);
    // Don't name the kind of day before you've discovered it yourself.
    if (what !== "judge" && dayInfo(+d) && !found(dayInfo(+d).type)) return `${P} did something on day ${d} 👀 Open it to see`;
    return {
      coupon: `${P} wrote you a love coupon on day ${d} 💌`,
      answer: `${P} answered the day ${d} question 💭`,
      judge: `${P} marked your guess on day ${d}`,
      spin: `${P} spun the wheel on day ${d} 🎡`,
      memory: `${P} shared a memory on day ${d} 📸`,
      done: `${P} finished the day ${d} challenge ✨`,
    }[what] || null;
  }
  function changesSince(t) {
    return Object.entries(S.all())
      .filter(([k, v]) => v && v.by === partner() && v.at > t)
      .sort((a, b) => a[1].at - b[1].at)
      .map(([k, v]) => describe(k, v)).filter(Boolean);
  }
  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast"; el.innerHTML = msg;
    document.getElementById("toasts").append(el);
    setTimeout(() => el.remove(), 4500);
  }
  function confetti() {
    const colors = ["#d62839", "#1f8a4c", "#2563c9", "#f5c518"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "vw";
      c.style.background = colors[i % 4];
      c.style.setProperty("--dx", (Math.random() * 200 - 100) + "px");
      c.style.animationDelay = Math.random() * .4 + "s";
      document.body.append(c);
      setTimeout(() => c.remove(), 2400);
    }
  }

  // ── view state ──
  let tab = ls.get("advent_tab") || "calendar";
  let openDay = null;
  let banner = [];

  // ── screens ──
  function message(emoji, title, text) {
    $app.innerHTML = `<div class="center-card"><div style="font-size:44px">${emoji}</div>
      <h1 class="serif">${title}</h1><p>${text}</p>
      <button class="btn block" onclick="location.reload()">Try again</button></div>`;
  }

  function gate(err = "") {
    $app.innerHTML = `
      <div class="center-card">
        <div style="font-size:44px">🎄</div>
        <h1 class="serif">Our Advent Calendar</h1>
        <p>24 little doors, just for the two of us.</p>
        <form id="gate">
          <input type="password" id="pw" placeholder="Our password" autocomplete="current-password" autofocus>
          <button class="btn block">Open</button>
          <p class="err" id="err">${esc(err)}</p>
        </form>
        ${S.mode === "local" ? '<p style="font-size:13px;margin:8px 0 0">Test mode: saved in this browser only, any password works.</p>' : ""}
      </div>`;
    document.getElementById("gate").onsubmit = async (e) => {
      e.preventDefault();
      const pw = document.getElementById("pw").value.trim().toLowerCase();
      const $err = document.getElementById("err"), $btn = e.target.querySelector("button");
      $btn.disabled = true; $err.textContent = "";
      try {
        if (await S.check(pw)) { ls.set("advent_pass", pw); start(); return; }
        $err.textContent = "Not quite. Try again 🙈";
      } catch (x) {
        $err.textContent = x.notSetUp ? "The database isn't set up yet (run setup.sql)." : "Couldn't connect. Check your internet.";
      }
      $btn.disabled = false;
    };
  }

  function who() {
    $app.innerHTML = `
      <div class="center-card">
        <div style="font-size:44px">💞</div>
        <h1 class="serif">Who's this?</h1>
        <p>This phone will remember you.</p>
        <div class="who-row">
          ${CFG.PEOPLE.map((p) => `<button class="btn who-btn ${p.id === "b" ? "green" : ""}" data-id="${p.id}">${esc(p.name)}</button>`).join("")}
        </div>
      </div>`;
    $app.querySelectorAll("[data-id]").forEach((b) => b.onclick = () => {
      me = b.dataset.id; ls.set("advent_me", me); start();
    });
  }

  function render() {
    const p = partner();
    const before = doorDate(1) > today();
    const daysTo = Math.ceil((doorDate(1) - today()) / 864e5);
    $app.innerHTML = `
      <header>
        <h1 class="serif">Our Advent Calendar</h1>
        <div class="sub">${nm(CFG.PEOPLE[0].id)} &amp; ${nm(CFG.PEOPLE[1].id)} · December ${CFG.YEAR}</div>
        ${found("question") ? `<div class="score">
          <span class="chip">💭 ${nm(me)} guessed ${questionScore(me)} right</span>
          <span class="chip">💭 ${nm(p)} guessed ${questionScore(p)} right</span>
        </div>` : ""}
      </header>
      ${hasWallet() ? `<nav class="tabs">
        ${[["calendar", "Calendar"], ["wallet", "Wallet"]]
          .map(([id, l]) => `<button data-tab="${id}" class="${tab === id ? "on" : ""}">${l}</button>`).join("")}
      </nav>` : ""}
      ${banner.length ? `
        <div class="banner"><div><strong>Since you last visited</strong>
          <ul>${banner.map((b) => `<li>${b}</li>`).join("")}</ul></div>
          <button class="x" id="dismiss" aria-label="Dismiss">×</button></div>` : ""}
      ${installCardHTML()}${notifyCardHTML()}
      <main id="tab"></main>
      <footer>You're ${nm(me)} · <button id="switch">switch person</button> · <button id="lock">lock</button>
        ${pushState === "on" ? ` · 🔔 reminders on (<button id="push-off">turn off</button>)` : ""}</footer>`;

    const $tab = document.getElementById("tab");
    if (tab !== "wallet" || !hasWallet()) tab = "calendar";
    $tab.innerHTML = tab === "wallet" ? walletHTML() : calendarHTML(before, daysTo);

    $app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; ls.set("advent_tab", tab); render(); });
    $app.querySelector("#dismiss")?.addEventListener("click", () => { banner = []; render(); });
    document.getElementById("switch").onclick = () => { ls.del("advent_me"); me = null; banner = []; who(); };
    document.getElementById("lock").onclick = () => { ls.del("advent_pass"); location.reload(); };
    bindInstall();
    bindNotify();
    bindTab($tab);
    if (openDay) renderSheet();
  }

  // ── calendar ──
  function calendarHTML(before, daysTo) {
    const doors = schedule.map(({ day, type }) => {
      const open = isOpen(day), opened = open && ls.get(`advent_door_${me}_${day}`);
      return `<button class="door c-${doorColors[day - 1]} ${open ? "" : "locked"} ${opened ? "opened" : ""} ${isToday(day) ? "today" : ""}"
        data-day="${day}" ${open ? "" : 'aria-disabled="true"'} aria-label="Day ${day}">
        <span class="num">${day}</span>
        <span class="emo">${opened ? TYPES[type].emo : open ? "🎁" : "🔒"}</span>
        ${opened && needsMe(day) ? '<span class="dot" title="Something waiting for you"></span>' : ""}
      </button>`;
    }).join("");
    return `
      ${before ? `<p class="notice">The first door opens in <strong>${daysTo} day${daysTo === 1 ? "" : "s"}</strong> ❄️</p>`
        : `<p class="notice">Tap a door to open it. A gold dot means something's waiting for you.</p>`}
      <div class="grid">${doors}</div>
      <div class="legend">${legendHTML()}</div>`;
  }

  // ── wallet ──
  function walletHTML() {
    const p = partner(), all = S.all();
    const card = (key, c, { from, date, canUse = true } = {}) => {
      const used = all["wallet:used:" + key];
      return `<div class="coupon ${date ? "date" : ""} ${used ? "used" : ""}">
        ${used ? `<span class="stamp">USED ${fmt(used.at)}</span>` : ""}
        <div class="ct">${esc(c.title)}</div>
        ${c.note ? `<div class="cn">${esc(c.note)}</div>` : ""}
        <div class="cf">${from}</div>
        ${!used && canUse ? `<div class="row"><button class="btn small green" data-use="${esc(key)}">Use it</button></div>` : ""}
      </div>`;
    };
    const coupons = (by) => schedule.filter((s) => s.type === "coupon")
      .map((s) => ({ day: s.day, key: `day:${s.day}:coupon:${by}`, c: all[`day:${s.day}:coupon:${by}`] }))
      .filter((x) => x.c);
    const mine = coupons(p), gave = coupons(me);
    const dates = schedule.filter((s) => s.type === "spinner")
      .map((s) => ({ day: s.day, key: `day:${s.day}:spin`, c: all[`day:${s.day}:spin`] })).filter((x) => x.c);

    const forMe = mine.map(({ day, key, c }) =>
      ls.get(`advent_opened_${me}_${day}`)
        ? card(key, c, { from: `From ${nm(p)} · day ${day}` })
        : `<div class="coupon"><div class="ct">Sealed 💌</div><div class="cn">Open it on day ${day} first.</div></div>`).join("");

    const couponHTML = `
      <section class="panel"><h2 class="serif">For you</h2><p>Coupons ${nm(p)} wrote you. Tap "Use it" when you cash one in.</p>
        <div class="stack two">${forMe || '<p class="empty">Nothing yet.</p>'}</div></section>`;
    const datesHTML = `
      <section class="panel"><h2 class="serif">Our dates</h2><p>Won on the spinner. Do them whenever.</p>
        <div class="stack two">${dates.map(({ day, key, c }) => card(key, { title: c.text }, { from: `Spun by ${nm(c.by)} · day ${day}`, date: true })).join("") || '<p class="empty">No spins yet.</p>'}</div></section>`;
    const gaveHTML = `
      <section class="panel"><h2 class="serif">You gave</h2><p>${nm(p)} decides when to use these.</p>
        <div class="stack two">${gave.map(({ day, key, c }) => card(key, c, { from: `To ${nm(p)} · day ${day}`, canUse: false })).join("") || '<p class="empty">You haven\'t written any yet.</p>'}</div></section>`;
    // Each part of the wallet appears once you've opened your first door of that kind.
    return (found("coupon") ? couponHTML : "") + (found("spinner") ? datesHTML : "") + (found("coupon") ? gaveHTML : "");
  }

  // ── unlocking: no spoilers ──
  // The scoreboard, the wallet and the legend only show a kind of day once
  // you've opened a door of that kind.
  function openedByMe(d) { return !!(ls.get(`advent_door_${me}_${d}`) || S.get(`day:${d}:open:${me}`)); }
  function found(type) { return schedule.some((s) => s.type === type && isOpen(s.day) && openedByMe(s.day)); }
  function hasWallet() { return found("coupon") || found("spinner"); }
  function legendHTML() {
    const seen = Object.keys(TYPES).filter(found);
    const left = Object.keys(TYPES).length - seen.length;
    return seen.map((t) => `<span>${TYPES[t].emo} ${TYPES[t].label}</span>`).join("") +
      (left ? `<span>❓ ${seen.length ? `${left} more kind${left === 1 ? "" : "s"} of day to discover` : "Every door is a surprise"}</span>` : "");
  }
  const UNLOCK = {
    coupon: "💌 Love coupons unlocked: your Wallet is open",
    question: "💭 Question day unlocked: the scoreboard is on",
    spinner: "🎡 Date spinner unlocked: dates go in your Wallet",
    memory: "📸 Memory day unlocked",
    challenge: "✨ Tiny challenge unlocked",
  };

  async function openDoor(d) {
    if (!isOpen(d)) { toast(`Day ${d} isn't open yet. No peeking 👀`); return; }
    const type = schedule[d - 1].type, isNew = !found(type);
    ls.set(`advent_door_${me}_${d}`, "1");
    // Record the open in the database too, so the 22:00 reminder knows who
    // still hasn't opened today's door.
    if (!S.get(`day:${d}:open:${me}`)) S.set(`day:${d}:open:${me}`, { by: me, at: now() }, { quiet: true }).catch(() => {});
    // A day's content is released by the database when the day arrives;
    // fetch it now if this phone hasn't got it yet.
    if (needsContent(d) && !itemFor(d)) await S.refresh().catch(() => {});
    openDay = d; render();
    if (isNew) toast(UNLOCK[type]);
  }

  // Links from notifications: #day-5 opens door 5, #wallet opens the wallet.
  function followLink(hash) {
    const m = /^#day-(\d+)$/.exec(hash || "");
    if (m && +m[1] >= 1 && +m[1] <= 24) { tab = "calendar"; openDoor(+m[1]); }
    else if (hash === "#wallet") { tab = hasWallet() ? "wallet" : "calendar"; openDay = null; render(); }
    if (hash) history.replaceState(null, "", location.pathname + location.search);
  }
  window.addEventListener("hashchange", () => me && followLink(location.hash));
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "open" && me) followLink(new URL(e.data.url, location.href).hash);
  });

  // ── notifications ──
  // pushState: hidden (not available here) | needs-install | blocked | off | on
  let pushState = "hidden";
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function b64ToBytes(s) {
    const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  async function checkPush() {
    if (!S.canNotify) return "hidden";
    if (isIOS() && !isStandalone()) return "needs-install";
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "hidden";
    if (Notification.permission === "denied") return "blocked";
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) S.savePush(me, sub).catch(() => {}); // keep the database copy fresh
      return sub ? "on" : "off";
    } catch { return "off"; }
  }
  // ── install to Home Screen (same approach as Bloom) ──
  // Android/desktop fire `beforeinstallprompt`, which we keep and replay from
  // the Install button. iOS has no such API, so there we explain Share ->
  // Add to Home Screen; on iPhone that's also the only way reminders work.
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (me) render();
  });
  window.addEventListener("appinstalled", () => { deferredInstall = null; if (me) render(); });
  function installCardHTML() {
    if (isStandalone() || ls.get("advent_install_later") === "1") return "";
    if (!deferredInstall && !isIOS()) return "";
    const text = isIOS()
      ? `Tap <strong>Share</strong> <span aria-hidden="true">⬆️</span> at the bottom of Safari, then
         <strong>Add to Home Screen</strong>. Then open <strong>Advent</strong> from your Home Screen:
         it opens full screen, and it's the only way reminders work on iPhone.`
      : `Install the calendar as an app: it opens full screen, straight from your home screen.`;
    return `<div class="notify-card install-card">
      <div><strong>📲 Add Advent to your Home Screen</strong><p>${text}</p></div>
      <div class="row">
        ${deferredInstall ? `<button class="btn small" id="install-now">Install</button>` : ""}
        <button class="btn small ghost-light" id="install-later">Not now</button>
      </div></div>`;
  }
  function bindInstall() {
    document.getElementById("install-later")?.addEventListener("click", () => { ls.set("advent_install_later", "1"); render(); });
    document.getElementById("install-now")?.addEventListener("click", async () => {
      const evt = deferredInstall;
      deferredInstall = null;
      if (!evt) return;
      evt.prompt();
      try { await evt.userChoice; } catch {}
      render();
    });
  }

  function notifyCardHTML() {
    // Before installing on iPhone, the install card above says what to do.
    if (pushState === "hidden" || pushState === "on" || pushState === "needs-install" ||
        ls.get("advent_push_later") === pushState) return "";
    const body = {
      off: `Get a reminder at 10:00 when the day's door opens, a nudge at 22:00 if you haven't opened it,
        and a ping when ${nm(partner())} answers, writes or shares something.`,
      blocked: `Notifications are blocked for this site. Turn them on in your phone's settings for this app, then come back.`,
    }[pushState];
    return `<div class="notify-card">
      <div><strong>🔔 Reminders</strong><p>${body}</p></div>
      <div class="row">
        ${pushState === "off" ? `<button class="btn small" id="push-on">Turn on reminders</button>` : ""}
        <button class="btn small ghost-light" id="push-later">Not now</button>
      </div></div>`;
  }
  function bindNotify() {
    document.getElementById("push-later")?.addEventListener("click", () => { ls.set("advent_push_later", pushState); render(); });
    document.getElementById("push-on")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { pushState = perm === "denied" ? "blocked" : "off"; render(); return; }
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ||
          await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.vapidKey) });
        await S.savePush(me, sub);
        pushState = "on"; toast("Reminders are on 🔔"); render();
      } catch {
        e.target.disabled = false;
        toast("Couldn't turn on reminders. Check your connection and try again.");
      }
    });
    document.getElementById("push-off")?.addEventListener("click", async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) { await S.forgetPush(sub.endpoint).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
      } catch {}
      pushState = "off"; ls.set("advent_push_later", "off"); toast("Reminders are off"); render();
    });
  }

  function bindTab($t) {
    $t.querySelectorAll("[data-day]").forEach((b) => b.onclick = () => openDoor(+b.dataset.day));
    $t.querySelectorAll("[data-use]").forEach((b) => b.onclick = async () => {
      if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Tap again to use it"; return; }
      await S.set("wallet:used:" + b.dataset.use, { by: me, at: now() });
      confetti(); render();
    });
  }

  // ── day sheet ──
  function renderSheet() {
    document.querySelector(".overlay")?.remove();
    const d = openDay, info = dayInfo(d), t = TYPES[info.type];
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="sheet" role="dialog" aria-label="Day ${d}">
      <div class="top"><span class="kind">${t.emo} ${t.label}</span><button class="close" aria-label="Close">×</button></div>
      <h2 class="serif">December ${d}</h2>
      <div id="body"></div></div>`;
    document.body.append(ov);
    const close = () => { openDay = null; ov.remove(); render(); };
    ov.querySelector(".close").onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    const body = ov.querySelector("#body");
    if (needsContent(d) && !itemFor(d)) {
      body.innerHTML = `${waiting("Today's surprise is still on its way. Try again in a minute.")}
        <button class="btn block" id="retry">Check again</button>`;
      body.querySelector("#retry").onclick = async () => { await S.refresh().catch(() => {}); renderSheet(); };
      return;
    }
    ({ coupon: couponDay, question: questionDay, spinner: spinnerDay, memory: memoryDay, challenge: challengeDay })[info.type](d, body, info);
  }
  const waiting = (txt) => `<div class="box waiting"><span class="hg">⏳</span><span>${txt}</span></div>`;

  function couponDay(d, el) {
    const p = partner(), mine = S.get(`day:${d}:coupon:${me}`), theirs = S.get(`day:${d}:coupon:${p}`);
    const opened = ls.get(`advent_opened_${me}_${d}`);
    const card = (c, foot) => `<div class="coupon"><div class="ct">${esc(c.title)}</div>${c.note ? `<div class="cn">${esc(c.note)}</div>` : ""}<div class="cf">${foot}</div></div>`;
    el.innerHTML = `
      <p class="muted">Write a coupon for ${nm(p)}. Theirs for you stays sealed until they write it.</p>
      <h3>From ${nm(p)}</h3>
      ${theirs ? (opened ? `<div class="pop">${card(theirs, "It's in your wallet 💛")}</div>` : `<button class="envelope" id="env">💌 ${nm(p)} wrote you a coupon. Tap to open!</button>`)
        : waiting(`Waiting for ${nm(p)} to write yours…`)}
      <h3>Your coupon for ${nm(p)}</h3>
      ${mine ? `${card(mine, `${theirs ? "" : `${nm(p)} can open it now`}`)}<div class="row"><button class="btn small ghost" id="edit">Edit</button></div>`
        : couponForm()}`;
    function couponForm(c = {}) {
      return `<form id="cf">
        <label for="ct">It's good for…</label><input type="text" id="ct" maxlength="80" required value="${esc(c.title)}" placeholder="One free back rub">
        <div class="chips">${list("coupon").map((it) => `<button type="button" data-fill="${esc(it.text)}">${esc(it.text)}</button>`).join("")}</div>
        <label for="cn">A little note (optional)</label><textarea id="cn" maxlength="300">${esc(c.note)}</textarea>
        <button class="btn block">Seal it 💌</button></form>`;
    }
    const bindForm = () => {
      el.querySelectorAll("[data-fill]").forEach((b) => b.onclick = () => { el.querySelector("#ct").value = b.dataset.fill; });
      const f = el.querySelector("#cf");
      if (f) f.onsubmit = async (e) => {
        e.preventDefault();
        await S.set(`day:${d}:coupon:${me}`, { title: el.querySelector("#ct").value.trim(), note: el.querySelector("#cn").value.trim(), by: me, at: now() });
        toast(`Sealed! ${nm(p)} can open it now 💌`); renderSheet();
      };
    };
    bindForm();
    el.querySelector("#env")?.addEventListener("click", () => { ls.set(`advent_opened_${me}_${d}`, "1"); confetti(); renderSheet(); });
    el.querySelector("#edit")?.addEventListener("click", (e) => {
      e.target.closest(".row").previousElementSibling.outerHTML = couponForm(mine);
      e.target.closest(".row").remove(); bindForm();
    });
  }

  function questionDay(d, el) {
    const p = partner(), q = itemFor(d);
    const a = S.get(`day:${d}:answer:${me}`), b = S.get(`day:${d}:answer:${p}`);
    const myJudge = S.get(`day:${d}:judge:${me}`), theirJudge = S.get(`day:${d}:judge:${p}`);
    let html = `<div class="box"><div class="serif" style="font-size:24px;line-height:1.25">${esc(q.text)}</div></div>`;
    if (!a) {
      html += `<form id="qf">
        <label for="mine">Your answer</label><input type="text" id="mine" required maxlength="160">
        <label for="guess">Your guess for ${nm(p)}</label><input type="text" id="guess" required maxlength="160">
        <button class="btn block">Lock it in 🔒</button></form>
        ${b ? `<p class="muted" style="margin-top:10px">${nm(p)} already answered. Your turn!</p>` : ""}`;
    } else if (!b) {
      html += `<h3>You said</h3><div class="box">${esc(a.mine)}<br><span class="muted">Your guess for ${nm(p)}: ${esc(a.guess)}</span></div>
        <h3>${nm(p)}</h3>${waiting(`Waiting for ${nm(p)} to answer… this page updates by itself.`)}`;
    } else {
      html += `<div class="pop">
        <h3>${nm(p)}'s answer</h3>
        <div class="box">${esc(b.mine)}<br><span class="muted">You guessed: ${esc(a.guess)}</span><br>
          ${theirJudge ? (theirJudge.correct ? '<span class="right">✅ You got it right!</span>' : '<span class="wrong">❌ Not quite!</span>')
            : `<span class="muted">⏳ ${nm(p)} is deciding if you got it…</span>`}</div>
        <h3>Your answer</h3>
        <div class="box">${esc(a.mine)}<br><span class="muted">${nm(p)} guessed: ${esc(b.guess)}</span>
          ${myJudge ? `<br>${myJudge.correct ? '<span class="right">✅ You said they got it</span>' : '<span class="wrong">❌ You said not quite</span>'}`
            : `<div class="row"><span style="flex-basis:100%">Did ${nm(p)} get it?</span>
               <button class="btn small green" data-judge="1">✅ Yes</button><button class="btn small" data-judge="0">❌ No</button></div>`}</div>
      </div>`;
    }
    el.innerHTML = html;
    const f = el.querySelector("#qf");
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      await S.set(`day:${d}:answer:${me}`, { mine: el.querySelector("#mine").value.trim(), guess: el.querySelector("#guess").value.trim(), by: me, at: now() });
      renderSheet();
    };
    el.querySelectorAll("[data-judge]").forEach((btn) => btn.onclick = async () => {
      const correct = btn.dataset.judge === "1";
      await S.set(`day:${d}:judge:${me}`, { correct, by: me, at: now() });
      if (correct) confetti();
      renderSheet();
    });
  }

  function spinnerDay(d, el) {
    const result = S.get(`day:${d}:spin`);
    const won = new Set(schedule.map((s) => S.get(`day:${s.day}:spin`)?.id).filter(Boolean));
    const slices = list("spinner").filter((it) => (result && it.id === result.id) || !won.has(it.id));
    const n = Math.max(slices.length, 1), seg = 360 / n;
    // Christmas red, green, blue and yellow (yellow slices get dark text).
    const colors = ["#d62839", "#1f8a4c", "#2563c9", "#f5c518"];
    const textOn = (i) => (i % colors.length === 3 ? "#16213e" : "#fff");
    const pt = (deg, r) => { const a = (deg - 90) * Math.PI / 180; return [150 + r * Math.cos(a), 150 + r * Math.sin(a)]; };
    const paths = slices.map((it, i) => {
      const [x1, y1] = pt(i * seg, 145), [x2, y2] = pt((i + 1) * seg, 145);
      const mid = i * seg + seg / 2, [tx, ty] = pt(mid, 88);
      const label = it.text.length > 18 ? it.text.slice(0, 17) + "…" : it.text;
      return `<path d="M150,150 L${x1},${y1} A145,145 0 ${seg > 180 ? 1 : 0},1 ${x2},${y2} Z" fill="${colors[i % colors.length]}"/>
        <text x="${tx}" y="${ty}" fill="${textOn(i)}" font-size="${n > 8 ? 10 : 12}" font-weight="600" text-anchor="middle" dominant-baseline="middle"
          transform="rotate(${mid - 90},${tx},${ty})">${esc(label)}</text>`;
    }).join("");
    const landIdx = result ? Math.max(0, slices.findIndex((s) => s.id === result.id)) : 0;
    const restAngle = -(landIdx * seg + seg / 2);
    el.innerHTML = `
      <p class="muted">${result ? `${nm(result.by)} spun the wheel. Your date is in the wallet, do it whenever you like.` : "One spin for both of you. Whatever it lands on becomes a date coupon."}</p>
      <div class="wheel-wrap"><div class="pointer"></div>
        <svg viewBox="0 0 300 300" id="wheel" style="transform:rotate(${result ? restAngle : 0}deg)">${paths}<circle cx="150" cy="150" r="22" fill="#ffffff"/></svg></div>
      ${result ? `<div class="coupon date pop"><div class="ct">${esc(result.text)}</div><div class="cf">Date coupon · in your wallet 💚</div></div>`
        : `<button class="btn block green" id="spin" ${slices.length ? "" : "disabled"}>Spin! 🎡</button>`}`;
    el.querySelector("#spin")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const i = Math.floor(Math.random() * slices.length), pick = slices[i];
      const target = 360 * 6 - (i * seg + seg / 2) + (Math.random() - .5) * seg * .6;
      el.querySelector("#wheel").style.transform = `rotate(${target}deg)`;
      setTimeout(async () => {
        await S.set(`day:${d}:spin`, { id: pick.id, text: pick.text, by: me, at: now() });
        confetti(); renderSheet();
      }, 4100);
    });
  }

  // Both of you answer the prompt with a photo. The other's stays hidden until
  // you've shared yours, then you see each other's.
  function memoryDay(d, el) {
    const p = partner(), prompt = itemFor(d);
    const mine = S.get(`day:${d}:memory:${me}`), theirs = S.get(`day:${d}:memory:${p}`);
    const promptBox = `<div class="box"><div class="serif" style="font-size:22px;line-height:1.25">${esc(prompt.text)}</div></div>`;
    const polaroid = (m, cls = "") => `<div class="polaroid ${cls}"><img class="memory-photo" src="${m.photo}" alt="">${m.caption ? `<p>${esc(m.caption)}</p>` : ""}</div>`;
    if (mine) {
      if (theirs) ls.set(`advent_seenmem_${me}_${d}`, "1");
      el.innerHTML = `${promptBox}
        <h3>${nm(p)}'s memory</h3>
        ${theirs ? polaroid(theirs, "pop") : waiting(`Waiting for ${nm(p)} to share theirs… this page updates by itself.`)}
        <h3>Yours</h3>${polaroid(mine, "tilt")}
        <div class="row"><button class="btn small ghost" id="redo">Change mine</button></div>`;
      el.querySelector("#redo").addEventListener("click", () => form(mine));
      return;
    }
    form();
    function form(prev = {}) {
      el.innerHTML = `${promptBox}
        <p class="muted" style="margin-top:12px">Answer with a photo. ${theirs
          ? `<strong>${nm(p)} already shared theirs 🔒</strong> Share yours to see it!`
          : `${nm(p)} is answering too. You'll see each other's once you've both shared.`}</p>
        <form id="mf">
          <input type="file" id="photo" accept="image/*" class="file-input">
          <label for="photo" class="photo-pick" id="pick">
            ${prev.photo ? `<img class="memory-photo" src="${prev.photo}" alt="Your chosen photo">` : `<span class="big">📷</span><span>Choose a photo</span>`}
          </label>
          <p class="err" id="merr"></p>
          <label for="cap">Add a few words (optional)</label><textarea id="cap" maxlength="400" placeholder="Why this one…">${esc(prev.caption)}</textarea>
          <button class="btn block">Share it 📸</button></form>`;
      let photo = prev.photo || null;
      el.querySelector("#photo").onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const $pick = el.querySelector("#pick");
        $pick.innerHTML = `<span>Getting it ready…</span>`;
        try {
          photo = await shrink(file);
          $pick.innerHTML = `<img class="memory-photo" src="${photo}" alt="Your chosen photo">`;
        } catch {
          photo = null;
          $pick.innerHTML = `<span class="big">📷</span><span>Choose a photo</span>`;
          el.querySelector("#merr").textContent = "That photo couldn't be opened. Try a different one, or a screenshot of it.";
        }
      };
      el.querySelector("#mf").onsubmit = async (e) => {
        e.preventDefault();
        const caption = el.querySelector("#cap").value.trim();
        if (!photo) { el.querySelector("#merr").textContent = "Pick a photo first 📷"; return; }
        await S.set(`day:${d}:memory:${me}`, { photo, caption, by: me, at: now() });
        if (theirs) confetti();
        renderSheet();
      };
    }
  }
  function shrink(file, max = 900) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  function challengeDay(d, el) {
    const p = partner(), c = itemFor(d);
    const mine = S.get(`day:${d}:done:${me}`), theirs = S.get(`day:${d}:done:${p}`);
    el.innerHTML = `<div class="box"><div class="serif" style="font-size:24px;line-height:1.25">${esc(c.text)}</div></div>
      ${mine && theirs ? `<div class="box pop" style="text-align:center;font-size:18px">🎉 You both did it!</div>` : ""}
      <h3>${nm(me)}</h3>${mine ? `<div class="box right">✓ Done</div>` : `<button class="btn block green" id="done">I did it ✓</button>`}
      <h3>${nm(p)}</h3>${theirs ? `<div class="box right">✓ Done</div>` : waiting(`${nm(p)} hasn't ticked it off yet`)}`;
    el.querySelector("#done")?.addEventListener("click", async () => {
      await S.set(`day:${d}:done:${me}`, { by: me, at: now() });
      if (theirs) confetti();
      renderSheet();
    });
  }

  // ── live updates ──
  S.subscribe((state, before) => {
    if (!me) return;
    for (const [k, v] of Object.entries(state)) {
      if (v && v.by === partner() && (!before[k] || before[k].at !== v.at)) {
        const msg = describe(k, v);
        if (msg) toast(msg);
      }
    }
    // don't wipe a half-typed form: only re-render the sheet if no input has focus
    const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing) return;
    render();
  });

  // ── snow ──
  (function snow() {
    const box = document.getElementById("snow");
    for (let i = 0; i < 40; i++) {
      const f = document.createElement("div");
      f.className = "flake"; f.textContent = Math.random() > .5 ? "❄" : "•";
      f.style.left = Math.random() * 100 + "vw";
      f.style.fontSize = 6 + Math.random() * 12 + "px";
      f.style.animationDuration = 8 + Math.random() * 12 + "s";
      f.style.animationDelay = -Math.random() * 20 + "s";
      f.style.setProperty("--drift", (Math.random() * 80 - 40) + "px");
      box.append(f);
    }
  })();

  // ── start ──
  async function start() {
    const pw = ls.get("advent_pass");
    if (pw === null) return gate();
    if (!me || !person(me)) return who();
    $app.innerHTML = `<p class="notice" style="margin-top:30vh">Opening the calendar… 🎄</p>`;
    try { await S.load(pw); }
    catch (x) {
      if (x.wrongPassword) { ls.del("advent_pass"); return gate("The password changed. Enter the new one."); }
      if (x.notSetUp) return message("🛠️", "Almost there", "The database isn't set up yet. Run setup.sql in Supabase first.");
      return message("📡", "Can't connect", "Couldn't reach the calendar. Check your internet and try again.");
    }
    const seenKey = "advent_seen_" + me;
    const last = +ls.get(seenKey) || 0;
    if (last) banner = changesSince(last);
    ls.set(seenKey, String(now()));
    render();
    pushState = await checkPush();
    if (pushState !== "hidden") render();
    followLink(location.hash);
  }
  start();
})();
