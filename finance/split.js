// Bloom Expense Tracker (split) — data layer + math. No DOM.
//
// A SEPARATE LEDGER from the asset tracker. Nothing here reads or writes
// snapshots / balances / income. Your net worth already reflects shared
// spending (paying for dinner lowers your bank balance); these tables track
// fairness between people, not your expense total.
//
// Core rule, same as snapshot.js: value_in_base = amount * exchange_rate.
// Depends on: supabase.js (window.FinanceDB).

const Split = (() => {
  const sb = () => window.FinanceDB.getClient();

  function toBase(amount, rate) {
    const a = Number(amount) || 0;
    const r = Number(rate);
    return a * (isFinite(r) && r > 0 ? r : 1);
  }

  // ── Invites ───────────────────────────────────────────
  // Claims any member seats invited to this user's email. Runs once at login.
  // Errors are swallowed: a failure here must never block signing in (e.g. the
  // schema isn't installed yet), it just means no wallet appears.
  async function claimInvites() {
    try {
      const { data, error } = await sb().rpc("claim_wallet_invites");
      if (error) return 0;
      return Number(data) || 0;
    } catch { return 0; }
  }

  // ── Loading ───────────────────────────────────────────
  // Every wallet you're an active member of, each with its full roster.
  // RLS does the filtering: a wallet you're not in simply doesn't come back.
  async function loadWallets() {
    const { data: wallets, error } = await sb()
      .from("wallets").select("*").order("created_at");
    if (error || !wallets) return [];

    const ids = wallets.map((w) => w.id);
    if (!ids.length) return [];

    const { data: members } = await sb()
      .from("wallet_members").select("*").in("wallet_id", ids).order("joined_at");

    const me = await currentUserId();
    return wallets.map((w) => {
      const roster = (members || []).filter((m) => m.wallet_id === w.id);
      return {
        ...w,
        members: roster,
        activeMembers: roster.filter((m) => !m.left_at),
        myMember: roster.find((m) => m.user_id === me && !m.left_at) || null,
      };
    })
    // The wallets RLS select policy also matches wallets you CREATED, which is
    // needed so `insert ... select()` can read the row back before your member
    // row exists. The side effect is that a wallet you later left would still
    // come back; drop those so your list only shows wallets you're actually in.
    .filter((w) => w.myMember || !(w.members || []).length);
  }

  async function loadWallet(walletId) {
    const all = await loadWallets();
    return all.find((w) => w.id === walletId) || null;
  }

  async function currentUserId() {
    const { data } = await sb().auth.getUser();
    return data && data.user ? data.user.id : null;
  }

  // ── Wallet CRUD ───────────────────────────────────────
  // Creates the wallet, then immediately adds you as its owner member.
  // Two steps because at insert time you have no member row yet — the RLS
  // insert policy allows it via `created_by = auth.uid()`.
  async function createWallet({ name, emoji, baseCurrency, myName }) {
    const uid = await currentUserId();
    const { data: wallet, error } = await sb().from("wallets")
      .insert({
        name: name.trim(),
        emoji: emoji || "👛",
        base_currency: baseCurrency || window.FinanceDB.baseCurrency(),
        created_by: uid,
      })
      .select().single();
    if (error) throw error;

    const { error: memErr } = await sb().from("wallet_members").insert({
      wallet_id: wallet.id,
      user_id: uid,
      display_name: (myName || "Me").trim(),
      is_owner: true,
    });
    // A wallet with no owner row is unreachable (RLS hides it), so roll back.
    if (memErr) {
      await sb().from("wallets").delete().eq("id", wallet.id);
      throw memErr;
    }
    return wallet;
  }

  async function updateWallet(walletId, patch) {
    const { error } = await sb().from("wallets").update(patch).eq("id", walletId);
    if (error) throw error;
  }

  async function archiveWallet(walletId, archived) {
    return updateWallet(walletId, { archived: !!archived });
  }

  // ── Members ───────────────────────────────────────────
  // Three ways a person joins, all producing the same kind of row:
  //   name only        -> they can't log in, but you can track what they owe
  //   invited by email -> links automatically when they sign up
  //   linked later     -> add an email to an existing name-only member
  async function addMember(walletId, { name, email }) {
    const clean = (email || "").trim().toLowerCase();
    const { data, error } = await sb().from("wallet_members")
      .insert({
        wallet_id: walletId,
        display_name: (name || "").trim(),
        invite_email: clean || null,
      })
      .select().single();
    if (error) throw error;
    return data;
  }

  async function updateMember(memberId, patch) {
    const clean = { ...patch };
    if ("invite_email" in clean) {
      const e = (clean.invite_email || "").trim().toLowerCase();
      clean.invite_email = e || null;
    }
    if ("display_name" in clean) clean.display_name = (clean.display_name || "").trim();
    const { error } = await sb().from("wallet_members").update(clean).eq("id", memberId);
    if (error) throw error;
  }

  // Soft removal: past expenses keep a valid payer and their name still renders.
  async function removeMember(memberId) {
    const { error } = await sb().from("wallet_members")
      .update({ left_at: new Date().toISOString() }).eq("id", memberId);
    if (error) throw error;
  }

  function memberStatus(m) {
    if (m.left_at) return "removed";
    if (m.user_id) return "joined";
    if (m.invite_email) return "invited";
    return "name-only";
  }

  // ── Share allocation ──────────────────────────────────
  // Splits `amount` across `memberIds`, cent-exact: the remainder is handed out
  // one cent at a time to the earliest members, so the shares always sum to the
  // total. $10.00 / 3 => 3.34 + 3.33 + 3.33, never 3.33 * 3 with a lost cent.
  function allocateEqual(amount, memberIds) {
    const n = memberIds.length;
    if (!n) return [];
    const cents = Math.round((Number(amount) || 0) * 100);
    const baseShare = Math.floor(cents / n);
    let remainder = cents - baseShare * n;
    return memberIds.map((id) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return { member_id: id, share_amount: (baseShare + extra) / 100 };
    });
  }

  // mode 'equal': split evenly among memberIds.
  // mode 'exact': use `overrides` ({member_id: amount}); only non-empty entries
  //               participate, and the caller is expected to have checked that
  //               they sum to the total.
  function allocateShares(amount, memberIds, mode, overrides) {
    if (mode === "exact") {
      return Object.entries(overrides || {})
        .filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([member_id, v]) => ({ member_id, share_amount: Number(v) || 0 }));
    }
    return allocateEqual(amount, memberIds);
  }

  // ── Expenses ──────────────────────────────────────────
  // An expense and its shares are written together. There's no transaction
  // across two REST calls, so if the shares fail we delete the parent rather
  // than leave an expense that nobody owes a share of (which would silently
  // skew every balance in the wallet).
  async function saveExpense(walletId, fields, shares) {
    const row = {
      wallet_id: walletId,
      paid_by_member_id: fields.paid_by_member_id,
      spent_on: fields.spent_on,
      description: (fields.description || "").trim() || null,
      category: fields.category || "other",
      amount: Number(fields.amount) || 0,
      currency: fields.currency,
      exchange_rate: Number(fields.exchange_rate) || 1,
      split_mode: fields.split_mode || "equal",
    };

    if (fields.id) {
      const { error } = await sb().from("shared_expenses").update(row).eq("id", fields.id);
      if (error) throw error;
      // Replace the shares wholesale: simpler than diffing, and the member set
      // may have changed entirely.
      const { error: delErr } = await sb().from("expense_shares").delete().eq("expense_id", fields.id);
      if (delErr) throw delErr;
      const { error: shErr } = await sb().from("expense_shares")
        .insert(shares.map((s) => ({ ...s, expense_id: fields.id })));
      if (shErr) throw shErr;
      return fields.id;
    }

    const { data, error } = await sb().from("shared_expenses").insert(row).select().single();
    if (error) throw error;
    const { error: shErr } = await sb().from("expense_shares")
      .insert(shares.map((s) => ({ ...s, expense_id: data.id })));
    if (shErr) {
      await sb().from("shared_expenses").delete().eq("id", data.id);
      throw shErr;
    }
    return data.id;
  }

  async function deleteExpense(expenseId) {
    // expense_shares cascade on delete.
    const { error } = await sb().from("shared_expenses").delete().eq("id", expenseId);
    if (error) throw error;
  }

  async function loadExpense(expenseId) {
    const { data: expense, error } = await sb()
      .from("shared_expenses").select("*").eq("id", expenseId).maybeSingle();
    if (error || !expense) return null;
    const { data: shares } = await sb()
      .from("expense_shares").select("*").eq("expense_id", expenseId);
    return { ...expense, shares: shares || [] };
  }

  // ── Category totals (for the spending pie) ────────────
  // Sums expenses by category in the wallet's base currency. `memberId` limits
  // it to that person's share ("my share" vs the whole group's spend).
  function categoryTotals(expenses, shares, memberId) {
    const byExpense = {};
    (expenses || []).forEach((e) => { byExpense[e.id] = e; });
    const totals = {};

    if (memberId) {
      (shares || []).forEach((s) => {
        if (s.member_id !== memberId) return;
        const e = byExpense[s.expense_id];
        if (!e) return;
        const cat = e.category || "other";
        totals[cat] = (totals[cat] || 0) + toBase(s.share_amount, e.exchange_rate);
      });
    } else {
      (expenses || []).forEach((e) => {
        const cat = e.category || "other";
        totals[cat] = (totals[cat] || 0) + toBase(e.amount, e.exchange_rate);
      });
    }

    return Object.entries(totals)
      .map(([label, amount]) => ({ label, amount }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }

  // ── Settlements ───────────────────────────────────────
  async function saveSettlement(walletId, fields) {
    const { error } = await sb().from("settlements").insert({
      wallet_id: walletId,
      from_member_id: fields.from_member_id,
      to_member_id: fields.to_member_id,
      amount: Number(fields.amount) || 0,
      currency: fields.currency,
      exchange_rate: Number(fields.exchange_rate) || 1,
      settled_on: fields.settled_on,
      note: (fields.note || "").trim() || null,
    });
    if (error) throw error;
  }

  async function deleteSettlement(id) {
    const { error } = await sb().from("settlements").delete().eq("id", id);
    if (error) throw error;
  }

  // ── Push notifications ────────────────────────────────
  // A subscription is one BROWSER on one DEVICE, not a person: the same user on
  // a phone and a laptop has two, and they expire independently (iOS drops them
  // after long disuse). So "are notifications on?" is always a question about
  // this device, and the answer can change without warning.

  // The VAPID public key identifies our server to the push service. It's public
  // by design — it ships in the browser. The private half lives only in the
  // Edge Function's secrets.
  function vapidKey() {
    const cfg = window.FinanceDB.config();
    return (cfg.VAPID_PUBLIC_KEY || "").trim();
  }

  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  // iOS only allows push in an installed (home-screen) app. Detecting this lets
  // the UI explain that instead of showing a button that silently fails.
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  // Why this exists: applicationServerKey wants raw bytes, but a VAPID key is
  // distributed as a base64url string.
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  // What the settings toggle needs to know, in one call.
  async function pushStatus() {
    if (!pushSupported()) {
      return { state: "unsupported", reason: "This browser doesn't support notifications." };
    }
    if (isIOS() && !isStandalone()) {
      return { state: "needs-install",
        reason: "On iPhone, add Bloom to your Home Screen first — Apple only allows notifications for installed apps." };
    }
    if (!vapidKey()) {
      return { state: "not-configured", reason: "Notifications aren't set up for this site yet." };
    }
    if (Notification.permission === "denied") {
      return { state: "blocked",
        reason: "Notifications are blocked in your browser settings for this site." };
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return { state: sub ? "on" : "off" };
    } catch {
      return { state: "off" };
    }
  }

  // Ask permission and register this device. MUST be called from a click —
  // browsers reject permission requests that aren't tied to a user gesture.
  async function enablePush() {
    if (!pushSupported()) throw new Error("This browser doesn't support notifications.");
    const key = vapidKey();
    if (!key) throw new Error("Notifications aren't set up for this site yet.");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Notifications are blocked. You can re-enable them in your browser settings."
        : "Notifications weren't turned on.");
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }

    const json = sub.toJSON();
    // Upsert on endpoint: re-subscribing the same browser must update its row,
    // not create a duplicate that sends a second copy of every notification.
    const { error } = await sb().from("push_subscriptions").upsert({
      user_id: (await currentUserId()),
      endpoint: sub.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
      last_used_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return true;
  }

  // Turn off for THIS device only; other devices keep working.
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch {}
    // Delete after unsubscribing: a row left behind would make the Edge
    // Function send to a dead endpoint forever.
    const { error } = await sb().from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
    return true;
  }

  // ── Balances ──────────────────────────────────────────
  //   paid    = Σ expenses this member paid for
  //   owed    = Σ their shares across all expenses
  //   settled = Σ settlements sent − Σ settlements received
  //   net     = paid − owed + settled     (positive => they are owed money)
  // All in the wallet's base currency.
  function computeBalances(members, expenses, shares, settlements) {
    const net = {};
    members.forEach((m) => { net[m.id] = { member: m, paid: 0, owed: 0, settled: 0, net: 0 }; });
    const ensure = (id) => net[id] || (net[id] = { member: null, paid: 0, owed: 0, settled: 0, net: 0 });

    const expById = {};
    (expenses || []).forEach((e) => {
      expById[e.id] = e;
      ensure(e.paid_by_member_id).paid += toBase(e.amount, e.exchange_rate);
    });

    (shares || []).forEach((s) => {
      const e = expById[s.expense_id];
      if (!e) return; // share whose expense isn't loaded — ignore
      ensure(s.member_id).owed += toBase(s.share_amount, e.exchange_rate);
    });

    (settlements || []).forEach((s) => {
      const v = toBase(s.amount, s.exchange_rate);
      ensure(s.from_member_id).settled += v;
      ensure(s.to_member_id).settled -= v;
    });

    Object.values(net).forEach((b) => { b.net = b.paid - b.owed + b.settled; });
    return net;
  }

  // ── Debt simplification ───────────────────────────────
  // Greedily match the biggest creditor against the biggest debtor. Three people
  // with tangled mutual debts collapse to at most two payments — nobody wants to
  // make three transfers that cancel each other out.
  function simplifyDebts(balancesById) {
    const EPS = 0.005; // half a cent: below this, treat as settled
    const creditors = [], debtors = [];
    Object.values(balancesById).forEach((b) => {
      if (b.net > EPS) creditors.push({ id: b.member.id, member: b.member, amount: b.net });
      else if (b.net < -EPS) debtors.push({ id: b.member.id, member: b.member, amount: -b.net });
    });
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

    const payments = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci], d = debtors[di];
      const amount = Math.min(c.amount, d.amount);
      if (amount > EPS) payments.push({ from: d.member, to: c.member, amount });
      c.amount -= amount;
      d.amount -= amount;
      if (c.amount <= EPS) ci++;
      if (d.amount <= EPS) di++;
    }
    return payments;
  }

  // Your position in a wallet: positive = you're owed, negative = you owe.
  // Wallets are independent, so this is never summed across wallets in a way
  // that implies a single debt — the home card labels it as a total on purpose.
  function myPosition(wallet, balancesById) {
    if (!wallet.myMember) return 0;
    const b = balancesById[wallet.myMember.id];
    return b ? b.net : 0;
  }

  return {
    claimInvites, loadWallets, loadWallet, currentUserId,
    createWallet, updateWallet, archiveWallet,
    addMember, updateMember, removeMember, memberStatus,
    allocateEqual, allocateShares,
    saveExpense, deleteExpense, loadExpense, categoryTotals,
    saveSettlement, deleteSettlement,
    pushStatus, enablePush, disablePush, pushSupported,
    computeBalances, simplifyDebts, myPosition,
    toBase,
  };
})();

window.Split = Split;
