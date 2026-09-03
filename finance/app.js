// Bloom finance tracker: app orchestration (auth, data access, views).
// Depends on: supabase.js (window.FinanceDB), snapshot.js (window.Model/fmt).

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  };

  const db = window.FinanceDB;
  const base = () => db.baseCurrency();
  let sb = null;        // supabase client
  let user = null;      // current auth user
  let accounts = [];    // cached accounts
  let incomeDefaults = null;
  let autoRoutes = [];
  let pendingDraft = null; // carries a parsed statement draft across a re-render after new accounts are created

  const CURRENCIES = [
    "HKD", "USD", "EUR", "GBP", "JPY", "CNY", "AUD", "SGD", "IDR",
    "TWD", "KRW", "THB", "MYR", "PHP", "VND", "INR",
    "CAD", "CHF", "NZD", "AED", "SAR", "MOP", "SEK", "NOK", "DKK",
  ];
  const EXPENSE_CATS = ["rent", "food", "transport", "shopping", "travel", "entertainment", "fitness", "gift", "bills", "other"];

  // ── Boot ──────────────────────────────────────────────
  async function boot() {
    sb = db.getClient();
    const cfgErr = db.getConfigError();
    if (!sb) {
      renderConfigNeeded(cfgErr);
      return;
    }
    // Arrived via the email confirmation link? Greet, then let them sign in.
    // (Supabase may also drop a token in the URL hash and create a session; we
    // sign that transient session out so the user logs in fresh on our page.)
    const params = new URLSearchParams(location.search);
    const isConfirm = params.get("confirmed") === "1" || /(\b|#)(type=signup|token_hash=)/.test(location.hash + location.search);
    if (isConfirm) {
      try { await sb.auth.signOut(); } catch {}
      renderConfirmed();
      // still wire the listener below in case they sign in from here
    }

    const { data } = await sb.auth.getSession();
    if (data.session && !isConfirm) {
      user = data.session.user;
      await enterApp();
    } else if (!isConfirm) {
      renderAuth();
    }
    sb.auth.onAuthStateChange((_evt, session) => {
      const nowUser = session ? session.user : null;
      if (nowUser && !user) { user = nowUser; enterApp(); }
      if (!nowUser && user) { user = null; renderAuth(); }
    });
  }

  function setNav(loggedIn) {
    $("#navRight").classList.toggle("hidden", !loggedIn);
    // When signed in, the logo goes to Bloom's home fork (not the public site);
    // when signed out, it's a normal link back to the home page.
    const logo = $("#navLogo");
    if (logo) {
      if (loggedIn) { logo.setAttribute("href", "#"); logo.onclick = (e) => { e.preventDefault(); routeTo("home"); }; }
      else { logo.setAttribute("href", "/"); logo.onclick = null; }
    }
  }

  // ── Config-needed screen (interactive first-run setup) ──
  function renderConfigNeeded(kind) {
    const app = $("#app");
    app.innerHTML = "";
    setNav(false);

    if (kind === "sdk-not-loaded") {
      app.append(el("div", { class: "page-header-shell fade-up fd1" },
        el("h1", {}, "Offline?"),
        el("p", {}, "The Supabase library did not load. Check your internet connection and reload.")));
      return;
    }

    if (kind === "service-role-key") {
      app.append(el("div", { class: "page-header-shell fade-up fd1" },
        el("h1", {}, "Wrong key"),
        el("p", {}, "That looks like the service_role key, which must never be used in a website. Use the anon public key instead (Supabase → Project Settings → API).")));
      return;
    }

    const existing = db.config();
    const urlIn = el("input", { placeholder: "https://xxxx.supabase.co", value: existing.SUPABASE_URL && !existing.SUPABASE_URL.includes("YOUR-PROJECT") ? existing.SUPABASE_URL : "" });
    const keyIn = el("input", { placeholder: "eyJ… (anon public key)", value: existing.SUPABASE_ANON_KEY && !existing.SUPABASE_ANON_KEY.includes("YOUR-ANON") ? existing.SUPABASE_ANON_KEY : "" });
    const passIn = el("input", { placeholder: "invite passkey", value: existing.INVITE_PASSKEY && existing.INVITE_PASSKEY !== "change-me-to-a-secret-phrase" ? existing.INVITE_PASSKEY : "" });
    const curIn = currencySelect(existing.BASE_CURRENCY || "HKD");
    const aiIn = el("input", { type: "checkbox", style: "width:auto;margin:0" });
    if (existing.AI_STATEMENTS) aiIn.checked = true;
    const err = el("div", { class: "error-msg" });
    const saveBtn = el("button", { class: "btn", style: "width:100%" }, "Save & continue");

    saveBtn.addEventListener("click", () => {
      err.textContent = "";
      const url = urlIn.value.trim(), key = keyIn.value.trim();
      if (!/^https:\/\/.+\.supabase\.co/.test(url)) { err.textContent = "Enter your Supabase Project URL (https://…​.supabase.co)."; return; }
      if (key.length < 20) { err.textContent = "Enter your anon public key (a long string starting with eyJ)."; return; }
      const c = db.saveConfig({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, INVITE_PASSKEY: passIn.value, BASE_CURRENCY: curIn.value, AI_STATEMENTS: aiIn.checked });
      if (!c) { err.textContent = "Those values didn't work. Double-check the URL and key."; return; }
      boot(); // re-run startup with the new config
    });

    app.append(
      el("div", { class: "auth-wrap fade-up fd1" },
        el("div", { class: "page-header-shell", style: "margin-top:0" },
          el("h1", {}, "Bloom"),
          el("p", {}, "One-time setup. Enter your Supabase details to connect this device.")
        ),
        el("div", { class: "shell" },
          el("div", { class: "section-hint" }, "Find these in your Supabase dashboard under Project Settings → API. The anon key is safe to store in your browser; your data is protected by row-level security."),
          el("div", { class: "field" }, el("label", {}, "Supabase Project URL"), urlIn),
          el("div", { class: "field" }, el("label", {}, "Anon public key"), keyIn),
          el("div", { class: "field-row" },
            el("div", { class: "field" }, el("label", {}, "Invite passkey"), passIn),
            el("div", { class: "field" }, el("label", {}, "Base currency"), curIn)
          ),
          el("hr", { class: "divider" }),
          el("label", { style: "display:flex;align-items:center;gap:9px;cursor:pointer;margin-bottom:4px" },
            aiIn, el("span", {}, "Enable AI statement reading")),
          el("div", { class: "section-hint", style: "margin-bottom:0" }, "Only turn this on if the parse-statement Edge Function is deployed and your Claude API key is set. Adds an 'upload a statement' option that drafts your numbers for you to confirm."),
          saveBtn, err
        )
      )
    );
  }

  // ── Auth screen ───────────────────────────────────────
  function renderAuth() {
    setNav(false);
    const app = $("#app");
    app.innerHTML = "";
    let mode = "signin";

    const emailIn = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    const passIn = el("input", { type: "password", placeholder: "••••••••", autocomplete: "current-password" });
    const pass2In = el("input", { type: "password", placeholder: "re-enter password", autocomplete: "new-password" });
    const pass2Field = el("div", { class: "field hidden" }, el("label", {}, "Confirm password"), pass2In);
    const inviteIn = el("input", { type: "text", placeholder: "invite passkey", autocomplete: "off" });
    const inviteField = el("div", { class: "field hidden" }, el("label", {}, "Invite passkey"), inviteIn,
      el("div", { class: "section-hint", style: "margin-top:4px;margin-bottom:0" }, "Ask the owner for this. Required to create a new account."));
    const errBox = el("div", { class: "error-msg" });
    const okBox = el("div", { class: "ok-msg" });
    const submitBtn = el("button", { class: "btn", style: "width:100%" }, "Sign in");

    const signinTab = el("button", { class: "active" }, "Sign in");
    const signupTab = el("button", {}, "Create account");
    function setMode(m) {
      mode = m;
      signinTab.classList.toggle("active", m === "signin");
      signupTab.classList.toggle("active", m === "signup");
      submitBtn.textContent = m === "signin" ? "Sign in" : "Create account";
      inviteField.classList.toggle("hidden", m !== "signup");
      pass2Field.classList.toggle("hidden", m !== "signup");
      passIn.setAttribute("autocomplete", m === "signup" ? "new-password" : "current-password");
      errBox.textContent = ""; okBox.textContent = "";
    }
    signinTab.addEventListener("click", () => setMode("signin"));
    signupTab.addEventListener("click", () => setMode("signup"));

    async function submit() {
      errBox.textContent = ""; okBox.textContent = "";
      const email = emailIn.value.trim();
      const password = passIn.value;
      if (!email || !password) { errBox.textContent = "Enter email and password."; return; }
      submitBtn.disabled = true;
      try {
        if (mode === "signin") {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else {
          // Passwords must match and be a sensible length (Supabase min is 6).
          if (password.length < 6) {
            errBox.textContent = "Password must be at least 6 characters.";
            submitBtn.disabled = false; return;
          }
          if (password !== pass2In.value) {
            errBox.textContent = "Passwords don't match. Please re-enter them.";
            submitBtn.disabled = false; return;
          }
          // Invite passkey gate (browser-checked casual gate).
          const expected = db.invitePasskey();
          if (expected && inviteIn.value.trim() !== expected) {
            errBox.textContent = "Invalid invite passkey. Ask the owner for the current one.";
            submitBtn.disabled = false; return;
          }
          // Send the confirmation link back to THIS app (not Supabase's
          // localhost default) with ?confirmed=1 so we can greet + redirect.
          const redirectTo = location.origin + location.pathname + "?confirmed=1";
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
          if (error) throw error;
          if (data.session) { /* auto signed in — confirmation off */ }
          else { renderCheckInbox(email); return; }
        }
      } catch (e) {
        errBox.textContent = e.message || "Something went wrong.";
      } finally {
        submitBtn.disabled = false;
      }
    }
    submitBtn.addEventListener("click", submit);
    passIn.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    app.append(
      el("div", { class: "auth-wrap fade-up fd1" },
        el("div", { class: "page-header-shell", style: "margin-top:0" },
          el("h1", {}, "Bloom"),
          el("p", {}, "Give your money room to bloom. Sign in to continue.")
        ),
        el("div", { class: "shell" },
          el("div", { class: "auth-tabs" }, signinTab, signupTab),
          el("div", { class: "field" }, el("label", {}, "Email"), emailIn),
          el("div", { class: "field" }, el("label", {}, "Password"), passIn),
          pass2Field,
          inviteField,
          submitBtn, errBox, okBox
        )
      )
    );
  }

  // ── "Check your inbox" screen (after signup) ──
  function renderCheckInbox(email) {
    setNav(false);
    const app = $("#app");
    app.innerHTML = "";
    app.append(el("div", { class: "auth-wrap fade-up fd1" },
      el("div", { class: "page-header-shell", style: "margin-top:0" },
        el("h1", {}, "Almost there"),
        el("p", {}, "We sent a confirmation link to your email.")),
      el("div", { class: "shell" },
        el("div", { class: "section-hint", style: "margin-bottom:14px" },
          "Open the email we just sent to ", el("strong", {}, email || "your address"),
          " and tap the confirmation link. Once confirmed, you'll be able to sign in."),
        el("div", { class: "section-hint", style: "margin-bottom:14px" },
          "Don't see it? Check spam, and give it a minute."),
        el("button", { class: "btn btn-ghost", onClick: () => renderAuth() }, "Back to sign in")
      )
    ));
  }

  // ── "You're confirmed" screen (arrived back via the email link) ──
  function renderConfirmed() {
    setNav(false);
    const app = $("#app");
    app.innerHTML = "";
    app.append(el("div", { class: "auth-wrap fade-up fd1" },
      el("div", { class: "page-header-shell", style: "margin-top:0" },
        el("h1", {}, "You're in 🌸"),
        el("p", {}, "Your email is confirmed. Welcome to Bloom.")),
      el("div", { class: "shell" },
        el("div", { class: "section-hint", style: "margin-bottom:14px" }, "Sign in with the email and password you just created."),
        el("button", { class: "btn", style: "width:100%", onClick: () => { history.replaceState(null, "", location.pathname); renderAuth(); } }, "Go to sign in")
      )
    ));
  }

  // ── Enter app (loads accounts + defaults, shows home) ──
  async function enterApp() {
    setNav(true);
    // Claim any wallet seats invited to this email BEFORE the first render, so
    // a wallet someone added you to is already there on first load.
    if (window.Split) await Split.claimInvites();
    await loadAccounts();
    await loadIncomeDefaults();
    await loadAutoRoutes();
    routeTo("home");
  }

  async function loadAccounts() {
    const { data, error } = await sb.from("accounts").select("*").order("sort_order").order("created_at");
    accounts = error ? [] : (data || []);
  }
  async function loadIncomeDefaults() {
    const { data } = await sb.from("income_defaults").select("*").eq("user_id", user.id).maybeSingle();
    incomeDefaults = data || null;
  }
  async function loadAutoRoutes() {
    const { data } = await sb.from("auto_routes").select("*").eq("user_id", user.id);
    autoRoutes = data || [];
  }
  const acctById = (id) => accounts.find((a) => a.id === id);

  // ── Router ────────────────────────────────────────────
  const routes = {};
  function route(name, fn) { routes[name] = fn; }
  async function routeTo(name, arg) {
    const app = $("#app");
    app.innerHTML = "";
    $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.dataset.route === name));
    await routes[name](app, arg);
  }
  window.__financeRoute = routeTo;

  // ── Load full timeline (all snapshots + their rows + all moves) ──
  async function loadTimeline() {
    const [{ data: snaps }, { data: bals }, { data: inc }, { data: moves }, { data: exps }, { data: mkts }] =
      await Promise.all([
        sb.from("snapshots").select("*"),
        sb.from("balances").select("*"),
        sb.from("income").select("*"),
        sb.from("illiquid_moves").select("*"),
        sb.from("expense_lines").select("*"),
        sb.from("market_values").select("*"),
      ]);
    const snapshots = (snaps || []).map((s) => ({
      ...s, _date: periodKey(s.period_year, s.period_month),
      balances: (bals || []).filter((b) => b.snapshot_id === s.id)
        .map((b) => ({ ...b, _accountType: (acctById(b.account_id) || {}).type })),
      income: (inc || []).filter((i) => i.snapshot_id === s.id),
      expenses: (exps || []).filter((e) => e.snapshot_id === s.id),
      marketValues: (mkts || []).filter((m) => m.snapshot_id === s.id),
    }));
    const allMoves = (moves || []).map((m) => {
      const snap = (snaps || []).find((s) => s.id === m.snapshot_id);
      return { ...m, _date: snap ? periodKey(snap.period_year, snap.period_month) : "9999-12" };
    });
    return { snapshots, allMoves };
  }

  // ── HOME (the fork: two independent trackers) ─────────
  // Bloom is two separate trackers behind one login. They never share a screen
  // and never share math: the asset tracker derives spending from net worth,
  // the expense tracker splits shared costs between people.
  route("home", async (app) => {
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Bloom"),
      el("p", {}, "Give your money room to bloom. Pick a tracker to get started.")
    ));

    const installCard = installPrompt();
    if (installCard) app.append(installCard);

    const grid = el("div", { class: "tracker-grid fade-up fd2" });

    // Asset card: latest net worth, or a prompt if nothing is set up yet.
    let assetValue = "Get started", assetHint = "add your accounts";
    if (accounts.length) {
      const { snapshots, allMoves } = await loadTimeline();
      const timeline = Model.computeTimeline(snapshots, allMoves);
      if (timeline.length) {
        const latest = timeline[timeline.length - 1];
        assetValue = fmt(latest.hasMarket ? latest.marketNetWorth : latest.netWorth, base());
        assetHint = "net worth, " + periodLabel(latest.snapshot.period_year, latest.snapshot.period_month);
      } else { assetValue = "Get started"; assetHint = "add your first month"; }
    }
    grid.append(trackerCard({
      icon: TRACKER_ICON.asset,
      title: "Asset Tracker",
      desc: "Net worth, growth, and monthly spending",
      value: assetValue, hint: assetHint,
      onClick: () => routeTo("dashboard"),
    }));

    // Expense card: your overall position across wallets.
    let expValue = "Get started", expHint = "set up a wallet", expSign = null;
    if (window.Split) {
      const wallets = (await Split.loadWallets()).filter((w) => !w.archived);
      if (wallets.length) {
        const positions = await Promise.all(wallets.map(async (w) => {
          const { balances } = await loadWalletLedger(w);
          return { cur: w.base_currency, net: Split.myPosition(w, balances) };
        }));
        const owing = positions.filter((p) => Math.abs(p.net) >= 0.005);
        const count = walletCountLabel(wallets.length);

        if (!owing.length) { expValue = "Settled up"; expHint = count; expSign = 0; }
        else {
          // Wallets are independent and may be in different currencies, so a
          // single total is only meaningful when they all share one. Otherwise
          // report how many wallets are outstanding rather than adding up
          // amounts that aren't in the same units.
          const currencies = [...new Set(owing.map((p) => p.cur))];
          if (currencies.length === 1) {
            const net = owing.reduce((s, p) => s + p.net, 0);
            if (Math.abs(net) < 0.005) { expValue = "Settled up"; expHint = count; expSign = 0; }
            else {
              expValue = fmt(Math.abs(net), currencies[0]);
              expHint = (net > 0 ? "you're owed in " : "you owe across ") + count;
              expSign = net > 0 ? 1 : -1;
            }
          } else {
            expValue = owing.length + (owing.length === 1 ? " wallet" : " wallets");
            expHint = "with a balance, of " + count;
            expSign = null;
          }
        }
      }
    }
    grid.append(trackerCard({
      icon: TRACKER_ICON.expense,
      title: "Expense Tracker",
      desc: "Split bills with friends, flatmates, and partners",
      value: expValue, hint: expHint, sign: expSign,
      onClick: () => routeTo("wallets"),
    }));

    app.append(grid);
  });

  function walletCountLabel(n) { return n + (n === 1 ? " wallet" : " wallets"); }

  // ── Install to Home Screen ────────────────────────────
  // Two very different platforms:
  //   Android/desktop fire `beforeinstallprompt`, which we capture and replay
  //   from a button, so install is one tap.
  //   iOS has no such API — Safari only offers Share -> Add to Home Screen, so
  //   the best we can do is tell people where it is. That matters more than it
  //   sounds: on iOS, notifications only work once the app is installed this
  //   way, so this hint is the gateway to Phase 2.
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();          // stop Chrome's own mini-infobar
    deferredInstall = e;
  });

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;   // iOS
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      // iPadOS 13+ reports as a Mac; the touch check separates it from a real one.
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  const DISMISS_KEY = "bloom_install_dismissed";
  function installDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  }

  function installPrompt() {
    // Already installed, or they've said no — never nag.
    if (isStandalone() || installDismissed()) return null;
    // Nothing useful to say on a desktop browser that can't install.
    if (!deferredInstall && !isIOS()) return null;

    const dismiss = () => {
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
      routeTo("home");
    };

    const action = deferredInstall
      ? el("button", { class: "btn btn-sm", onClick: async () => {
          const evt = deferredInstall;
          deferredInstall = null;
          evt.prompt();
          try { await evt.userChoice; } catch {}
          routeTo("home");
        } }, "Install")
      : null;

    return el("div", { class: "install-card fade-up fd2" },
      el("span", { class: "install-icon" }, "📲"),
      el("span", { class: "install-body" },
        el("span", { class: "install-title" }, "Add Bloom to your home screen"),
        el("span", { class: "install-text" }, isIOS()
          ? "Tap the Share button below, then \u201cAdd to Home Screen\u201d. Bloom opens full-screen, and it's how notifications work later."
          : "Install Bloom for a full-screen app and instant opening.")),
      el("span", { class: "install-actions" },
        action,
        el("button", { class: "btn btn-ghost btn-sm", onClick: dismiss }, "Not now")));
  }

  const TRACKER_ICON = {
    asset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 3 3 5-6 3 3"/><path d="M3 21h18"/></svg>',
    expense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 2 21 6 17 10"/><path d="M21 6H8a4 4 0 0 0-4 4"/><polyline points="7 22 3 18 7 14"/><path d="M3 18h13a4 4 0 0 0 4-4"/></svg>',
  };

  // The two big cards on home. One live number each, so home is useful.
  function trackerCard({ icon, title, desc, value, hint, sign, onClick }) {
    const cls = sign == null ? "" : sign > 0 ? "pos" : sign < 0 ? "neg" : "";
    return el("button", { class: "tracker-card", type: "button", onClick },
      el("span", { class: "tracker-icon", html: icon }),
      el("span", { class: "tracker-body" },
        el("span", { class: "tracker-title" }, title),
        el("span", { class: "tracker-desc" }, desc),
        el("span", { class: "tracker-figure" },
          el("b", { class: "tracker-value " + cls }, value),
          el("span", { class: "tracker-hint" }, hint))),
      el("span", { class: "tracker-chev" }, "›"));
  }

  // ── DASHBOARD (Asset Tracker home) ────────────────────
  route("dashboard", async (app) => {
    app.append(backBar("Home", "home"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Asset Tracker"),
      el("p", {}, "Your assets, growth, and spending, all in one calm place.")
    ));

    if (accounts.length === 0) {
      app.append(el("div", { class: "shell fade-up fd2" },
        el("div", { class: "empty-state" },
          el("p", {}, "First, add the accounts you track: banks, wallets, cash, cards, and illiquid holdings like MPF or stocks."),
          el("div", { class: "btn-row", style: "justify-content:center;margin-top:14px" },
            el("button", { class: "btn", onClick: () => routeTo("accounts") }, "Set up accounts")
          )
        )
      ));
      return;
    }

    const { snapshots, allMoves } = await loadTimeline();
    const timeline = Model.computeTimeline(snapshots, allMoves);

    if (timeline.length === 0) {
      app.append(el("div", { class: "shell fade-up fd2" },
        el("div", { class: "empty-state" },
          el("p", {}, "No months tracked yet. Add your first month to start tracking."),
          el("div", { class: "btn-row", style: "justify-content:center;margin-top:14px" },
            el("button", { class: "btn", onClick: () => routeTo("snapshot") }, "Add a month")
          )
        )
      ));
      return;
    }

    const latest = timeline[timeline.length - 1];
    const c = base();
    const ls = latest.snapshot;
    const updated = fmtUpdated(ls.updated_at || ls.created_at);

    // 1) Action cards at the top (the navigation hub).
    app.append(actionCards());

    // 2) Latest month summary (compact stat grid + calc).
    app.append(el("div", { class: "shell fade-up" },
      el("div", { class: "month-card-head", style: "margin-bottom:10px" },
        el("h3", { style: "margin:0" }, periodLabel(ls.period_year, ls.period_month)),
        updated ? el("span", { class: "section-hint", style: "margin:0" }, "updated " + updated) : null),
      ...monthStatTiles(latest),
      el("div", { style: "margin-top:14px" }, calcLine(latest))
    ));

    // 3) Previous months (each taps into its full summary; mirrors the main view).
    const recent = [...timeline].reverse();
    if (recent.length > 1) {
      const list = el("div", {});
      recent.slice(1).forEach((t) => {
        const monthLabel = periodLabel(t.snapshot.period_year, t.snapshot.period_month);
        const fullNW = t.hasMarket ? t.marketNetWorth : t.netWorth;
        list.append(el("div", { class: "month-card", onClick: () => routeTo("summary", t.snapshot.id) },
          el("div", { class: "month-card-head" },
            el("span", { class: "month-name" }, monthLabel),
            el("span", { class: "month-nw" }, "net worth ", el("b", {}, fmt(fullNW, c)))),
          calcLine(t)));
      });
      app.append(el("div", { class: "shell fade-up" },
        el("h3", {}, "Previous months"),
        el("div", { class: "section-hint" }, "Tap a month for its full summary."),
        list));
    }

    // 4) Statistics (charts).
    if (window.Charts) {
      const chartInner = el("div", {});
      Charts.render(chartInner, timeline, c);
      app.append(el("div", { class: "shell fade-up" }, el("h3", {}, "Statistics"), chartInner));
    }
  });

  function statTile(label, value, signHint, sub) {
    const cls = signHint == null ? "" : signHint > 0 ? "pos" : signHint < 0 ? "neg" : "";
    return el("div", { class: "stat" },
      el("div", { class: "stat-label" }, label),
      el("div", { class: "stat-value " + cls }, value),
      sub ? el("div", { class: "stat-sub" }, sub) : null
    );
  }

  // The full stat grid for a month `t` — ONE compact responsive grid of all
  // tiles (flows 3-across on PC, 2 on phone). Shared by dashboard + summary.
  function monthStatTiles(t) {
    const c = base();
    // Full net worth = liquid + illiquid(market where entered, else at-cost) − liabilities.
    const fullNW = t.hasMarket ? t.marketNetWorth : t.netWorth;
    return [el("div", { class: "stat-grid" },
      statTile("Total net worth", fmt(fullNW, c), null, "all assets − liabilities"),
      statTile("Growth", t.deltaNW === null ? "—" : fmtSigned(t.deltaNW, c), t.deltaNW, "vs previous month"),
      statTile("Income", t.income ? fmt(t.income, c) : fmt(0, c), null, "this month"),
      statTile("Expense", t.expense === null ? "not yet" : fmt(t.expense, c), t.expense === null ? null : -1, "income minus growth"),
      statTile("Liquid", fmt(t.liquid, c)),
      statTile(t.hasMarket ? "Illiquid (market)" : "Illiquid (at cost)", fmt(t.hasMarket ? t.illiquidMarket : t.illiquidCost, c)),
      statTile("Liabilities", t.liabilities ? fmt(-t.liabilities, c) : fmt(0, c), t.liabilities ? -1 : 0),
    )];
  }

  // The "Income − Growth = Spent" line for a month.
  function calcLine(t) {
    const c = base();
    if (t.expense === null) return el("div", { class: "calc-line muted" }, "First month, so there's no prior month to compare against yet.");
    return el("div", { class: "calc-line" },
      el("span", {}, "Income "), el("b", {}, fmt(t.income, c)),
      el("span", { class: "calc-op" }, "−"),
      el("span", {}, "Growth "), el("b", { class: t.deltaNW >= 0 ? "pos" : "neg" }, fmtSigned(t.deltaNW, c)),
      el("span", { class: "calc-op" }, "="),
      el("span", {}, "Spent "), el("b", { class: "neg" }, fmt(t.expense, c)));
  }

  // Aggregate a snapshot's expense_lines into [{label, amount}] summed by category.
  function aggregateExpenses(t) {
    const by = {};
    (t.snapshot.expenses || []).forEach((e) => {
      const cat = (e.category || e.label || "other");
      by[cat] = (by[cat] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(by).map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  }

  // Icon action-cards — the dashboard's navigation hub (replaces top tabs).
  function actionCards() {
    const card = (icon, title, sub, onClick) => el("button", { class: "action-card", type: "button", onClick },
      el("span", { class: "action-icon", html: icon }),
      el("span", { class: "action-text" }, el("span", { class: "action-title" }, title), el("span", { class: "action-sub" }, sub)));
    const ICON = {
      add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>',
      accounts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    };
    return el("div", { class: "action-grid fade-up fd2" },
      card(ICON.add, "Add a month", "record this month", () => routeTo("snapshot")),
      card(ICON.history, "History", "browse & edit months", () => routeTo("history")),
      card(ICON.accounts, "Accounts", "banks, cards, holdings", () => routeTo("accounts")));
  }

  // A prominent top back-bar for sub-pages (→ dashboard by default).
  function backBar(label, route, arg) {
    const back = el("button", { class: "back-bar", type: "button",
      onClick: () => routeTo(route || "dashboard", arg) },
      el("span", { class: "back-arrow", html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>' }),
      el("span", {}, label || "Dashboard"));
    return back;
  }

  // ── MONTH SUMMARY (read-only) ─────────────────────────
  route("summary", async (app, snapshotId) => {
    const { snapshots, allMoves } = await loadTimeline();
    const timeline = Model.computeTimeline(snapshots, allMoves);
    const t = timeline.find((x) => x.snapshot.id === snapshotId);
    if (!t) { routeTo("dashboard"); return; }
    const c = base();
    const s = t.snapshot;

    app.append(backBar("Dashboard"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, periodLabel(s.period_year, s.period_month)),
      el("p", {}, s.note ? s.note : "Month summary.")
    ));

    // Stats + the calculation line.
    app.append(el("div", { class: "shell fade-up fd2" },
      ...monthStatTiles(t),
      el("div", { style: "margin-top:14px" }, calcLine(t))
    ));

    // Spending breakdown pie (aggregated expense lines).
    if (window.Charts) {
      const agg = aggregateExpenses(t);
      const pieShell = el("div", { class: "shell fade-up fd3" });
      pieShell.appendChild(Charts.spendingPie(agg, c));
      app.append(pieShell);
    }

    // Edit action (back is at the top now).
    app.append(el("div", { class: "btn-row fade-up fd3", style: "margin-top:16px" },
      el("button", { class: "btn", onClick: () => routeTo("snapshot", s.id) }, "Edit this month")
    ));
  });

  // ── ACCOUNTS ──────────────────────────────────────────
  route("accounts", async (app) => {
    app.append(backBar("Dashboard"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Accounts"),
      el("p", {}, "The banks, wallets, cash, cards and illiquid holdings you track.")
    ));

    const listShell = el("div", { class: "shell fade-up fd2" });
    function renderList() {
      listShell.innerHTML = "";
      listShell.append(el("h3", {}, "Your accounts"));
      if (accounts.length === 0) {
        listShell.append(el("div", { class: "empty-state" }, "No accounts yet. Add one below."));
      } else {
        const groups = { liquid: [], illiquid: [], liability: [] };
        accounts.forEach((a) => groups[a.type].push(a));
        for (const [type, label] of [["liquid", "Liquid (banks, wallets, cash)"], ["illiquid", "Illiquid (MPF, stocks, deposits)"], ["liability", "Liabilities (credit cards)"]]) {
          if (groups[type].length === 0) continue;
          listShell.append(el("div", { class: "section-hint", style: "margin-top:12px;margin-bottom:6px" }, label));
          const wrap = el("div", { class: "line-list" });
          for (const a of groups[type]) wrap.append(accountRow(a));
          listShell.append(wrap);
        }
      }
    }

    // One account row, with inline rename (✎) and delete (✕).
    function accountRow(a) {
      const row = el("div", { class: "line-item" });
      function viewMode() {
        row.innerHTML = "";
        row.append(
          el("span", { class: "li-name" }, a.name),
          el("span", { class: "tag" }, a.currency),
          el("button", { class: "btn-icon", title: "Rename", onClick: editMode }, "✎"),
          el("button", { class: "btn-icon", title: "Delete", onClick: () => deleteAccount(a) }, "✕")
        );
      }
      function editMode() {
        row.innerHTML = "";
        const inp = el("input", { value: a.name, style: "flex:1" });
        const save = async () => {
          const name = inp.value.trim();
          if (!name || name === a.name) { viewMode(); return; }
          const { error } = await sb.from("accounts").update({ name }).eq("id", a.id);
          if (!error) { a.name = name; await loadAccounts(); }
          viewMode();
        };
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); if (e.key === "Escape") viewMode(); });
        row.append(inp,
          el("button", { class: "btn btn-sm", onClick: save }, "Save"),
          el("button", { class: "btn-icon", title: "Cancel", onClick: viewMode }, "✕"));
        inp.focus();
      }
      viewMode();
      return row;
    }

    async function deleteAccount(a) {
      if (!confirm(`Delete "${a.name}"? Its balance lines in past months will also be removed.`)) return;
      await sb.from("accounts").delete().eq("id", a.id);
      await loadAccounts();
      await loadAutoRoutes(); // a deleted illiquid account cascades its routes away
      routeTo("accounts");
    }

    const nameIn = el("input", { placeholder: "e.g. HSBC Savings" });
    const typeSel = el("select", {},
      el("option", { value: "liquid" }, "Liquid (bank, wallet, cash)"),
      el("option", { value: "illiquid" }, "Illiquid (MPF, stocks, deposit)"),
      el("option", { value: "liability" }, "Liability (credit card)")
    );
    const curSel = currencySelect(base());
    const addErr = el("div", { class: "error-msg" });
    const addBtn = el("button", { class: "btn" }, "Add account");
    addBtn.addEventListener("click", async () => {
      addErr.textContent = "";
      const name = nameIn.value.trim();
      if (!name) { addErr.textContent = "Give the account a name."; return; }
      addBtn.disabled = true;
      const { error } = await sb.from("accounts").insert({
        name, type: typeSel.value, currency: curSel.value,
        sort_order: accounts.length,
      });
      addBtn.disabled = false;
      if (error) { addErr.textContent = error.message; return; }
      nameIn.value = "";
      await loadAccounts();
      routeTo("accounts"); // rebuild so auto-route dropdowns pick up a new illiquid account
    });

    const addShell = el("div", { class: "shell fade-up fd3" },
      el("h3", {}, "Add an account"),
      el("div", { class: "field" }, el("label", {}, "Name"), nameIn),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Type"), typeSel),
        el("div", { class: "field" }, el("label", {}, "Currency"), curSel)
      ),
      addBtn, addErr
    );

    renderList();
    app.append(listShell, addShell);
    app.append(incomeDefaultsShell());
  });

  function currencySelect(selected) {
    const s = el("select", {});
    for (const c of CURRENCIES) s.append(el("option", { value: c, ...(c === selected ? { selected: "" } : {}) }, c));
    return s;
  }

  // Income defaults editor (fixed salary + optional MULTIPLE auto-routes).
  // `refresh` re-renders the whole accounts view so newly-added illiquid
  // accounts appear in the route dropdowns without a page refresh.
  function incomeDefaultsShell(refresh) {
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "0", value: incomeDefaults ? incomeDefaults.fixed_amount : "" });
    const curSel = currencySelect(incomeDefaults ? incomeDefaults.currency : base());
    const illiquidAccts = accounts.filter((a) => a.type === "illiquid");
    const noIlliquid = illiquidAccts.length === 0;
    const msg = el("div", { class: "ok-msg" });

    // Info popover (unchanged wording, updated for "routes").
    const infoClose = el("button", { class: "info-close", type: "button", title: "Close" }, "✕");
    const infoPop = el("div", { class: "info-pop hidden" },
      infoClose,
      el("span", { html:
        "<strong>Auto-route</strong> takes a slice of your <strong>fixed income</strong> and records it as a contribution into an illiquid account (for example, part of your salary that goes straight into MPF).<br><br>" +
        "It does <strong>not</strong> add to your income. Your total income stays the same; the slice is just logged so your illiquid holdings grow correctly each month. You can add one route per illiquid account." }));
    infoClose.addEventListener("click", () => infoPop.classList.add("hidden"));
    const infoBtn = el("button", { class: "info-btn", type: "button", title: "What is auto-route?",
      onClick: () => infoPop.classList.toggle("hidden") }, "i");
    const infoAnchor = el("span", { class: "info-anchor" }, infoBtn, infoPop);

    // Dynamic list of route rows. Each row = a dropdown (illiquid account) + amount.
    const routesWrap = el("div", { class: "line-list" });
    function routeSelect(selectedId) {
      const s = el("select", {});
      if (noIlliquid) { s.append(el("option", { value: "" }, "no illiquid accounts yet")); s.disabled = true; }
      else { illiquidAccts.forEach((a) => s.append(el("option", { value: a.id, ...(a.id === selectedId ? { selected: "" } : {}) }, a.name))); }
      return s;
    }
    function addRouteRow(data) {
      const sel = routeSelect(data ? data.account_id : null);
      const amt = el("input", { type: "number", step: "0.01", placeholder: "amount", value: data ? data.amount : "", style: "max-width:130px" });
      const row = el("div", { class: "line-item route-row" },
        el("div", { class: "li-inputs" }, sel, amt),
        el("button", { class: "btn-icon", type: "button", title: "Remove", onClick: () => row.remove() }, "✕"));
      row._read = () => ({ account_id: sel.value || null, amount: Number(amt.value) || 0 });
      routesWrap.append(row);
    }
    autoRoutes.forEach((r) => addRouteRow(r));

    const addRouteBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button" }, "+ Add auto-route");
    addRouteBtn.addEventListener("click", () => addRouteRow(null));
    if (noIlliquid) { addRouteBtn.disabled = true; addRouteBtn.title = "Add an illiquid account first, then it appears here."; }

    const saveBtn = el("button", { class: "btn" }, "Save defaults");
    saveBtn.addEventListener("click", async () => {
      msg.textContent = "";
      saveBtn.disabled = true;
      try {
        // Save fixed income
        const { error: e1 } = await sb.from("income_defaults").upsert({
          user_id: user.id, fixed_amount: Number(amtIn.value) || 0, currency: curSel.value,
          auto_route_illiquid_account_id: null, auto_route_amount: 0, // legacy cols kept null
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        if (e1) throw e1;
        // Replace all auto_routes with the current rows (only valid ones).
        const rows = $$(".route-row", routesWrap).map((r) => r._read()).filter((r) => r.account_id && r.amount > 0)
          .map((r) => ({ user_id: user.id, account_id: r.account_id, amount: r.amount, currency: curSel.value }));
        await sb.from("auto_routes").delete().eq("user_id", user.id);
        if (rows.length) { const { error: e2 } = await sb.from("auto_routes").insert(rows); if (e2) throw e2; }
        await loadIncomeDefaults();
        await loadAutoRoutes();
        msg.className = "ok-msg"; msg.textContent = "Saved. New months will pre-fill this.";
      } catch (e) {
        msg.className = "error-msg"; msg.textContent = e.message || "Could not save.";
      } finally {
        saveBtn.disabled = false;
      }
    });

    return el("div", { class: "shell fade-up fd3" },
      el("h3", {}, "Income defaults"),
      el("div", { class: "section-hint" }, "Your fixed monthly income pre-fills each new month so you do not retype it."),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Fixed monthly income"), amtIn),
        el("div", { class: "field" }, el("label", {}, "Currency"), curSel)
      ),
      el("hr", { class: "divider" }),
      el("label", { style: "display:inline-flex;align-items:center;margin-bottom:6px" }, "Auto-routes", infoAnchor),
      noIlliquid
        ? el("div", { class: "section-hint", style: "margin-bottom:8px" }, "Add an illiquid account above (MPF, stocks, deposit) and it will appear here to route into.")
        : el("div", { class: "section-hint", style: "margin-bottom:8px" }, "Route slices of your fixed income into illiquid accounts. Add one per account."),
      routesWrap,
      el("div", { class: "btn-row" }, addRouteBtn),
      el("hr", { class: "divider" }),
      saveBtn, msg
    );
  }

  // ── SNAPSHOT (new or edit) ────────────────────────────
  route("snapshot", async (app, snapshotId) => {
    if (accounts.length === 0) { routeTo("accounts"); return; }
    const editing = !!snapshotId;

    // Load existing snapshot rows if editing
    let existing = null;
    if (editing) {
      const [{ data: s }, { data: bals }, { data: moves }, { data: inc }, { data: exps }, { data: mkts }] = await Promise.all([
        sb.from("snapshots").select("*").eq("id", snapshotId).single(),
        sb.from("balances").select("*").eq("snapshot_id", snapshotId),
        sb.from("illiquid_moves").select("*").eq("snapshot_id", snapshotId),
        sb.from("income").select("*").eq("snapshot_id", snapshotId),
        sb.from("expense_lines").select("*").eq("snapshot_id", snapshotId),
        sb.from("market_values").select("*").eq("snapshot_id", snapshotId),
      ]);
      existing = { snap: s, bals: bals || [], moves: moves || [], inc: inc || [], exps: exps || [], mkts: mkts || [] };
    }

    app.append(editing ? backBar("History", "history") : backBar("Dashboard"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, editing ? "Edit month" : "Add a month"),
      el("p", {}, "Record end-of-month balances. Your expense is worked out automatically.")
    ));

    // Month + year + note
    const now = new Date();
    const curYear = existing ? existing.snap.period_year : now.getFullYear();
    const curMonth = existing ? existing.snap.period_month : (now.getMonth() + 1);
    const monthSel = el("select", {});
    MONTH_NAMES.forEach((m, i) => monthSel.append(el("option", { value: i + 1, ...((i + 1) === curMonth ? { selected: "" } : {}) }, m)));
    const yearSel = el("select", {});
    // Only current year or earlier (no future months allowed).
    for (let y = now.getFullYear(); y >= now.getFullYear() - 8; y--) {
      yearSel.append(el("option", { value: y, ...(y === curYear ? { selected: "" } : {}) }, String(y)));
    }
    // When the current year is selected, disable future months in the Month list.
    function syncMonthLimits() {
      const y = Number(yearSel.value);
      const maxMonth = (y === now.getFullYear()) ? (now.getMonth() + 1) : 12;
      [...monthSel.options].forEach((opt) => { opt.disabled = Number(opt.value) > maxMonth; });
      if (Number(monthSel.value) > maxMonth) monthSel.value = String(maxMonth);
    }
    yearSel.addEventListener("change", syncMonthLimits);
    syncMonthLimits();
    const noteIn = el("input", { placeholder: "optional note", value: existing ? (existing.snap.note || "") : "" });

    // Balance rows for liquid + liability accounts
    const balAccounts = accounts.filter((a) => a.type === "liquid" || a.type === "liability");
    const balRows = balAccounts.map((a) => {
      const prior = existing ? existing.bals.find((b) => b.account_id === a.id) : null;
      return makeBalanceRow(a, prior);
    });

    // Illiquid moves (dynamic list)
    const illiquidAccounts = accounts.filter((a) => a.type === "illiquid");
    const movesWrap = el("div", { class: "line-list" });
    function addMoveRow(data) {
      if (illiquidAccounts.length === 0) return;
      movesWrap.append(makeMoveRow(illiquidAccounts, data, (row) => row.remove()));
    }
    if (existing) existing.moves.forEach((m) => addMoveRow(m));

    // Current market value rows — one per illiquid account (optional, info only).
    const marketRows = illiquidAccounts.map((a) => {
      const prior = existing ? existing.mkts.find((m) => m.account_id === a.id) : null;
      return makeMarketRow(a, prior);
    });

    // Income rows: fixed (prefilled) + side (dynamic)
    const incomeWrap = el("div", { class: "line-list" });
    function addIncomeRow(data) {
      incomeWrap.append(makeIncomeRow(data, (row) => row.remove()));
    }
    if (existing) {
      existing.inc.forEach((i) => addIncomeRow(i));
    } else if (incomeDefaults && Number(incomeDefaults.fixed_amount) > 0) {
      addIncomeRow({ kind: "fixed", label: "Salary", amount: incomeDefaults.fixed_amount, currency: incomeDefaults.currency, exchange_rate: rateFor(incomeDefaults.currency) });
    }

    // Expense breakdown rows (dynamic)
    const expWrap = el("div", { class: "line-list" });
    function addExpRow(data) { expWrap.append(makeExpenseRow(data, (row) => row.remove())); }
    if (existing) existing.exps.forEach((e) => addExpRow(e));

    const err = el("div", { class: "error-msg" });
    const saveBtn = el("button", { class: "btn" }, editing ? "Save changes" : "Save snapshot");

    // Auto-route preview note (lists all routes that will pre-fill).
    const activeRoutes = (!editing) ? autoRoutes.filter((r) => r.account_id && Number(r.amount) > 0) : [];
    const autoRouteNote = activeRoutes.length
      ? el("div", { class: "section-hint" }, "These slices of your fixed income will be recorded as illiquid contributions: " +
          activeRoutes.map((r) => `${r.amount} ${r.currency} → ${(acctById(r.account_id) || {}).name || "illiquid"}`).join(", ") + ".")
      : null;

    saveBtn.addEventListener("click", () => saveSnapshot());

    async function saveSnapshot() {
      err.textContent = "";
      const period_year = Number(yearSel.value);
      const period_month = Number(monthSel.value);
      // Block future months: only the current month or earlier is allowed.
      const nowD = new Date();
      const curY = nowD.getFullYear(), curM = nowD.getMonth() + 1;
      if (period_year > curY || (period_year === curY && period_month > curM)) {
        err.textContent = "You can only add the current month or a past one, not a future month.";
        return;
      }
      saveBtn.disabled = true;
      try {
        // Enforce one snapshot per month (unless editing this same one).
        const { snapshots: allSnaps } = await loadTimeline();
        const clash = allSnaps.find((s) => s.period_year === period_year && s.period_month === period_month && s.id !== snapshotId);
        if (clash) {
          err.textContent = `You already have ${periodLabel(period_year, period_month)}. Open it from History to edit instead.`;
          saveBtn.disabled = false; return;
        }
        let sid = snapshotId;
        const nowIso = new Date().toISOString();
        if (editing) {
          await sb.from("snapshots").update({ period_year, period_month, note: noteIn.value, updated_at: nowIso }).eq("id", sid);
          // wipe child rows and re-insert (simplest correct approach)
          await Promise.all([
            sb.from("balances").delete().eq("snapshot_id", sid),
            sb.from("illiquid_moves").delete().eq("snapshot_id", sid),
            sb.from("income").delete().eq("snapshot_id", sid),
            sb.from("expense_lines").delete().eq("snapshot_id", sid),
            sb.from("market_values").delete().eq("snapshot_id", sid),
          ]);
        } else {
          const { data, error } = await sb.from("snapshots").insert({ period_year, period_month, base_currency: base(), note: noteIn.value, updated_at: nowIso }).select().single();
          if (error) throw error;
          sid = data.id;
        }

        // balances
        const balPayload = balRows.map((r) => r.read()).filter((r) => r.amount !== null)
          .map((r) => ({ snapshot_id: sid, account_id: r.account_id, amount: r.amount, currency: r.currency, exchange_rate: r.exchange_rate }));
        if (balPayload.length) { const { error } = await sb.from("balances").insert(balPayload); if (error) throw error; }

        // illiquid moves (+ auto-routes on new snapshots)
        const movePayload = $$(".move-row", movesWrap).map((r) => r._read()).filter((r) => r && r.amount > 0)
          .map((r) => ({ snapshot_id: sid, ...r }));
        if (!editing) {
          autoRoutes.filter((r) => r.account_id && Number(r.amount) > 0).forEach((r) => {
            movePayload.push({
              snapshot_id: sid, account_id: r.account_id, direction: "in",
              amount: Number(r.amount), currency: r.currency || base(),
              exchange_rate: (r.currency || base()) === base() ? 1 : 1,
            });
          });
        }
        if (movePayload.length) { const { error } = await sb.from("illiquid_moves").insert(movePayload); if (error) throw error; }

        // income
        const incPayload = $$(".income-row", incomeWrap).map((r) => r._read()).filter((r) => r && r.amount > 0)
          .map((r) => ({ snapshot_id: sid, ...r }));
        if (incPayload.length) { const { error } = await sb.from("income").insert(incPayload); if (error) throw error; }

        // expense lines
        const expPayload = $$(".exp-row", expWrap).map((r) => r._read()).filter((r) => r && r.amount > 0)
          .map((r) => ({ snapshot_id: sid, ...r }));
        if (expPayload.length) { const { error } = await sb.from("expense_lines").insert(expPayload); if (error) throw error; }

        // market values (optional current value per illiquid account)
        const mktPayload = marketRows.map((r) => r.read()).filter((r) => r != null)
          .map((r) => ({ snapshot_id: sid, ...r }));
        if (mktPayload.length) { const { error } = await sb.from("market_values").insert(mktPayload); if (error) throw error; }

        routeTo("dashboard");
      } catch (e) {
        err.textContent = e.message || "Could not save.";
        saveBtn.disabled = false;
      }
    }

    // Assemble form
    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Which month"),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Month"), monthSel),
        el("div", { class: "field" }, el("label", {}, "Year"), yearSel),
        el("div", { class: "field" }, el("label", {}, "Note"), noteIn)
      )
    ));

    // AI statement upload (Phase 3) — only when enabled + configured.
    if (window.BloomStatements && db.aiEnabled && db.aiEnabled()) {
      const curPeriod = () => ({ year: Number(yearSel.value), month: Number(monthSel.value) });
      app.append(window.BloomStatements.widget((draft) => applyDraft(draft), accounts, curPeriod));
    }

    // Apply a parsed statement draft into the form. Each drafted balance carries
    // an _acct assignment ("" | account id | "__new__"). We first CREATE any new
    // accounts the user asked for, then (if any were created) re-render the form
    // with a pending-apply payload so the new rows exist to receive the values.
    async function applyDraft(draft) {
      if (!draft) return;
      // Any unassigned lines still needing a choice?
      const allLines = [...(draft.balances || []), ...(draft.liabilities || []), ...(draft.illiquid_balances || [])];
      if (allLines.some((b) => !b._acct)) {
        err.className = "error-msg";
        err.textContent = "Some balances have no account chosen. Pick an account (or '+ new account') for each highlighted line.";
        return;
      }
      // Create the new accounts (one per line marked "__new__").
      let created = false;
      const newFor = async (b, type) => {
        const { data, error } = await sb.from("accounts").insert({ name: (b.name || "New account").trim(), type, currency: b.currency || base(), sort_order: accounts.length }).select().single();
        if (!error && data) { b._acct = data.id; created = true; }
      };
      for (const b of (draft.balances || [])) if (b._acct === "__new__") await newFor(b, "liquid");
      for (const b of (draft.liabilities || [])) if (b._acct === "__new__") await newFor(b, "liability");
      for (const b of (draft.illiquid_balances || [])) if (b._acct === "__new__") await newFor(b, "illiquid");

      if (created) {
        // New accounts exist now — reload and re-render the form, carrying the
        // draft so its values get applied against the fresh rows.
        await loadAccounts();
        pendingDraft = draft;
        routeTo("snapshot", snapshotId);
        return;
      }
      applyDraftToRows(draft);
    }

    // Put the (fully account-assigned) draft values into the form rows.
    function applyDraftToRows(draft) {
      const byId = (rows, id) => rows.find((r) => r.account.id === id);
      (draft.balances || []).forEach((b) => { const r = byId(balRows, b._acct); if (r) r.set(b.amount, b.exchange_rate_to_hkd); });
      (draft.liabilities || []).forEach((b) => { const r = byId(balRows, b._acct); if (r) r.set(b.amount, null); });
      (draft.illiquid_balances || []).forEach((b) => { const r = byId(marketRows, b._acct); if (r) r.set(b.amount); });
      // Apply ONLY the current month's spending portion (cross-month statements
      // split into multiple month groups; other months are applied when you add
      // them). Fall back to a flat _categories list for legacy drafts.
      const curY = Number(yearSel.value), curM = Number(monthSel.value);
      let cats = [];
      if (Array.isArray(draft._months)) {
        const mg = draft._months.find((g) => g.year === curY && g.month === curM);
        cats = mg ? mg.categories : [];
      } else {
        cats = draft._categories || [];
      }
      cats.filter((c) => c.category && Number(c.amount) > 0)
        .forEach((c) => addExpRow({ category: c.category, label: c.category, amount: Math.round(Number(c.amount)) }));
      err.className = "ok-msg";
      const other = Array.isArray(draft._months) && draft._months.some((g) => (g.year !== curY || g.month !== curM) && g.total > 0);
      err.textContent = "Draft applied." + (other ? " Note: this statement also has spending in another month. Open that month to apply its part." : " Review below, then save.");
      err.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // If we re-rendered after creating accounts, apply the carried draft now.
    if (pendingDraft) { const d = pendingDraft; pendingDraft = null; setTimeout(() => applyDraftToRows(d), 0); }

    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Balances"),
      el("div", { class: "section-hint" },
        "Enter what each account showed on the day of this snapshot. For a credit card, that's what you still owe right now: if you've already paid the bill, enter 0. Foreign accounts: set the rate to " + base() + "."),
      liabilityInfo(),
      el("div", { class: "line-list" }, balRows.map((r) => r.node))
    ));

    if (illiquidAccounts.length > 0) {
      const addMoveBtn = el("button", { class: "btn btn-ghost btn-sm" }, "+ Add contribution / withdrawal");
      addMoveBtn.addEventListener("click", () => addMoveRow(null));
      app.append(el("div", { class: "shell fade-up fd2" },
        el("h3", {}, "Illiquid moves (at cost)"),
        el("div", { class: "section-hint" }, "Money you put IN or took OUT this month (at cost). Not market changes."),
        movesWrap,
        el("div", { class: "btn-row" }, addMoveBtn)
      ));

      // Current market value (optional, informational)
      app.append(el("div", { class: "shell fade-up fd2" },
        el("h3", {}, "Current market value (optional)"),
        el("div", { class: "section-hint" }, "Today's value of each holding (optional). Shown separately; doesn't affect expense. Blank = use at-cost."),
        el("div", { class: "line-list" }, marketRows.map((r) => r.node))
      ));
    }

    const addIncBtn = el("button", { class: "btn btn-ghost btn-sm" }, "+ Add income");
    addIncBtn.addEventListener("click", () => addIncomeRow(null));
    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Income"),
      el("div", { class: "section-hint" }, "Salary is pre-filled. Add any extra income (bonus, gift)."),
      autoRouteNote,
      incomeWrap,
      el("div", { class: "btn-row" }, addIncBtn)
    ));

    const addExpBtn = el("button", { class: "btn btn-ghost btn-sm" }, "+ Add expense line");
    addExpBtn.addEventListener("click", () => addExpRow(null));
    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Big-picture expenses (optional)"),
      el("div", { class: "section-hint" }, "A rough breakdown only. Your real total comes from net-worth change."),
      expWrap,
      el("div", { class: "btn-row" }, addExpBtn)
    ));

    const btnRow = el("div", { class: "btn-row" }, saveBtn,
      el("button", { class: "btn btn-ghost", onClick: () => routeTo(editing ? "history" : "dashboard") }, "Cancel"));
    if (editing) {
      const delBtn = el("button", { class: "btn btn-ghost", style: "margin-left:auto;color:var(--neg);border-color:var(--neg)" }, "Delete this month");
      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete this entire month?")) return;
        await sb.from("snapshots").delete().eq("id", snapshotId);
        routeTo("history");
      });
      btnRow.append(delBtn);
    }
    app.append(el("div", { class: "shell fade-up fd3" }, btnRow, err));
  });

  function rateFor(currency) { return currency === base() ? 1 : ""; }

  // A balance row for a fixed account (liquid or liability)
  function makeBalanceRow(account, prior) {
    const isForeign = account.currency !== base();
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "0", value: prior ? prior.amount : "" });
    const rateIn = el("input", { type: "number", step: "0.000001", placeholder: "rate → " + base(), value: prior ? prior.exchange_rate : (isForeign ? "" : 1) });
    if (!isForeign) rateIn.value = 1;
    // For a card, "I've paid it" is the common case and typing 0 next to a
    // statement that says 3,000 feels wrong. This sets the field to 0 rather
    // than hiding a value, so what's stored is always what you actually owe:
    // the money has already left your bank, so the debt is genuinely gone.
    //
    // Nothing about your spending is lost by doing this. The AMOUNT you spent
    // is already visible as the drop in your bank balance, and WHAT you spent
    // it on lives in expense_lines, a separate table this field never feeds.
    const paidBtn = account.type === "liability"
      ? el("button", { class: "btn btn-ghost btn-sm", type: "button",
          title: "Already paid, so nothing is owed now. Your spending is still recorded: the amount shows as the drop in your bank balance, and the categories are kept separately below.",
          onClick: () => { amtIn.value = 0; amtIn.dispatchEvent(new Event("input")); } }, "Paid it")
      : null;

    const node = el("div", { class: "line-item" },
      el("span", { class: "li-name" }, account.name,
        account.type === "liability" ? el("span", { class: "tag", style: "margin-left:6px;background:rgba(192,68,63,0.12);color:var(--neg)" }, "owe") : null),
      el("div", { class: "li-inputs" },
        amtIn,
        el("span", { class: "tag", style: "align-self:center" }, account.currency),
        isForeign ? rateIn : null,
        paidBtn
      )
    );
    return {
      node,
      account,
      read() {
        const amount = amtIn.value === "" ? null : Number(amtIn.value);
        const exchange_rate = isForeign ? (Number(rateIn.value) || 1) : 1;
        return { account_id: account.id, amount, currency: account.currency, exchange_rate };
      },
      set(amount, rate) {
        if (amount != null && isFinite(amount)) amtIn.value = amount;
        if (isForeign && rate != null && isFinite(rate)) rateIn.value = rate;
      },
    };
  }

  // A current-market-value row for one illiquid account (optional). Leaving it
  // blank means "no market value this month" (falls back to at-cost).
  function makeMarketRow(account, prior) {
    const isForeign = account.currency !== base();
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "current value (optional)", value: prior ? prior.amount : "" });
    const rateIn = el("input", { type: "number", step: "0.000001", placeholder: "rate → " + base(), value: prior ? prior.exchange_rate : (isForeign ? "" : 1) });
    if (!isForeign) rateIn.value = 1;
    const node = el("div", { class: "line-item" },
      el("span", { class: "li-name" }, account.name),
      el("div", { class: "li-inputs" }, amtIn, el("span", { class: "tag", style: "align-self:center" }, account.currency), isForeign ? rateIn : null));
    return {
      node, account,
      read() {
        const amount = amtIn.value === "" ? null : Number(amtIn.value);
        const exchange_rate = isForeign ? (Number(rateIn.value) || 1) : 1;
        return amount == null ? null : { account_id: account.id, amount, currency: account.currency, exchange_rate };
      },
      set(amount) { if (amount != null && isFinite(amount)) amtIn.value = amount; },
    };
  }

  function makeMoveRow(illiquidAccounts, data, onRemove) {
    const acctSel = el("select", {});
    illiquidAccounts.forEach((a) => acctSel.append(el("option", { value: a.id, ...(data && data.account_id === a.id ? { selected: "" } : {}) }, a.name)));
    const dirSel = el("select", {},
      el("option", { value: "in", ...(data && data.direction === "in" ? { selected: "" } : {}) }, "In (contribute)"),
      el("option", { value: "out", ...(data && data.direction === "out" ? { selected: "" } : {}) }, "Out (withdraw)"));
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "amount", value: data ? data.amount : "" });
    const initCur = data ? data.currency : base();
    const curSel = currencySelect(initCur);
    const rateIn = el("input", { type: "number", step: "0.000001", placeholder: "rate", value: data ? data.exchange_rate : 1 });
    const row = el("div", { class: "line-item move-row" },
      el("div", { class: "li-inputs" }, acctSel, dirSel, amtIn, curSel, rateIn),
      el("button", { class: "btn-icon", onClick: () => onRemove(row) }, "✕"));
    row._read = () => ({
      account_id: acctSel.value, direction: dirSel.value,
      amount: Number(amtIn.value) || 0, currency: curSel.value,
      exchange_rate: Number(rateIn.value) || 1,
    });
    return row;
  }

  function makeIncomeRow(data, onRemove) {
    const kindSel = el("select", {},
      el("option", { value: "fixed", ...(data && data.kind === "fixed" ? { selected: "" } : {}) }, "Fixed"),
      el("option", { value: "side", ...(data && data.kind === "side" ? { selected: "" } : {}) }, "Side"));
    const labelIn = el("input", { placeholder: "label", value: data ? (data.label || "") : "" });
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "amount", value: data ? data.amount : "" });
    const curSel = currencySelect(data ? data.currency : base());
    const rateIn = el("input", { type: "number", step: "0.000001", placeholder: "rate", value: data ? data.exchange_rate : 1 });
    const row = el("div", { class: "line-item income-row" },
      el("div", { class: "li-inputs" }, kindSel, labelIn, amtIn, curSel, rateIn),
      el("button", { class: "btn-icon", onClick: () => onRemove(row) }, "✕"));
    row._read = () => ({
      kind: kindSel.value, label: labelIn.value,
      amount: Number(amtIn.value) || 0, currency: curSel.value,
      exchange_rate: Number(rateIn.value) || 1,
    });
    return row;
  }

  function makeExpenseRow(data, onRemove) {
    const catSel = el("select", {});
    EXPENSE_CATS.forEach((c) => catSel.append(el("option", { value: c, ...(data && data.category === c ? { selected: "" } : {}) }, c)));
    const labelIn = el("input", { placeholder: "label (e.g. rent)", value: data ? (data.label || "") : "" });
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "amount", value: data ? data.amount : "" });
    const row = el("div", { class: "line-item exp-row" },
      el("div", { class: "li-inputs" }, catSel, labelIn, amtIn),
      el("button", { class: "btn-icon", onClick: () => onRemove(row) }, "✕"));
    row._read = () => ({ category: catSel.value, label: labelIn.value, amount: Number(amtIn.value) || 0 });
    return row;
  }

  // ── HISTORY ───────────────────────────────────────────
  route("history", async (app) => {
    app.append(backBar("Dashboard"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "History"),
      el("p", {}, "Every month, newest first. Tap to open or edit.")
    ));
    const { snapshots, allMoves } = await loadTimeline();
    const timeline = Model.computeTimeline(snapshots, allMoves);
    const shell = el("div", { class: "shell fade-up fd2" });
    if (timeline.length === 0) {
      shell.append(el("div", { class: "empty-state" }, "No months tracked yet."));
    } else {
      const c = base();
      for (const t of [...timeline].reverse()) {
        shell.append(el("div", { class: "history-item", onClick: () => routeTo("snapshot", t.snapshot.id) },
          el("span", { class: "history-date" }, periodLabel(t.snapshot.period_year, t.snapshot.period_month)),
          el("div", { style: "flex:1" },
            el("div", { style: "font-family:'JetBrains Mono',monospace;font-size:0.95rem" }, fmt(t.netWorth, c)),
            el("div", { class: "muted", style: "font-size:0.78rem" },
              t.expense === null ? "first month" :
              `spent ${fmt(t.expense, c)}, ${t.deltaNW >= 0 ? "grew" : "fell"} ${fmtSigned(t.deltaNW, c)}`)
          ),
          el("span", { class: "muted" }, "›")
        ));
      }
    }
    app.append(shell);
    app.append(el("div", { class: "btn-row fade-up fd3", style: "margin-top:16px" },
      el("button", { class: "btn", onClick: () => routeTo("snapshot") }, "+ Add a month")));
  });

  // ══════════════════════════════════════════════════════
  //  EXPENSE TRACKER (split wallets)
  //
  //  A separate ledger. Nothing below reads or writes snapshots, balances, or
  //  income — the two trackers never share math. Vocabulary is kept distinct
  //  on purpose: the asset tracker says "spending", this one says "spent" and
  //  "your share", so the same word never means two things.
  // ══════════════════════════════════════════════════════

  // Loads one wallet's expenses/shares/settlements and computes its balances.
  // Phase 1 has no expense UI yet, so in practice this returns zeroes — but the
  // math runs for real, so the home and wallet screens are already correct once
  // Phase 2 starts writing rows.
  async function loadWalletLedger(wallet) {
    const [{ data: expenses }, { data: settlements }] = await Promise.all([
      sb.from("shared_expenses").select("*").eq("wallet_id", wallet.id),
      sb.from("settlements").select("*").eq("wallet_id", wallet.id),
    ]);
    let shares = [];
    const ids = (expenses || []).map((e) => e.id);
    if (ids.length) {
      const { data } = await sb.from("expense_shares").select("*").in("expense_id", ids);
      shares = data || [];
    }
    const balances = Split.computeBalances(
      wallet.activeMembers, expenses || [], shares, settlements || []);
    return { expenses: expenses || [], shares, settlements: settlements || [], balances };
  }

  // Initial-letter avatar. Colour is derived from the name so a person keeps
  // the same colour everywhere without storing one.
  function memberAvatar(name) {
    const n = (name || "?").trim();
    const idx = Math.abs([...n].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % 8 + 1;
    return el("span", { class: "member-av", style: `background:var(--cat-${idx})` },
      n.charAt(0).toUpperCase());
  }

  // ── WALLETS (Expense Tracker home) ────────────────────
  route("wallets", async (app) => {
    app.append(backBar("Home", "home"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Expense Tracker"),
      el("p", {}, "Shared wallets for splitting bills. Each one is tracked separately.")
    ));

    // Notifications are a property of THIS DEVICE, not of a wallet, so the
    // control lives here rather than inside any one wallet's settings.
    app.append(await notificationCard());

    let wallets = [];
    try { wallets = await Split.loadWallets(); }
    catch {
      app.append(el("div", { class: "shell fade-up fd2" },
        el("div", { class: "empty-state" },
          el("p", {}, "Couldn't load your wallets. If this is the first run, the split tables may not be set up yet. Run setup/split-schema.sql in Supabase."))));
      return;
    }

    const active = wallets.filter((w) => !w.archived);
    const archived = wallets.filter((w) => w.archived);

    if (!active.length && !archived.length) {
      app.append(el("div", { class: "shell fade-up fd2" },
        el("div", { class: "empty-state" },
          el("p", {}, "No wallets yet. Create one for each group you split with: your flatmate, your friends, a trip."),
          el("div", { class: "btn-row", style: "justify-content:center;margin-top:14px" },
            el("button", { class: "btn", onClick: () => routeTo("newWallet") }, "New wallet")))));
      return;
    }

    const list = el("div", { class: "wallet-list fade-up fd2" });
    for (const w of active) list.append(await walletRow(w));
    app.append(list);

    app.append(el("div", { class: "btn-row fade-up fd3", style: "margin-top:16px" },
      el("button", { class: "btn", onClick: () => routeTo("newWallet") }, "+ New wallet")));

    if (archived.length) {
      const arcList = el("div", {});
      for (const w of archived) arcList.append(await walletRow(w));
      app.append(el("div", { class: "shell fade-up", style: "margin-top:22px" },
        el("h3", {}, "Archived"),
        el("div", { class: "section-hint" }, "Kept for reference. Balances still shown."),
        arcList));
    }
  });

  // ── Notification settings (per device) ────────────────
  // Every branch here corresponds to a real state a user can land in. The two
  // that matter most are iOS-not-installed (a button would silently fail) and
  // blocked (only the browser's own settings can undo it), because in both
  // cases there is nothing the app can do and saying so is the whole job.
  async function notificationCard() {
    if (!window.Split || !Split.pushSupported()) return el("div", { class: "hidden" });

    const status = await Split.pushStatus();
    if (status.state === "unsupported" || status.state === "not-configured") {
      return el("div", { class: "hidden" });
    }

    const row = el("div", { class: "notif-bar fade-up" });
    const label = el("span", { class: "notif-label" }, "Notifications");

    // States the app cannot act on: say so in a few words rather than offering
    // a switch that would silently do nothing.
    if (status.state === "needs-install" || status.state === "blocked") {
      row.append(label, el("span", { class: "notif-note" },
        status.state === "blocked" ? "Blocked in browser settings" : "Add to Home Screen first"));
      return row;
    }

    const on = status.state === "on";
    const sw = el("button", {
      class: "switch" + (on ? " on" : ""), type: "button",
      role: "switch", "aria-checked": on ? "true" : "false",
      "aria-label": on ? "Turn notifications off" : "Turn notifications on",
    }, el("span", { class: "switch-knob" }));

    sw.addEventListener("click", async () => {
      sw.disabled = true;
      try {
        if (on) await Split.disablePush(); else await Split.enablePush();
        routeTo("wallets");
      } catch (e) {
        sw.disabled = false;
        row.append(el("span", { class: "notif-note neg" }, e.message || "Couldn't change that."));
      }
    });

    row.append(label, sw);
    return row;
  }

  // One row in the wallets list: emoji, name, members, your position.
  async function walletRow(w) {
    const { balances } = await loadWalletLedger(w);
    const net = Split.myPosition(w, balances);
    const settled = Math.abs(net) < 0.005;
    const posEl = settled
      ? el("span", { class: "wallet-pos muted" }, "settled up")
      : el("span", { class: "wallet-pos " + (net > 0 ? "pos" : "neg") },
          el("span", { class: "wallet-pos-lbl" }, net > 0 ? "you're owed" : "you owe"),
          el("b", {}, fmt(Math.abs(net), w.base_currency)));

    const avatars = el("span", { class: "member-avs" });
    w.activeMembers.slice(0, 4).forEach((m) => avatars.append(memberAvatar(m.display_name)));
    if (w.activeMembers.length > 4) avatars.append(el("span", { class: "member-av more" }, "+" + (w.activeMembers.length - 4)));

    return el("div", { class: "wallet-row", onClick: () => routeTo("wallet", w.id) },
      el("span", { class: "wallet-emoji" }, w.emoji || "👛"),
      el("span", { class: "wallet-main" },
        el("span", { class: "wallet-name" }, w.name),
        avatars),
      posEl,
      el("span", { class: "muted" }, "›"));
  }

  // ── WALLET HOME ───────────────────────────────────────
  // The main screen of a wallet: what you're owed, who owes whom, where the
  // money went, and the recent expenses.
  route("wallet", async (app, walletId) => {
    const w = await Split.loadWallet(walletId);
    if (!w) { routeTo("wallets"); return; }
    const cur = w.base_currency;

    app.append(backBar("Wallets", "wallets"));
    app.append(el("div", { class: "wallet-head fade-up fd1" },
      el("div", { class: "page-header-shell", style: "margin-top:0;flex:1;min-width:0" },
        el("h1", {}, (w.emoji || "👛") + " " + w.name),
        el("p", {}, w.activeMembers.map((m) => m.display_name).join(", "))),
      el("button", { class: "icon-btn", type: "button", title: "Wallet settings",
        "aria-label": "Wallet settings",
        onClick: () => openWalletSettings(w),
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' })));

    const { expenses, shares, settlements, balances } = await loadWalletLedger(w);

    // ── Headline: your position + who owes whom ──
    const net = Split.myPosition(w, balances);
    const settled = Math.abs(net) < 0.005;
    const head = el("div", { class: "shell fade-up fd2" });
    head.append(el("div", { class: "balance-head" },
      el("div", { class: "balance-lbl" }, settled ? "All settled up" : (net > 0 ? "You're owed" : "You owe")),
      el("div", { class: "balance-val " + (settled ? "muted" : net > 0 ? "pos" : "neg") },
        settled ? "—" : fmt(Math.abs(net), cur))));

    const debts = Split.simplifyDebts(balances);
    if (debts.length) {
      // Simplified: the fewest transfers that clear everything, rather than
      // every pairwise debt (three people would otherwise owe in a circle).
      const rows = el("div", { class: "debt-list" });
      debts.forEach((d) => {
        rows.append(el("div", { class: "debt-row" },
          memberAvatar(d.from.display_name),
          el("span", { class: "debt-text" },
            el("b", {}, d.from.display_name), " owes ", el("b", {}, d.to.display_name)),
          el("span", { class: "debt-amt" }, fmt(d.amount, cur))));
      });
      head.append(rows);
      if (debts.length > 1) {
        head.append(el("div", { class: "section-hint", style: "margin:10px 0 0" },
          "Simplified to the fewest payments that clear everything."));
      }
    }

    head.append(el("div", { class: "btn-row", style: "margin-top:16px" },
      el("button", { class: "btn", onClick: () => routeTo("expense", { walletId: w.id }) }, "+ Add expense"),
      debts.length
        ? el("button", { class: "btn btn-ghost", onClick: () => routeTo("settle", w.id) }, "Settle up")
        : null));
    app.append(head);

    if (!expenses.length) {
      app.append(el("div", { class: "shell fade-up fd3" },
        el("div", { class: "empty-state" },
          el("p", {}, "No expenses yet. Add the first one and Bloom works out who owes what."))));
      return;
    }

    // ── Spending by category ──
    // Defaults to "Your share" (what this actually cost YOU) when we can work
    // out which member you are; otherwise the whole wallet, which is always
    // computable. Falling back matters: if your share came out empty we'd
    // otherwise render an empty chart and look broken.
    if (window.Charts) {
      const myShareItems = w.myMember
        ? Split.categoryTotals(expenses, shares, w.myMember.id) : [];
      const allItems = Split.categoryTotals(expenses, shares, null);
      const canShowMine = myShareItems.length > 0;

      let mineOnly = canShowMine;
      const chartBox = el("div", {});
      const toggle = el("div", { class: "pill-row" });
      const mineBtn = el("button", { class: "pill" + (mineOnly ? " active" : ""), type: "button" }, "Your share");
      const allBtn = el("button", { class: "pill" + (mineOnly ? "" : " active"), type: "button" }, "Whole wallet");

      const drawPie = () => {
        chartBox.innerHTML = "";
        chartBox.append(Charts.spendingPie(mineOnly ? myShareItems : allItems, cur));
      };
      mineBtn.addEventListener("click", () => {
        mineOnly = true; mineBtn.classList.add("active"); allBtn.classList.remove("active"); drawPie();
      });
      allBtn.addEventListener("click", () => {
        mineOnly = false; allBtn.classList.add("active"); mineBtn.classList.remove("active"); drawPie();
      });
      // Only offer the toggle when both views have something to show.
      if (canShowMine && allItems.length) toggle.append(mineBtn, allBtn);
      drawPie();

      // No <h3> here: spendingPie renders its own "Where it went" heading.
      app.append(el("div", { class: "shell fade-up fd3" },
        toggle.childNodes.length ? toggle : null,
        chartBox));
    }

    // ── Recent activity ──
    const activity = buildActivity(expenses, settlements, w);
    const recent = activity.slice(0, 8);
    const list = el("div", { class: "line-list" });
    recent.forEach((item) => list.append(activityRow(item, w, shares)));

    const shell = el("div", { class: "shell fade-up" },
      el("h3", {}, "Recent"), list);
    if (activity.length > recent.length) {
      shell.append(el("div", { class: "btn-row", style: "margin-top:12px" },
        el("button", { class: "btn btn-ghost", onClick: () => routeTo("walletHistory", w.id) },
          "See all " + activity.length)));
    }
    app.append(shell);
  });

  // Expenses and settlements merged into one date-sorted feed, newest first.
  function buildActivity(expenses, settlements, w) {
    const byId = {};
    (w.members || []).forEach((m) => { byId[m.id] = m; });
    const items = [
      ...expenses.map((e) => ({ kind: "expense", date: e.spent_on, row: e })),
      ...settlements.map((s) => ({ kind: "settlement", date: s.settled_on, row: s })),
    ];
    items.forEach((i) => { i.members = byId; });
    return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function fmtDay(iso) {
    if (!iso) return "";
    try {
      return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
    } catch { return iso; }
  }

  // One row in the activity feed. Expenses show your share; settlements read
  // as a payment between two people.
  function activityRow(item, w, allShares) {
    const cur = w.base_currency;
    const m = item.members;

    if (item.kind === "settlement") {
      const s = item.row;
      const from = m[s.from_member_id], to = m[s.to_member_id];
      return el("div", { class: "act-row settlement",
        onClick: () => routeTo("payment", { walletId: w.id, settlementId: s.id }) },
        el("span", { class: "act-date" }, fmtDay(s.settled_on)),
        el("span", { class: "act-main" },
          el("span", { class: "act-desc" },
            (from ? from.display_name : "?"), " paid ", (to ? to.display_name : "?")),
          el("span", { class: "act-sub" }, s.note || "settlement")),
        el("span", { class: "act-amt pos" }, fmt(Split.toBase(s.amount, s.exchange_rate), cur)));
    }

    const e = item.row;
    const payer = m[e.paid_by_member_id];
    const myShare = w.myMember
      ? (allShares || []).find((s) => s.expense_id === e.id && s.member_id === w.myMember.id)
      : null;
    const shareTxt = myShare
      ? "your share " + fmt(Split.toBase(myShare.share_amount, e.exchange_rate), cur)
      : "not your split";

    return el("div", { class: "act-row", onClick: () => routeTo("expense", { walletId: w.id, expenseId: e.id }) },
      el("span", { class: "act-date" }, fmtDay(e.spent_on)),
      el("span", { class: "act-main" },
        el("span", { class: "act-desc" }, e.description || e.category),
        el("span", { class: "act-sub" },
          (payer ? payer.display_name : "?") + " paid, " + shareTxt)),
      el("span", { class: "act-amt" },
        fmt(Split.toBase(e.amount, e.exchange_rate), cur),
        el("span", { class: "act-cat" }, e.category)));
  }

  // ── WALLET HISTORY (all activity) ─────────────────────
  route("walletHistory", async (app, walletId) => {
    const w = await Split.loadWallet(walletId);
    if (!w) { routeTo("wallets"); return; }

    app.append(backBar(w.name, "wallet", w.id));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "All activity"),
      el("p", {}, "Every expense and settlement in this wallet.")));

    const { expenses, shares, settlements } = await loadWalletLedger(w);
    const all = buildActivity(expenses, settlements, w);

    // Category filter — the one filter that earns its place here.
    const cats = [...new Set(expenses.map((e) => e.category || "other"))].sort();
    let activeCat = null;
    const pills = el("div", { class: "pill-row" });
    const listBox = el("div", { class: "line-list" });

    const draw = () => {
      listBox.innerHTML = "";
      const rows = activeCat
        ? all.filter((i) => i.kind === "expense" && (i.row.category || "other") === activeCat)
        : all;
      if (!rows.length) { listBox.append(el("div", { class: "empty-state" }, "Nothing here.")); return; }
      rows.forEach((i) => listBox.append(activityRow(i, w, shares)));
    };

    if (cats.length > 1) {
      const allPill = el("button", { class: "pill active", type: "button" }, "All");
      const setActive = (btn, cat) => {
        activeCat = cat;
        [...pills.children].forEach((c) => c.classList.toggle("active", c === btn));
        draw();
      };
      allPill.addEventListener("click", () => setActive(allPill, null));
      pills.append(allPill);
      cats.forEach((c) => {
        const p = el("button", { class: "pill", type: "button" }, c);
        p.addEventListener("click", () => setActive(p, c));
        pills.append(p);
      });
    }
    draw();

    app.append(el("div", { class: "shell fade-up fd2" },
      cats.length > 1 ? pills : null, listBox));
  });

  // ── NEW WALLET ────────────────────────────────────────
  route("newWallet", async (app) => {
    app.append(backBar("Wallets", "wallets"));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "New wallet"),
      el("p", {}, "A shared book for one group of people.")));

    const nameIn = el("input", { placeholder: "Flatmate, Friends, Japan trip…" });
    const myNameIn = el("input", { placeholder: "your name in this wallet", value: defaultMyName() });
    const curIn = currencySelect(base());
    const picker = emojiPicker("👛");

    // People added before the wallet exists; written once it's created.
    const people = [];
    const peopleList = el("div", { class: "line-list" });
    const pNameIn = el("input", { placeholder: "name" });
    const pEmailIn = el("input", { type: "email", placeholder: "email (optional)" });

    function renderPeople() {
      peopleList.innerHTML = "";
      people.forEach((p, i) => {
        peopleList.append(el("div", { class: "line-item" },
          memberAvatar(p.name),
          el("span", { class: "li-name" }, p.name,
            p.email ? el("span", { class: "member-status invited" }, p.email) : null),
          el("button", { class: "btn btn-ghost btn-sm", type: "button",
            onClick: () => { people.splice(i, 1); renderPeople(); } }, "Remove")));
      });
    }

    function addPerson() {
      const n = pNameIn.value.trim();
      if (!n) { err.textContent = "Enter a name for the person you're adding."; return; }
      people.push({ name: n, email: pEmailIn.value.trim() });
      pNameIn.value = ""; pEmailIn.value = ""; err.textContent = "";
      renderPeople(); pNameIn.focus();
    }
    pEmailIn.addEventListener("keydown", (e) => { if (e.key === "Enter") addPerson(); });

    const err = el("div", { class: "error-msg" });
    const saveBtn = el("button", { class: "btn" }, "Create wallet");

    saveBtn.addEventListener("click", async () => {
      err.textContent = "";
      const name = nameIn.value.trim();
      if (!name) { err.textContent = "Give the wallet a name."; return; }
      saveBtn.disabled = true;
      try {
        const wallet = await Split.createWallet({
          name, emoji: picker.value, baseCurrency: curIn.value, myName: myNameIn.value.trim() || "Me",
        });
        for (const p of people) await Split.addMember(wallet.id, p);
        routeTo("wallet", wallet.id);
      } catch (e) {
        err.textContent = e.message || "Couldn't create the wallet.";
        saveBtn.disabled = false;
      }
    });

    app.append(el("div", { class: "shell fade-up fd2" },
      el("div", { class: "field" }, el("label", {}, "Wallet name"), nameIn),
      el("div", { class: "field" }, el("label", {}, "Icon"), picker),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Your name here"), myNameIn),
        el("div", { class: "field" }, el("label", {}, "Currency"), curIn)),
      el("hr", { class: "divider" }),
      el("h3", {}, "People"),
      el("div", { class: "section-hint" },
        "Add a name on its own to track what someone owes without them signing up. Add an email and the wallet appears in their Bloom automatically when they join."),
      peopleList,
      el("div", { class: "li-inputs", style: "margin-top:8px" }, pNameIn, pEmailIn,
        el("button", { class: "btn btn-ghost", type: "button", onClick: addPerson }, "Add")),
      el("div", { class: "btn-row", style: "margin-top:16px" }, saveBtn,
        el("button", { class: "btn btn-ghost", onClick: () => routeTo("wallets") }, "Cancel")),
      err));
  });

  // The people roster, stacked on top of the settings modal. Changes re-render
  // the list in place rather than navigating, so you stay where you were.
  function openPeopleModal(w, onClosed) {
    const isOwner = !!(w.myMember && w.myMember.is_owner);
    const body = el("div", {});
    const err = el("div", { class: "error-msg" });
    let modal;

    // Reload the wallet and repaint the list without closing the modal.
    async function refresh() {
      const fresh = await Split.loadWallet(w.id);
      if (fresh) w = fresh;
      draw();
    }

    function draw() {
      body.innerHTML = "";
      body.append(el("div", { class: "section-hint" },
        isOwner ? "Only you, as the wallet owner, can add or remove people."
                : "Only the wallet owner can add or remove people."));

      const rows = el("div", { class: "line-list" });
      w.activeMembers.forEach((m) => {
        const status = Split.memberStatus(m);
        const isMe = w.myMember && m.id === w.myMember.id;
        const label = { joined: "joined", invited: "invited, not yet joined", "name-only": "name only" }[status];

        const actions = el("span", { class: "member-actions" });
        if (isOwner && !isMe) {
          if (status !== "joined") {
            actions.append(el("button", { class: "btn btn-ghost btn-sm", type: "button",
              onClick: () => promptEmail(m) }, m.invite_email ? "Change email" : "Invite by email"));
          }
          actions.append(el("button", { class: "btn btn-ghost btn-sm", type: "button",
            onClick: async () => {
              if (!confirm(`Remove ${m.display_name} from ${w.name}? Their past expenses stay, but they won't be in new splits.`)) return;
              err.textContent = "";
              try { await Split.removeMember(m.id); await refresh(); }
              catch (e) { err.textContent = e.message || "Couldn't remove them."; }
            } }, "Remove"));
        }

        rows.append(el("div", { class: "line-item member-item" },
          memberAvatar(m.display_name),
          el("span", { class: "li-name" },
            m.display_name, isMe ? el("span", { class: "tag" }, "you") : null,
            m.is_owner ? el("span", { class: "tag" }, "owner") : null,
            el("span", { class: "member-status " + status }, label,
              m.invite_email && status === "invited" ? " (" + m.invite_email + ")" : "")),
          actions));
      });
      body.append(rows);

      if (isOwner) {
        const nIn = el("input", { placeholder: "name" });
        const eIn = el("input", { type: "email", placeholder: "email (optional)" });
        const doAdd = async () => {
          err.textContent = "";
          const name = nIn.value.trim();
          if (!name) { err.textContent = "Enter a name."; return; }
          try { await Split.addMember(w.id, { name, email: eIn.value.trim() }); await refresh(); }
          catch (e) { err.textContent = e.message || "Couldn't add them."; }
        };
        eIn.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
        nIn.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
        body.append(el("div", { class: "li-inputs", style: "margin-top:12px" }, nIn, eIn,
          el("button", { class: "btn btn-ghost", type: "button", onClick: doAdd }, "Add")));
      }
      body.append(err);
    }

    function promptEmail(m) {
      const v = prompt(`Email to invite ${m.display_name} with:`, m.invite_email || "");
      if (v === null) return;
      err.textContent = "";
      Split.updateMember(m.id, { invite_email: v })
        .then(refresh)
        .catch((e) => { err.textContent = e.message || "Couldn't save that email."; });
    }

    draw();
    modal = openModal({ title: "People", body, onClose: onClosed });
    return modal;
  }

  // Quick wallet edits in a modal: name, icon, currency, archive. People opens
  // as a second modal layered on top, so you never leave the wallet screen.
  function openWalletSettings(w) {
    const isOwner = !!(w.myMember && w.myMember.is_owner);

    if (!isOwner) {
      // Non-owners can't change anything here, so send them straight to the
      // page, which shows the roster read-only.
      routeTo("walletSettings", w.id);
      return;
    }

    const nameIn = el("input", { value: w.name });
    const iconIn = emojiPicker(w.emoji || "👛");
    const curIn = currencySelect(w.base_currency);
    const err = el("div", { class: "error-msg" });

    const countLabel = (wal) =>
      wal.activeMembers.length + (wal.activeMembers.length === 1 ? " person" : " people") + " ›";
    const peopleCount = el("span", { class: "muted" }, countLabel(w));

    const body = el("div", {},
      el("div", { class: "field" }, el("label", {}, "Name"), nameIn),
      el("div", { class: "field" }, el("label", {}, "Icon"), iconIn),
      el("div", { class: "field" }, el("label", {}, "Currency"), curIn),
      el("hr", { class: "divider" }),
      el("button", { class: "modal-link", type: "button",
        onClick: () => {
          // Stack People on top rather than replacing this modal, so closing it
          // returns here instead of dumping you back on the wallet.
          openPeopleModal(w, async () => {
            const fresh = await Split.loadWallet(w.id);
            if (fresh) { w = fresh; peopleCount.textContent = countLabel(w); }
          });
        } },
        el("span", {}, "People"),
        peopleCount),
      err);

    const saveBtn = el("button", { class: "btn" }, "Save");
    saveBtn.addEventListener("click", async () => {
      err.textContent = "";
      saveBtn.disabled = true;
      try {
        await Split.updateWallet(w.id, {
          name: nameIn.value.trim() || w.name,
          emoji: iconIn.value,
          base_currency: curIn.value,
        });
        modal.close();
        routeTo("wallet", w.id);
      } catch (e) {
        err.textContent = e.message || "Couldn't save.";
        saveBtn.disabled = false;
      }
    });

    const archiveBtn = el("button", { class: "btn btn-ghost" }, w.archived ? "Unarchive" : "Archive");
    archiveBtn.addEventListener("click", async () => {
      try {
        await Split.archiveWallet(w.id, !w.archived);
        modal.close();
        routeTo("wallets");
      } catch (e) { err.textContent = e.message || "Couldn't archive."; }
    });

    const modal = openModal({
      title: "Wallet settings",
      body,
      footer: el("div", { class: "btn-row", style: "margin:0" }, saveBtn, archiveBtn),
    });
  }

  // ── Modal ─────────────────────────────────────────────
  // Bloom's first non-route UI, so it has to cover what a route gave for free:
  // Escape and backdrop to dismiss, focus moved in and restored on close, the
  // page behind locked from scrolling, and Android's back button closing the
  // modal instead of leaving the wallet.
  // Open modals, outermost first. Lets a stacked modal know it is not the one
  // that locked the page, and keeps Escape aimed at the topmost only.
  const modalStack = [];
  // history.back() calls we made ourselves while closing a modal. The popstate
  // they trigger is our own bookkeeping, not the user pressing Back, so it must
  // be swallowed rather than closing the modal underneath.
  let selfPops = 0;

  function openModal({ title, body, footer, onClose }) {
    const previouslyFocused = document.activeElement;
    // Modals stack (settings -> people). Only the FIRST one locks the page and
    // owns the saved scroll position; only the LAST one to close restores it.
    // Without this the inner modal's close would unlock the page while the
    // outer one is still open, and the page behind would jump.
    const depth = modalStack.length;
    const scrollY = depth === 0 ? window.scrollY : modalStack[0].scrollY;

    const panel = el("div", { class: "modal-panel", role: "dialog",
      "aria-modal": "true", "aria-label": title });
    const backdrop = el("div", { class: "modal-backdrop" }, panel);
    // Sit above any modal already open.
    backdrop.style.zIndex = String(100 + depth * 10);

    const entry = { scrollY, close: () => close() };
    modalStack.push(entry);

    let closed = false;
    let poppedByHistory = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onPop);
      const i = modalStack.indexOf(entry);
      if (i >= 0) modalStack.splice(i, 1);

      // Only release the page lock once nothing is left open.
      if (!modalStack.length) {
        document.body.classList.remove("modal-open");
        document.body.style.top = "";
        window.scrollTo(0, scrollY);
      }
      backdrop.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      // Drop the history entry we pushed, unless the back gesture is what
      // closed us, in which case it is already gone. Count it so the popstate
      // it fires is recognised as ours.
      if (!poppedByHistory && history.state && history.state.__modal) {
        selfPops++;
        history.back();
      }
      if (onClose) onClose();
    }

    function onKey(e) {
      // Only the topmost modal reacts, or Escape would close the whole stack.
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      // Focus trap: keep Tab inside the panel.
      const items = panel.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    // The back gesture already consumed our history entry, so close without
    // calling history.back() again. (Setting `closed` here would make close()
    // return immediately and never clean up.)
    //
    // A popstate we caused ourselves (closing a stacked modal) is swallowed,
    // so it cannot cascade into closing the modal underneath. Only a real back
    // gesture reaches the topmost modal.
    function onPop() {
      // Only the topmost open modal handles a popstate at all; the ones
      // beneath ignore it entirely, so exactly one listener consumes each
      // event and the counter cannot be decremented more than once.
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (selfPops > 0) { selfPops--; return; }
      poppedByHistory = true;
      close();
    }

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey, true);
    // A pushed state means Android's back gesture dismisses the modal rather
    // than navigating away from the wallet.
    history.pushState({ __modal: true }, "");
    window.addEventListener("popstate", onPop);

    panel.append(
      el("div", { class: "modal-head" },
        el("h3", {}, title),
        el("button", { class: "modal-x", type: "button", "aria-label": "Close",
          onClick: close }, "✕")),
      el("div", { class: "modal-body" }, body),
      footer ? el("div", { class: "modal-foot" }, footer) : null);

    // Lock the page behind without it jumping to the top. Only the first modal
    // does this; re-applying it for a stacked one would reset the offset.
    if (depth === 0) {
      document.body.style.top = `-${scrollY}px`;
      document.body.classList.add("modal-open");
    }
    document.body.appendChild(backdrop);

    // Focus the first real field, not the close button. querySelector returns
    // DOM order, and the ✕ sits in the header, so searching the body first is
    // what puts the cursor where someone actually wants to type.
    const bodyEl = panel.querySelector(".modal-body");
    const focusable = (bodyEl && bodyEl.querySelector("input, select, textarea"))
      || panel.querySelector("button");
    if (focusable) focusable.focus();

    return { close, panel };
  }

  // Explains why a paid-off card should be entered as 0, which is the single
  // most common way to get net worth wrong. Paying a card moves money out of a
  // bank AND clears the debt, so net worth is unchanged; entering a stale
  // statement balance next to a post-payment bank balance counts it twice.
  function liabilityInfo() {
    const close = el("button", { class: "info-close", type: "button", title: "Close" }, "✕");
    const pop = el("div", { class: "info-pop hidden" },
      close,
      el("span", { html:
        "<strong>Credit cards: enter what you owe today, not the statement balance.</strong><br><br>" +
        "A statement shows what you owed on its closing date, often weeks before this snapshot. If you've since paid it, that money has already left your bank account, so entering the old figure counts it twice and makes your net worth look lower than it is.<br><br>" +
        "Paying a card never changes your net worth: cash goes down, debt goes down, and they cancel out. Bank 50,000 with 3,000 owed is the same 47,000 as bank 47,000 with nothing owed.<br><br>" +
        "<strong>You don't lose the expense by entering 0.</strong> The amount you spent already shows as the drop in your bank balance, and the categories are recorded separately in the spending section below. Leaving a paid bill in as a debt doesn't record it better, it just counts the same money twice and makes your expense read too high.<br><br>" +
        "So: <strong>bill already paid → enter 0</strong> (or whatever you've charged since). <strong>Still outstanding → enter what's owed.</strong>" }));
    close.addEventListener("click", () => pop.classList.add("hidden"));
    const btn = el("button", { class: "info-btn", type: "button", title: "How should I enter a credit card?",
      onClick: () => pop.classList.toggle("hidden") }, "i");
    return el("div", { style: "margin:-6px 0 12px" },
      el("span", { class: "info-anchor" }, btn,
        el("span", { class: "section-hint", style: "display:inline;margin-left:7px" }, "Paid your card already? Enter 0."),
        pop));
  }

  // Emoji picker for a wallet's icon. Shared by the new-wallet form and wallet
  // settings so both offer the same set. Read the choice with `picker.value`.
  const WALLET_EMOJIS = ["👛", "🏠", "🎉", "❤️", "✈️", "🍜", "🚗", "🐱", "🎓", "☕"];
  function emojiPicker(selected) {
    const picker = el("div", { class: "emoji-picker" });
    // A wallet created before an emoji was in the list must still show its own
    // icon as the selected one, rather than silently offering to change it.
    const list = WALLET_EMOJIS.includes(selected)
      ? WALLET_EMOJIS : [selected, ...WALLET_EMOJIS];
    picker.value = selected;
    list.forEach((e) => {
      const b = el("button", { class: "emoji-opt" + (e === selected ? " active" : ""), type: "button" }, e);
      b.addEventListener("click", () => {
        picker.value = e;
        [...picker.children].forEach((c) => c.classList.toggle("active", c === b));
      });
      picker.append(b);
    });
    return picker;
  }

  // A sensible default for "your name in this wallet": the part of your email
  // before the @, capitalised.
  function defaultMyName() {
    const email = (user && user.email) || "";
    const stem = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : "Me";
  }

  // ── ADD / EDIT EXPENSE ────────────────────────────────
  // The screen that has to be fastest, so the defaults do the work: today,
  // you as payer, split equally with everyone, last-used category. Realistically
  // it's type the amount, tap a category, save.
  route("expense", async (app, arg) => {
    const walletId = arg && arg.walletId;
    const expenseId = arg && arg.expenseId;
    const w = await Split.loadWallet(walletId);
    if (!w) { routeTo("wallets"); return; }
    const editing = !!expenseId;
    const existing = editing ? await Split.loadExpense(expenseId) : null;
    if (editing && !existing) { routeTo("wallet", w.id); return; }

    app.append(backBar(w.name, "wallet", w.id));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, editing ? "Edit expense" : "Add expense"),
      el("p", {}, editing ? "Change anything and save." : "Split a shared cost with " + w.name + ".")));

    const membs = w.activeMembers;
    if (!membs.length) {
      app.append(el("div", { class: "shell fade-up fd2" },
        el("div", { class: "empty-state" }, el("p", {}, "Add people to this wallet first."))));
      return;
    }

    // ── Fields ──
    const amountIn = el("input", { type: "number", step: "0.01", inputmode: "decimal",
      placeholder: "0.00", value: existing ? existing.amount : "" });
    const descIn = el("input", { placeholder: "Groceries, dinner, taxi…",
      value: existing ? (existing.description || "") : "" });
    const dateIn = el("input", { type: "date",
      value: existing ? existing.spent_on : new Date().toISOString().slice(0, 10) });

    // Currency: defaults to the wallet's own. A different one needs a rate, so
    // the rate field only appears when it actually applies.
    const curIn = currencySelect(existing ? existing.currency : w.base_currency);
    const rateIn = el("input", { type: "number", step: "0.0001", placeholder: "1.0",
      value: existing ? existing.exchange_rate : 1 });
    const rateField = el("div", { class: "field hidden" },
      el("label", {}, "Rate to " + w.base_currency), rateIn,
      el("div", { class: "section-hint", style: "margin:4px 0 0" },
        "How much 1 unit is worth in " + w.base_currency + "."));
    const syncRate = () => {
      const same = curIn.value === w.base_currency;
      rateField.classList.toggle("hidden", same);
      if (same) rateIn.value = 1;
    };
    curIn.addEventListener("change", syncRate);

    // Category chips — faster than a dropdown on a phone.
    let category = existing ? existing.category : lastCategory(w.id);
    const catRow = el("div", { class: "pill-row" });
    EXPENSE_CATS.forEach((c) => {
      const p = el("button", { class: "pill" + (c === category ? " active" : ""), type: "button" }, c);
      p.addEventListener("click", () => {
        category = c;
        [...catRow.children].forEach((x) => x.classList.toggle("active", x === p));
      });
      catRow.append(p);
    });

    // Payer defaults to you.
    const payerSel = el("select", {});
    const defaultPayer = existing ? existing.paid_by_member_id : (w.myMember ? w.myMember.id : membs[0].id);
    membs.forEach((m) => payerSel.append(
      el("option", { value: m.id, ...(m.id === defaultPayer ? { selected: "" } : {}) }, m.display_name)));

    // ── Split ──
    // Equal is the default and stays collapsed. Custom expands per-person rows
    // with an include toggle and an amount box.
    let mode = existing ? existing.split_mode : "equal";
    const included = {};   // member_id -> bool
    const exactVals = {};  // member_id -> string
    membs.forEach((m) => {
      const sh = existing ? existing.shares.find((s) => s.member_id === m.id) : null;
      included[m.id] = existing ? !!sh : true;
      exactVals[m.id] = sh ? String(sh.share_amount) : "";
    });

    const equalBtn = el("button", { class: "pill" + (mode === "equal" ? " active" : ""), type: "button" }, "Equally");
    const customBtn = el("button", { class: "pill" + (mode === "exact" ? " active" : ""), type: "button" }, "Custom");
    const splitBox = el("div", {});
    const remainEl = el("div", { class: "section-hint", style: "margin:8px 0 0" });

    function includedIds() { return membs.filter((m) => included[m.id]).map((m) => m.id); }

    function drawSplit() {
      splitBox.innerHTML = "";
      const total = Number(amountIn.value) || 0;

      if (mode === "equal") {
        const ids = includedIds();
        const preview = Split.allocateEqual(total, ids);
        const rows = el("div", { class: "line-list" });
        membs.forEach((m) => {
          const on = included[m.id];
          const share = preview.find((p) => p.member_id === m.id);
          const chk = el("input", { type: "checkbox", style: "width:auto;margin:0" });
          chk.checked = on;
          chk.addEventListener("change", () => { included[m.id] = chk.checked; drawSplit(); });
          rows.append(el("label", { class: "split-row" + (on ? "" : " off") },
            chk, memberAvatar(m.display_name),
            el("span", { class: "li-name" }, m.display_name),
            el("span", { class: "split-amt" },
              on && share ? fmt(share.share_amount, curIn.value) : "—")));
        });
        splitBox.append(rows);
        remainEl.textContent = ids.length
          ? "Split evenly between " + ids.length + (ids.length === 1 ? " person." : " people.")
          : "Pick at least one person.";
        remainEl.classList.remove("neg");
        return;
      }

      // Custom: per-person amounts, with a live remainder that blocks saving
      // until the shares actually add up.
      const rows = el("div", { class: "line-list" });
      membs.forEach((m) => {
        const inp = el("input", { type: "number", step: "0.01", inputmode: "decimal",
          placeholder: "0.00", value: exactVals[m.id] });
        inp.addEventListener("input", () => { exactVals[m.id] = inp.value; updateRemainder(); });
        rows.append(el("div", { class: "split-row" },
          memberAvatar(m.display_name),
          el("span", { class: "li-name" }, m.display_name),
          el("span", { class: "split-input" }, inp)));
      });
      splitBox.append(rows);
      updateRemainder();
    }

    function exactSum() {
      return membs.reduce((s, m) => s + (Number(exactVals[m.id]) || 0), 0);
    }
    function updateRemainder() {
      const total = Number(amountIn.value) || 0;
      const diff = total - exactSum();
      const off = Math.abs(diff) >= 0.005;
      remainEl.textContent = off
        ? (diff > 0 ? fmt(diff, curIn.value) + " left to assign." : fmt(-diff, curIn.value) + " over the total.")
        : "Adds up exactly.";
      remainEl.classList.toggle("neg", off);
    }

    equalBtn.addEventListener("click", () => {
      mode = "equal"; equalBtn.classList.add("active"); customBtn.classList.remove("active"); drawSplit();
    });
    customBtn.addEventListener("click", () => {
      mode = "exact"; customBtn.classList.add("active"); equalBtn.classList.remove("active");
      // Seed the custom boxes from the current equal split, so "custom" starts
      // from something sensible rather than empty.
      const preview = Split.allocateEqual(Number(amountIn.value) || 0, includedIds());
      membs.forEach((m) => {
        const p = preview.find((x) => x.member_id === m.id);
        if (!exactVals[m.id]) exactVals[m.id] = p ? String(p.share_amount) : "";
      });
      drawSplit();
    });
    amountIn.addEventListener("input", drawSplit);
    curIn.addEventListener("change", drawSplit);
    syncRate();
    drawSplit();

    // ── Save ──
    const err = el("div", { class: "error-msg" });
    const saveBtn = el("button", { class: "btn" }, editing ? "Save changes" : "Add expense");

    saveBtn.addEventListener("click", async () => {
      err.textContent = "";
      const amount = Number(amountIn.value);
      if (!isFinite(amount) || amount <= 0) { err.textContent = "Enter an amount greater than zero."; return; }

      let shares;
      if (mode === "equal") {
        const ids = includedIds();
        if (!ids.length) { err.textContent = "Pick at least one person to split with."; return; }
        shares = Split.allocateEqual(amount, ids);
      } else {
        if (Math.abs(amount - exactSum()) >= 0.005) {
          err.textContent = "The custom shares must add up to the total.";
          return;
        }
        shares = Split.allocateShares(amount, null, "exact", exactVals)
          .filter((s) => s.share_amount !== 0);
        if (!shares.length) { err.textContent = "Give at least one person a share."; return; }
      }

      saveBtn.disabled = true;
      try {
        await Split.saveExpense(w.id, {
          id: expenseId,
          paid_by_member_id: payerSel.value,
          spent_on: dateIn.value,
          description: descIn.value,
          category,
          amount,
          currency: curIn.value,
          exchange_rate: curIn.value === w.base_currency ? 1 : (Number(rateIn.value) || 1),
          split_mode: mode,
        }, shares);
        rememberCategory(w.id, category);
        routeTo("wallet", w.id);
      } catch (e) {
        err.textContent = e.message || "Couldn't save that expense.";
        saveBtn.disabled = false;
      }
    });

    const actions = el("div", { class: "btn-row", style: "margin-top:16px" },
      saveBtn,
      el("button", { class: "btn btn-ghost", onClick: () => routeTo("wallet", w.id) }, "Cancel"));
    if (editing) {
      actions.append(el("button", { class: "btn btn-ghost", style: "margin-left:auto",
        onClick: async () => {
          if (!confirm("Delete this expense? Balances will be recalculated.")) return;
          try { await Split.deleteExpense(expenseId); routeTo("wallet", w.id); }
          catch (e) { err.textContent = e.message || "Couldn't delete it."; }
        } }, "Delete"));
    }

    app.append(el("div", { class: "shell fade-up fd2" },
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Amount"), amountIn),
        el("div", { class: "field" }, el("label", {}, "Currency"), curIn)),
      rateField,
      el("div", { class: "field" }, el("label", {}, "What for"), descIn),
      el("div", { class: "field" }, el("label", {}, "Category"), catRow),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Date"), dateIn),
        el("div", { class: "field" }, el("label", {}, "Paid by"), payerSel)),
      el("hr", { class: "divider" }),
      el("div", { class: "split-head" },
        el("h3", { style: "margin:0" }, "Split"),
        el("div", { class: "pill-row", style: "margin:0" }, equalBtn, customBtn)),
      splitBox, remainEl,
      actions, err));
  });

  // Last-used category per wallet — a small convenience that makes the common
  // case (the same category twice in a row) a tap shorter. Purely local.
  function lastCategory(walletId) {
    try { return localStorage.getItem("bloom_lastcat_" + walletId) || "food"; }
    catch { return "food"; }
  }
  function rememberCategory(walletId, cat) {
    try { localStorage.setItem("bloom_lastcat_" + walletId, cat); } catch {}
  }

  // ── EDIT A PAYMENT ────────────────────────────────────
  // Tapping a recorded payment opens it here. Editing or deleting recalculates
  // balances automatically, since they are always derived from the rows rather
  // than stored.
  route("payment", async (app, arg) => {
    const walletId = arg && arg.walletId;
    const settlementId = arg && arg.settlementId;
    const w = await Split.loadWallet(walletId);
    if (!w) { routeTo("wallets"); return; }
    const s = await Split.loadSettlement(settlementId);
    if (!s) { routeTo("wallet", w.id); return; }
    const cur = w.base_currency;
    const membs = w.activeMembers;

    app.append(backBar(w.name, "wallet", w.id));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Edit payment"),
      el("p", {}, "Change or remove this reimbursement.")));

    const fromSel = el("select", {});
    const toSel = el("select", {});
    // A member who has since left still needs to render, or their payment
    // could not be edited at all.
    const forSelect = w.members.filter((m) => !m.left_at
      || m.id === s.from_member_id || m.id === s.to_member_id);
    forSelect.forEach((m) => {
      fromSel.append(el("option", { value: m.id, ...(m.id === s.from_member_id ? { selected: "" } : {}) }, m.display_name));
      toSel.append(el("option", { value: m.id, ...(m.id === s.to_member_id ? { selected: "" } : {}) }, m.display_name));
    });

    const amountIn = el("input", { type: "number", step: "0.01", inputmode: "decimal", value: s.amount });
    const dateIn = el("input", { type: "date", value: s.settled_on });
    const noteIn = el("input", { placeholder: "note (optional)", value: s.note || "" });
    const err = el("div", { class: "error-msg" });

    const saveBtn = el("button", { class: "btn" }, "Save changes");
    saveBtn.addEventListener("click", async () => {
      err.textContent = "";
      const amount = Number(amountIn.value);
      if (!isFinite(amount) || amount <= 0) { err.textContent = "Enter an amount greater than zero."; return; }
      if (fromSel.value === toSel.value) { err.textContent = "Pick two different people."; return; }
      saveBtn.disabled = true;
      try {
        await Split.updateSettlement(s.id, {
          from_member_id: fromSel.value,
          to_member_id: toSel.value,
          amount,
          settled_on: dateIn.value,
          note: noteIn.value,
        });
        routeTo("wallet", w.id);
      } catch (e) {
        err.textContent = e.message || "Couldn't save that payment.";
        saveBtn.disabled = false;
      }
    });

    const delBtn = el("button", { class: "btn btn-ghost", style: "margin-left:auto" }, "Delete");
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this payment? Balances will be recalculated.")) return;
      delBtn.disabled = true;
      try { await Split.deleteSettlement(s.id); routeTo("wallet", w.id); }
      catch (e) { err.textContent = e.message || "Couldn't delete it."; delBtn.disabled = false; }
    });

    app.append(el("div", { class: "shell fade-up fd2" },
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "From"), fromSel),
        el("div", { class: "field" }, el("label", {}, "To"), toSel)),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Amount (" + cur + ")"), amountIn),
        el("div", { class: "field" }, el("label", {}, "Date"), dateIn)),
      el("div", { class: "field" }, el("label", {}, "Note"), noteIn),
      el("div", { class: "btn-row", style: "margin-top:14px" }, saveBtn,
        el("button", { class: "btn btn-ghost", onClick: () => routeTo("wallet", w.id) }, "Cancel"),
        delBtn),
      err));
  });

  // ── SETTLE UP ─────────────────────────────────────────
  // Pre-filled from the simplified debts: pick a suggested payment, confirm the
  // amount (editable for a partial payment), save. Nothing is deleted — a
  // settlement is a row that offsets the balance, so history stays auditable.
  route("settle", async (app, walletId) => {
    const w = await Split.loadWallet(walletId);
    if (!w) { routeTo("wallets"); return; }
    const cur = w.base_currency;

    app.append(backBar(w.name, "wallet", w.id));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Settle up"),
      el("p", {}, "Record a reimbursement between two people.")));

    const { balances, settlements } = await loadWalletLedger(w);
    const debts = Split.simplifyDebts(balances);
    const membs = w.activeMembers;

    const fromSel = el("select", {});
    const toSel = el("select", {});
    membs.forEach((m) => {
      fromSel.append(el("option", { value: m.id }, m.display_name));
      toSel.append(el("option", { value: m.id }, m.display_name));
    });
    const amountIn = el("input", { type: "number", step: "0.01", inputmode: "decimal", placeholder: "0.00" });
    const dateIn = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
    const noteIn = el("input", { placeholder: "note (optional)" });
    const err = el("div", { class: "error-msg" });

    const applySuggestion = (d) => {
      fromSel.value = d.from.id;
      toSel.value = d.to.id;
      amountIn.value = d.amount.toFixed(2);
      err.textContent = "";
    };

    const shell = el("div", { class: "shell fade-up fd2" });
    if (debts.length) {
      shell.append(el("h3", {}, "Suggested"));
      shell.append(el("div", { class: "section-hint" }, "Tap one to fill the form below."));
      const rows = el("div", { class: "debt-list" });
      debts.forEach((d) => {
        rows.append(el("button", { class: "debt-row tappable", type: "button",
          onClick: () => applySuggestion(d) },
          memberAvatar(d.from.display_name),
          el("span", { class: "debt-text" },
            el("b", {}, d.from.display_name), " owes ", el("b", {}, d.to.display_name)),
          el("span", { class: "debt-amt" }, fmt(d.amount, cur))));
      });
      shell.append(rows);
      applySuggestion(debts[0]);
      shell.append(el("hr", { class: "divider" }));
    } else {
      shell.append(el("div", { class: "empty-state" },
        el("p", {}, "Everyone's square. You can still record a payment below.")));
    }

    const saveBtn = el("button", { class: "btn" }, "Record payment");
    saveBtn.addEventListener("click", async () => {
      err.textContent = "";
      const amount = Number(amountIn.value);
      if (!isFinite(amount) || amount <= 0) { err.textContent = "Enter an amount greater than zero."; return; }
      if (fromSel.value === toSel.value) { err.textContent = "Pick two different people."; return; }
      saveBtn.disabled = true;
      try {
        await Split.saveSettlement(w.id, {
          from_member_id: fromSel.value,
          to_member_id: toSel.value,
          amount,
          currency: cur,
          exchange_rate: 1,
          settled_on: dateIn.value,
          note: noteIn.value,
        });
        routeTo("wallet", w.id);
      } catch (e) {
        err.textContent = e.message || "Couldn't record that payment.";
        saveBtn.disabled = false;
      }
    });

    shell.append(
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "From"), fromSel),
        el("div", { class: "field" }, el("label", {}, "To"), toSel)),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Amount (" + cur + ")"), amountIn),
        el("div", { class: "field" }, el("label", {}, "Date"), dateIn)),
      el("div", { class: "field" }, el("label", {}, "Note"), noteIn),
      el("div", { class: "btn-row", style: "margin-top:14px" }, saveBtn,
        el("button", { class: "btn btn-ghost", onClick: () => routeTo("wallet", w.id) }, "Cancel")),
      err);
    app.append(shell);

    // Past settlements, newest first, each removable if recorded by mistake.
    if (settlements.length) {
      const byId = {};
      w.members.forEach((m) => { byId[m.id] = m; });
      const rows = el("div", { class: "line-list" });
      [...settlements].sort((a, b) => (a.settled_on < b.settled_on ? 1 : -1)).forEach((s) => {
        const from = byId[s.from_member_id], to = byId[s.to_member_id];
        // Tapping opens the same editor as the wallet's activity feed, so a
        // payment behaves the same way wherever you find it.
        rows.append(el("div", { class: "line-item tappable",
          onClick: () => routeTo("payment", { walletId: w.id, settlementId: s.id }) },
          el("span", { class: "act-date" }, fmtDay(s.settled_on)),
          el("span", { class: "li-name" },
            (from ? from.display_name : "?") + " to " + (to ? to.display_name : "?"),
            s.note ? el("span", { class: "member-status" }, s.note) : null),
          el("span", { class: "li-amt" }, fmt(Split.toBase(s.amount, s.exchange_rate), cur)),
          el("span", { class: "muted" }, "›")));
      });
      app.append(el("div", { class: "shell fade-up fd3" },
        el("h3", {}, "Past payments"), rows));
    }
  });

  // ── WALLET SETTINGS (roster + admin) ──
  route("walletSettings", async (app, walletId) => {
    const w = await Split.loadWallet(walletId);
    if (!w) { routeTo("wallets"); return; }
    const isOwner = !!(w.myMember && w.myMember.is_owner);

    app.append(backBar(w.name, "wallet", w.id));
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "People"),
      el("p", {}, w.archived ? "Archived wallet." : (w.emoji || "👛") + " " + w.name)));

    const { balances } = await loadWalletLedger(w);
    const net = Split.myPosition(w, balances);
    app.append(el("div", { class: "shell fade-up fd2" },
      el("div", { class: "stat-grid" },
        statTile("Your balance",
          Math.abs(net) < 0.005 ? "Settled up" : fmt(Math.abs(net), w.base_currency),
          Math.abs(net) < 0.005 ? 0 : (net > 0 ? 1 : -1),
          Math.abs(net) < 0.005 ? "nothing owed either way" : (net > 0 ? "you're owed" : "you owe")),
        statTile("People", String(w.activeMembers.length), null, "in this wallet"),
        statTile("Currency", w.base_currency, null, "for this wallet"))));

    // ── Members ──
    const shell = el("div", { class: "shell fade-up fd3" });
    shell.append(el("h3", {}, "People"));
    shell.append(el("div", { class: "section-hint" },
      isOwner ? "Only you, as the wallet owner, can add or remove people."
              : "Only the wallet owner can add or remove people."));

    const rows = el("div", { class: "line-list" });
    w.activeMembers.forEach((m) => {
      const status = Split.memberStatus(m);
      const isMe = w.myMember && m.id === w.myMember.id;
      const label = { joined: "joined", invited: "invited, not yet joined", "name-only": "name only" }[status];

      const actions = el("span", { class: "member-actions" });
      if (isOwner && !isMe) {
        // Name-only or mis-typed invites can be given an email here; this is
        // how someone gets linked to an account after the fact. Once they've
        // actually joined, the email has done its job and editing it does
        // nothing, so the button isn't offered.
        if (status !== "joined") {
          actions.append(el("button", { class: "btn btn-ghost btn-sm", type: "button",
            onClick: () => promptEmail(m) }, m.invite_email ? "Change email" : "Invite by email"));
        }
        actions.append(el("button", { class: "btn btn-ghost btn-sm", type: "button",
          onClick: async () => {
            if (!confirm(`Remove ${m.display_name} from ${w.name}? Their past expenses stay, but they won't be in new splits.`)) return;
            try { await Split.removeMember(m.id); routeTo("walletSettings", w.id); }
            catch (e) { alert(e.message || "Couldn't remove them."); }
          } }, "Remove"));
      }

      rows.append(el("div", { class: "line-item member-item" },
        memberAvatar(m.display_name),
        el("span", { class: "li-name" },
          m.display_name, isMe ? el("span", { class: "tag" }, "you") : null,
          m.is_owner ? el("span", { class: "tag" }, "owner") : null,
          el("span", { class: "member-status " + status }, label,
            m.invite_email && status === "invited" ? " (" + m.invite_email + ")" : "")),
        actions));
    });
    shell.append(rows);

    function promptEmail(m) {
      const v = prompt(`Email to invite ${m.display_name} with:`, m.invite_email || "");
      if (v === null) return;
      Split.updateMember(m.id, { invite_email: v })
        .then(() => routeTo("walletSettings", w.id))
        .catch((e) => alert(e.message || "Couldn't save that email."));
    }

    if (isOwner) {
      const nIn = el("input", { placeholder: "name" });
      const eIn = el("input", { type: "email", placeholder: "email (optional)" });
      const addErr = el("div", { class: "error-msg" });
      const doAdd = async () => {
        addErr.textContent = "";
        const name = nIn.value.trim();
        if (!name) { addErr.textContent = "Enter a name."; return; }
        try { await Split.addMember(w.id, { name, email: eIn.value.trim() }); routeTo("walletSettings", w.id); }
        catch (e) { addErr.textContent = e.message || "Couldn't add them."; }
      };
      eIn.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
      shell.append(el("div", { class: "li-inputs", style: "margin-top:10px" }, nIn, eIn,
        el("button", { class: "btn btn-ghost", type: "button", onClick: doAdd }, "Add")));
      shell.append(addErr);
    }
    app.append(shell);

    // Name, icon, currency and archive now live in the settings modal on the
    // wallet screen; this page is the people roster.
    if (isOwner) {
      app.append(el("div", { class: "btn-row fade-up", style: "margin-top:16px" },
        el("button", { class: "btn btn-ghost", type: "button",
          onClick: () => { routeTo("wallet", w.id); setTimeout(() => openWalletSettings(w), 0); } },
          "Wallet settings")));
    }
  });

  // Tapping a push notification focuses an already-open Bloom and asks it to
  // route to the wallet in question, rather than reloading the whole app.
  function wirePushNavigation() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || msg.type !== "notification-click") return;
      const m = /#wallet\/([0-9a-f-]+)/i.exec(msg.url || "");
      if (m && user) routeTo("wallet", m[1]);
      else if (user) routeTo("wallets");
    });
  }

  // ── Nav wiring ────────────────────────────────────────
  function wireNav() {
    $$("[data-route]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); routeTo(a.dataset.route); });
    });
    $("#signOutBtn").addEventListener("click", async () => { await sb.auth.signOut(); });
  }

  document.addEventListener("DOMContentLoaded", () => { wireNav(); wirePushNavigation(); boot(); });
})();
