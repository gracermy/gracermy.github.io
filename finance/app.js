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
    const { data } = await sb.auth.getSession();
    if (data.session) {
      user = data.session.user;
      await enterApp();
    } else {
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

    const existing = db.config();
    const urlIn = el("input", { placeholder: "https://xxxx.supabase.co", value: existing.SUPABASE_URL && !existing.SUPABASE_URL.includes("YOUR-PROJECT") ? existing.SUPABASE_URL : "" });
    const keyIn = el("input", { placeholder: "eyJ… (anon public key)", value: existing.SUPABASE_ANON_KEY && !existing.SUPABASE_ANON_KEY.includes("YOUR-ANON") ? existing.SUPABASE_ANON_KEY : "" });
    const passIn = el("input", { placeholder: "invite passkey", value: existing.INVITE_PASSKEY && existing.INVITE_PASSKEY !== "change-me-to-a-secret-phrase" ? existing.INVITE_PASSKEY : "" });
    const curIn = currencySelect(existing.BASE_CURRENCY || "HKD");
    const err = el("div", { class: "error-msg" });
    const saveBtn = el("button", { class: "btn", style: "width:100%" }, "Save & continue");

    saveBtn.addEventListener("click", () => {
      err.textContent = "";
      const url = urlIn.value.trim(), key = keyIn.value.trim();
      if (!/^https:\/\/.+\.supabase\.co/.test(url)) { err.textContent = "Enter your Supabase Project URL (https://…​.supabase.co)."; return; }
      if (key.length < 20) { err.textContent = "Enter your anon public key (a long string starting with eyJ)."; return; }
      const c = db.saveConfig({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key, INVITE_PASSKEY: passIn.value, BASE_CURRENCY: curIn.value, AI_STATEMENTS: !!existing.AI_STATEMENTS });
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
          // Invite passkey gate (browser-checked casual gate).
          const expected = db.invitePasskey();
          if (expected && inviteIn.value.trim() !== expected) {
            errBox.textContent = "Invalid invite passkey. Ask the owner for the current one.";
            submitBtn.disabled = false; return;
          }
          const { data, error } = await sb.auth.signUp({ email, password });
          if (error) throw error;
          if (data.session) { /* auto signed in */ }
          else { okBox.textContent = "Account created. If email confirmation is on, check your inbox, then sign in."; }
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
          inviteField,
          submitBtn, errBox, okBox
        )
      )
    );
  }

  // ── Enter app (loads accounts + defaults, shows dashboard) ──
  async function enterApp() {
    setNav(true);
    await loadAccounts();
    await loadIncomeDefaults();
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
    const [{ data: snaps }, { data: bals }, { data: inc }, { data: moves }, { data: exps }] =
      await Promise.all([
        sb.from("snapshots").select("*"),
        sb.from("balances").select("*"),
        sb.from("income").select("*"),
        sb.from("illiquid_moves").select("*"),
        sb.from("expense_lines").select("*"),
      ]);
    const snapshots = (snaps || []).map((s) => ({
      ...s, _date: periodKey(s.period_year, s.period_month),
      balances: (bals || []).filter((b) => b.snapshot_id === s.id)
        .map((b) => ({ ...b, _accountType: (acctById(b.account_id) || {}).type })),
      income: (inc || []).filter((i) => i.snapshot_id === s.id),
      expenses: (exps || []).filter((e) => e.snapshot_id === s.id),
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
      el("div", { class: "stat-grid" },
        statTile("Net worth", fmt(latest.netWorth, c)),
        statTile("Growth", fmtSigned(latest.deltaNW, c), latest.deltaNW, "vs previous month"),
        statTile("Income", latest.income ? fmt(latest.income, c) : fmt(0, c), null, "this month"),
        statTile("Expense", latest.expense === null ? "not yet" : fmt(latest.expense, c),
          latest.expense === null ? null : -1, "income minus growth"),
      ),
      el("div", { class: "stat-grid", style: "margin-top:12px" },
        statTile("Liquid", fmt(latest.liquid, c)),
        statTile("Illiquid (at cost)", fmt(latest.illiquidCost, c)),
        statTile("Liabilities", latest.liabilities ? fmt(-latest.liabilities, c) : fmt(0, c), latest.liabilities ? -1 : 0),
      ),
      el("div", { class: "btn-row", style: "margin-top:18px" },
        el("button", { class: "btn", onClick: () => routeTo("snapshot") }, "+ Add a month"),
        el("button", { class: "btn btn-ghost", onClick: () => routeTo("history") }, "View history")
      )
    ));

    // Charts
    if (window.Charts) {
      const chartShell = el("div", { class: "shell fade-up fd3" });
      Charts.render(chartShell, timeline, c);
      app.append(chartShell);
    }

    // Recent months list
    const recent = [...timeline].reverse().slice(0, 5);
    const list = el("div", {});
    for (const t of recent) {
      list.append(el("div", { class: "history-item", onClick: () => routeTo("snapshot", t.snapshot.id) },
        el("span", { class: "history-date" }, periodLabel(t.snapshot.period_year, t.snapshot.period_month)),
        el("span", { class: "history-nw" }, fmt(t.netWorth, c)),
        el("span", { class: t.expense === null ? "muted" : (t.expense > 0 ? "neg" : "pos"), style: "font-family:'JetBrains Mono',monospace;font-size:0.82rem;min-width:100px;text-align:right" },
          t.expense === null ? "" : "spent " + fmt(t.expense, c))
      ));
    }
    app.append(el("div", { class: "shell fade-up fd3" }, el("h3", {}, "Recent months"), list));
  });

  function statTile(label, value, signHint, sub) {
    const cls = signHint == null ? "" : signHint > 0 ? "pos" : signHint < 0 ? "neg" : "";
    return el("div", { class: "stat" },
      el("div", { class: "stat-label" }, label),
      el("div", { class: "stat-value " + cls }, value),
      sub ? el("div", { class: "stat-sub" }, sub) : null
    );
  }

  // ── ACCOUNTS ──────────────────────────────────────────
  route("accounts", async (app) => {
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
          for (const a of groups[type]) {
            wrap.append(el("div", { class: "line-item" },
              el("span", { class: "li-name" }, a.name),
              el("span", { class: "tag" }, a.currency),
              el("button", { class: "btn-icon", title: "Delete", onClick: () => deleteAccount(a) }, "✕")
            ));
          }
          listShell.append(wrap);
        }
      }
    }

    async function deleteAccount(a) {
      if (!confirm(`Delete "${a.name}"? Its balance lines in past months will also be removed.`)) return;
      await sb.from("accounts").delete().eq("id", a.id);
      await loadAccounts();
      renderList();
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
      renderList();
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

  // Income defaults editor (fixed salary + optional auto-route to illiquid)
  function incomeDefaultsShell() {
    const amtIn = el("input", { type: "number", step: "0.01", placeholder: "0", value: incomeDefaults ? incomeDefaults.fixed_amount : "" });
    const curSel = currencySelect(incomeDefaults ? incomeDefaults.currency : base());
    const illiquidAccts = accounts.filter((a) => a.type === "illiquid");
    const msg = el("div", { class: "ok-msg" });

    // Auto-route state: present if defaults already have one set.
    const hasRoute = !!(incomeDefaults && incomeDefaults.auto_route_illiquid_account_id && Number(incomeDefaults.auto_route_amount) > 0);
    const routeSel = el("select", {});
    illiquidAccts.forEach((a) => routeSel.append(el("option", { value: a.id, ...(incomeDefaults && incomeDefaults.auto_route_illiquid_account_id === a.id ? { selected: "" } : {}) }, a.name)));
    const routeAmt = el("input", { type: "number", step: "0.01", placeholder: "0", value: incomeDefaults ? incomeDefaults.auto_route_amount : "" });

    // Info explanation as a popover with its own close (✕) button.
    const infoClose = el("button", { class: "info-close", type: "button", title: "Close" }, "✕");
    const infoPop = el("div", { class: "info-pop hidden" },
      infoClose,
      el("span", { html:
        "<strong>Auto-route</strong> takes a slice of your <strong>fixed income</strong> and records it as a contribution into an illiquid account (for example, part of your salary that goes straight into MPF).<br><br>" +
        "It does <strong>not</strong> add to your income. Your total income stays the same; the slice is just logged so your illiquid holdings grow correctly each month." }));
    infoClose.addEventListener("click", () => infoPop.classList.add("hidden"));
    const infoBtn = el("button", { class: "info-btn", type: "button", title: "What is auto-route?",
      onClick: () => infoPop.classList.toggle("hidden") }, "i");
    const infoAnchor = el("span", { class: "info-anchor" }, infoBtn, infoPop);

    // The auto-route field block (shown only when active)
    const routeBlock = el("div", { class: hasRoute ? "" : "hidden" },
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Route into"), routeSel),
        el("div", { class: "field" }, el("label", {}, "Amount routed"), routeAmt)
      )
    );
    // Add / remove buttons
    const addRouteBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", ...(hasRoute ? { class: "btn btn-ghost btn-sm hidden" } : {}) }, "+ Add auto-route");
    const removeRouteBtn = el("button", { class: "btn-icon", type: "button", title: "Remove auto-route", ...(hasRoute ? {} : { class: "btn-icon hidden" }) }, "✕ remove");
    let routeActive = hasRoute;
    if (illiquidAccts.length === 0) { addRouteBtn.disabled = true; addRouteBtn.title = "Add an illiquid account first"; }
    addRouteBtn.addEventListener("click", () => {
      routeActive = true; routeBlock.classList.remove("hidden");
      addRouteBtn.classList.add("hidden"); removeRouteBtn.classList.remove("hidden");
    });
    removeRouteBtn.addEventListener("click", () => {
      routeActive = false; routeBlock.classList.add("hidden");
      removeRouteBtn.classList.add("hidden"); addRouteBtn.classList.remove("hidden");
    });

    const saveBtn = el("button", { class: "btn" }, "Save defaults");
    saveBtn.addEventListener("click", async () => {
      msg.textContent = "";
      saveBtn.disabled = true;
      const row = {
        user_id: user.id,
        fixed_amount: Number(amtIn.value) || 0,
        currency: curSel.value,
        auto_route_illiquid_account_id: routeActive ? (routeSel.value || null) : null,
        auto_route_amount: routeActive ? (Number(routeAmt.value) || 0) : 0,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("income_defaults").upsert(row, { onConflict: "user_id" });
      saveBtn.disabled = false;
      if (error) { msg.className = "error-msg"; msg.textContent = error.message; return; }
      await loadIncomeDefaults();
      msg.className = "ok-msg"; msg.textContent = "Saved. New months will pre-fill this.";
    });

    return el("div", { class: "shell fade-up fd3" },
      el("h3", {}, "Income defaults"),
      el("div", { class: "section-hint" }, "Your fixed monthly income pre-fills each new month so you do not retype it."),
      el("div", { class: "field-row" },
        el("div", { class: "field" }, el("label", {}, "Fixed monthly income"), amtIn),
        el("div", { class: "field" }, el("label", {}, "Currency"), curSel)
      ),
      el("hr", { class: "divider" }),
      el("div", { style: "display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px" },
        el("label", { style: "margin-bottom:0;display:inline-flex;align-items:center" }, "Auto-route", infoAnchor),
        el("div", { class: "btn-row", style: "margin-top:0" }, addRouteBtn, removeRouteBtn)
      ),
      routeBlock,
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
      const [{ data: s }, { data: bals }, { data: moves }, { data: inc }, { data: exps }] = await Promise.all([
        sb.from("snapshots").select("*").eq("id", snapshotId).single(),
        sb.from("balances").select("*").eq("snapshot_id", snapshotId),
        sb.from("illiquid_moves").select("*").eq("snapshot_id", snapshotId),
        sb.from("income").select("*").eq("snapshot_id", snapshotId),
        sb.from("expense_lines").select("*").eq("snapshot_id", snapshotId),
      ]);
      existing = { snap: s, bals: bals || [], moves: moves || [], inc: inc || [], exps: exps || [] };
    }

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

    // Auto-route preview note
    const autoRouteNote = (!editing && incomeDefaults && incomeDefaults.auto_route_illiquid_account_id && Number(incomeDefaults.auto_route_amount) > 0)
      ? el("div", { class: "section-hint" }, `A slice of ${incomeDefaults.auto_route_amount} ${incomeDefaults.currency} of your fixed income will be recorded as a contribution into ${(acctById(incomeDefaults.auto_route_illiquid_account_id) || {}).name || "illiquid"}.`)
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

        // illiquid moves (+ auto-route on new snapshots)
        const movePayload = $$(".move-row", movesWrap).map((r) => r._read()).filter((r) => r && r.amount > 0)
          .map((r) => ({ snapshot_id: sid, ...r }));
        if (!editing && incomeDefaults && incomeDefaults.auto_route_illiquid_account_id && Number(incomeDefaults.auto_route_amount) > 0) {
          movePayload.push({
            snapshot_id: sid, account_id: incomeDefaults.auto_route_illiquid_account_id,
            direction: "in", amount: Number(incomeDefaults.auto_route_amount),
            currency: incomeDefaults.currency, exchange_rate: rateFor(incomeDefaults.currency),
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
      app.append(window.BloomStatements.widget((draft) => applyDraft(draft)));
    }

    // Apply a parsed statement draft into the form (balances + expense lines).
    function applyDraft(draft) {
      if (!draft) return;
      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      // Match a draft line to a balance row, restricted to the right account
      // TYPE (liabilities only match liability accounts, balances only non-
      // liability). Prefer an exact name match, then fall back to substring.
      const setLine = (name, amount, rate, wantLiability) => {
        const key = norm(name);
        if (!key) return;
        const pool = balRows.filter((r) => (r.account.type === "liability") === wantLiability);
        let row = pool.find((r) => norm(r.account.name) === key);
        if (!row) row = pool.find((r) => { const an = norm(r.account.name); return an && (an.includes(key) || key.includes(an)); });
        if (row) row.set(amount, rate);
      };
      (draft.balances || []).forEach((b) => setLine(b.name, b.amount, b.exchange_rate_to_hkd, false));
      (draft.liabilities || []).forEach((b) => setLine(b.name, b.amount, null, true));
      // Seed big-picture expense lines from spending categories.
      const txns = (draft.transactions || []).filter((t) => !t.is_transfer);
      if (txns.length) {
        const byCat = {};
        txns.forEach((t) => { byCat[t.category || "other"] = (byCat[t.category || "other"] || 0) + (Number(t.amount) || 0); });
        Object.entries(byCat).forEach(([cat, amt]) => addExpRow({ category: cat, label: cat, amount: Math.round(amt) }));
      }
      err.className = "ok-msg";
      err.textContent = "Draft applied. Review the balances and expense lines below, then save.";
      err.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Balances"),
      el("div", { class: "section-hint" }, "Liquid is what you own. Liabilities are what you owe (enter the amount owed, it gets subtracted from net worth). Rate converts to " + base() + " (1 means same currency)."),
      el("div", { class: "line-list" }, balRows.map((r) => r.node))
    ));

    if (illiquidAccounts.length > 0) {
      const addMoveBtn = el("button", { class: "btn btn-ghost btn-sm" }, "+ Add contribution / withdrawal");
      addMoveBtn.addEventListener("click", () => addMoveRow(null));
      app.append(el("div", { class: "shell fade-up fd2" },
        el("h3", {}, "Illiquid moves"),
        el("div", { class: "section-hint" }, "Only record money moving IN or OUT of illiquid holdings (at cost). Market ups/downs are not tracked."),
        movesWrap,
        el("div", { class: "btn-row" }, addMoveBtn)
      ));
    }

    const addIncBtn = el("button", { class: "btn btn-ghost btn-sm" }, "+ Add income");
    addIncBtn.addEventListener("click", () => addIncomeRow(null));
    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Income"),
      el("div", { class: "section-hint" }, "Fixed income is pre-filled from your defaults. Add side income (bonus, gift, etc.) as needed."),
      autoRouteNote,
      incomeWrap,
      el("div", { class: "btn-row" }, addIncBtn)
    ));

    const addExpBtn = el("button", { class: "btn btn-ghost btn-sm" }, "+ Add expense line");
    addExpBtn.addEventListener("click", () => addExpRow(null));
    app.append(el("div", { class: "shell fade-up fd2" },
      el("h3", {}, "Big-picture expenses (optional)"),
      el("div", { class: "section-hint" }, "For your own breakdown only. Your real total expense is worked out from the change in net worth, not from these lines."),
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
