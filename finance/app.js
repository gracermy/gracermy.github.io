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
    // When signed in, the logo goes to the Bloom dashboard (not the public home);
    // when signed out, it's a normal link back to the home page.
    const logo = $("#navLogo");
    if (logo) {
      if (loggedIn) { logo.setAttribute("href", "#"); logo.onclick = (e) => { e.preventDefault(); routeTo("dashboard"); }; }
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

  // ── Enter app (loads accounts + defaults, shows dashboard) ──
  async function enterApp() {
    setNav(true);
    await loadAccounts();
    await loadIncomeDefaults();
    await loadAutoRoutes();
    routeTo("dashboard");
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

  // ── DASHBOARD ─────────────────────────────────────────
  route("dashboard", async (app) => {
    app.append(el("div", { class: "page-header-shell fade-up fd1" },
      el("h1", {}, "Bloom"),
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
    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, periodLabel(ls.period_year, ls.period_month)),
      updated ? el("div", { class: "section-hint", style: "margin-top:-8px" }, "Last updated " + updated) : null,
      ...monthStatTiles(latest),
      el("div", { style: "margin-top:14px" }, calcLine(latest)),
      el("div", { class: "btn-row", style: "margin-top:18px" },
        el("button", { class: "btn", onClick: () => routeTo("snapshot") }, "+ Add a month"))
    ));

    // Quick-action icon cards (the app's main navigation hub).
    app.append(actionCards());

    // Charts
    if (window.Charts) {
      const chartShell = el("div", { class: "shell fade-up fd3" });
      Charts.render(chartShell, timeline, c);
      app.append(chartShell);
    }

    // Per-month detail — tap a month to open its full summary (read-only).
    const recent = [...timeline].reverse();
    const list = el("div", {});
    for (const t of recent) {
      const monthLabel = periodLabel(t.snapshot.period_year, t.snapshot.period_month);
      const fullNW = t.hasMarket ? t.marketNetWorth : t.netWorth;
      const card = el("div", { class: "month-card", onClick: () => routeTo("summary", t.snapshot.id) },
        el("div", { class: "month-card-head" },
          el("span", { class: "month-name" }, monthLabel),
          el("span", { class: "month-nw" }, "net worth ", el("b", {}, fmt(fullNW, c)))),
        calcLine(t));
      list.append(card);
    }
    app.append(el("div", { class: "shell fade-up fd3" },
      el("h3", {}, "Every month"),
      el("div", { class: "section-hint" }, "Spending each month = Income minus net-worth growth. Tap a month for its full summary."),
      list));
  });

  function statTile(label, value, signHint, sub) {
    const cls = signHint == null ? "" : signHint > 0 ? "pos" : signHint < 0 ? "neg" : "";
    return el("div", { class: "stat" },
      el("div", { class: "stat-label" }, label),
      el("div", { class: "stat-value " + cls }, value),
      sub ? el("div", { class: "stat-sub" }, sub) : null
    );
  }

  // The full stat grid for a month `t` (a computed timeline entry). Shared by the
  // dashboard's latest month and the per-month summary view.
  function monthStatTiles(t) {
    const c = base();
    // Full net worth = liquid + illiquid(market where entered, else at-cost) − liabilities.
    // That's exactly marketNetWorth; when no market values, it equals netWorth.
    const fullNW = t.hasMarket ? t.marketNetWorth : t.netWorth;
    const blocks = [];
    blocks.push(el("div", { class: "stat-grid" },
      statTile("Total net worth", fmt(fullNW, c), null, "all assets − liabilities"),
      statTile("Growth", t.deltaNW === null ? "—" : fmtSigned(t.deltaNW, c), t.deltaNW, "vs previous month"),
      statTile("Income", t.income ? fmt(t.income, c) : fmt(0, c), null, "this month"),
      statTile("Expense", t.expense === null ? "not yet" : fmt(t.expense, c), t.expense === null ? null : -1, "income minus growth"),
    ));
    blocks.push(el("div", { class: "stat-grid", style: "margin-top:12px" },
      statTile("Liquid", fmt(t.liquid, c)),
      statTile(t.hasMarket ? "Illiquid (market)" : "Illiquid (at cost)", fmt(t.hasMarket ? t.illiquidMarket : t.illiquidCost, c)),
      statTile("Liabilities", t.liabilities ? fmt(-t.liabilities, c) : fmt(0, c), t.liabilities ? -1 : 0),
    ));
    return blocks;
  }

  // The "Income − Growth = Spent" line for a month.
  function calcLine(t) {
    const c = base();
    if (t.expense === null) return el("div", { class: "calc-line muted" }, "First month — no prior month to compare, so no expense yet.");
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
      err.textContent = "Draft applied." + (other ? " Note: this statement also has spending in another month — open that month to apply its part." : " Review below, then save.");
      err.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // If we re-rendered after creating accounts, apply the carried draft now.
    if (pendingDraft) { const d = pendingDraft; pendingDraft = null; setTimeout(() => applyDraftToRows(d), 0); }

    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Balances"),
      el("div", { class: "section-hint" }, "Enter each closing balance. Liabilities = what you owe. Foreign accounts: set the rate to " + base() + "."),
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
    const node = el("div", { class: "line-item" },
      el("span", { class: "li-name" }, account.name,
        account.type === "liability" ? el("span", { class: "tag", style: "margin-left:6px;background:rgba(192,68,63,0.12);color:var(--neg)" }, "owe") : null),
      el("div", { class: "li-inputs" },
        amtIn,
        el("span", { class: "tag", style: "align-self:center" }, account.currency),
        isForeign ? rateIn : null
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

  // ── Nav wiring ────────────────────────────────────────
  function wireNav() {
    $$("[data-route]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); routeTo(a.dataset.route); });
    });
    $("#signOutBtn").addEventListener("click", async () => { await sb.auth.signOut(); });
  }

  document.addEventListener("DOMContentLoaded", () => { wireNav(); boot(); });
})();
