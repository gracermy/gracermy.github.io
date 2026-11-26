// Shared storage for the calendar.
//
// Everything is a flat map of key -> value, for example
//   "day:5:coupon:a"  -> { title, note, by, at }
// Each person only ever writes their own keys, so two phones never overwrite
// each other. Each key is one row in Supabase (see setup.sql).
//
// Two modes:
//   - "supabase": used when ../finance/config.js provides the project URL and
//     public key. Reads and writes go through password-checked functions, and
//     the page checks for the other person's changes every few seconds.
//   - "local": fallback when there's no Supabase config. Saves in this
//     browser only; open two tabs as two people to test.

(function () {
  const FIN = window.FINANCE_CONFIG || {};
  const remote = window.ADVENT_CONFIG.USE_SUPABASE !== false &&
    FIN.SUPABASE_URL && FIN.SUPABASE_ANON_KEY && !FIN.SUPABASE_URL.includes("YOUR-PROJECT");
  const POLL_MS = 4000;
  const listeners = new Set();
  let state = {};
  let pass = null;
  let since = null;     // newest updated_at we've seen (ISO string)
  let timer = null;

  const emit = (before) => listeners.forEach((fn) => fn(state, before));

  // ── Supabase (plain REST calls, no library needed) ──
  async function rpc(fn, args) {
    const res = await fetch(`${FIN.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: FIN.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${FIN.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.message || `Request failed (${res.status})`);
      err.wrongPassword = body?.code === "28P01";
      err.notSetUp = body?.code === "PGRST202" || res.status === 404;
      throw err;
    }
    return body;
  }

  async function pull({ quiet = false } = {}) {
    // Ask for a little overlap, so a save that committed a moment late isn't missed.
    const from = since ? new Date(new Date(since).getTime() - 10000).toISOString() : null;
    const rows = await rpc("advent_pull", { p_pass: pass, p_since: from });
    if (!rows.length) return;
    const before = state;
    const next = { ...state };
    let changed = false;
    for (const r of rows) {
      if (!since || r.updated_at > since) since = r.updated_at;
      const cur = next[r.key];
      if (r.value === null) { if (r.key in next) { delete next[r.key]; changed = true; } }
      else if (JSON.stringify(cur) !== JSON.stringify(r.value)) { next[r.key] = r.value; changed = true; }
    }
    if (changed) { state = next; if (!quiet) emit(before); }
  }

  function startPolling() {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) pull().catch(() => {}); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull().catch(() => {}); });
  }

  // ── local fallback ──
  const LS_KEY = "advent_state_v1";
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } };
  if (!remote) {
    window.addEventListener("storage", (e) => {
      if (e.key !== LS_KEY) return;
      const before = state; state = readLocal(); emit(before);
    });
  }

  window.AdventStore = {
    mode: remote ? "supabase" : "local",

    // Password check for the gate. Local mode has no real password.
    async check(pw) {
      if (!remote) return true;
      return await rpc("advent_check", { p_pass: pw }) === true;
    },

    async load(pw) {
      pass = pw;
      if (!remote) { state = readLocal(); return state; }
      state = {}; since = null;
      await pull({ quiet: true }); // first load: no "new!" toasts for everything
      startPolling();
      return state;
    },

    // Re-read everything (picks up a day's content once it's released, which
    // the "only what changed" checks can miss because that content was saved
    // before the day came).
    async refresh() {
      if (!remote) return;
      const before = state;
      const rows = await rpc("advent_pull", { p_pass: pass, p_since: null });
      const next = {};
      for (const r of rows) {
        if (r.value !== null) next[r.key] = r.value;
        if (!since || r.updated_at > since) since = r.updated_at;
      }
      state = next;
      emit(before);
    },

    get(key) { return state[key]; },
    all() { return state; },

    // quiet: a background save (like "door opened") that shouldn't pop up an
    // error if it fails.
    async set(key, value, { quiet = false } = {}) {
      const before = state;
      state = { ...state, [key]: value };
      if (value === null) delete state[key];
      if (!remote) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
        catch (e) { state = before; alert("Couldn't save, the browser's storage may be full (photos take space)."); throw e; }
      } else {
        try { await rpc("advent_put", { p_pass: pass, p_key: key, p_value: value }); }
        catch (e) {
          state = before; emit(before);
          if (!quiet) alert("Couldn't save. Check your internet connection and try again.");
          throw e;
        }
      }
      emit(before);
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // Notifications: register / forget this phone (see push-setup.sql).
    canNotify: !!(remote && FIN.VAPID_PUBLIC_KEY),
    vapidKey: FIN.VAPID_PUBLIC_KEY || "",
    async savePush(person, sub) {
      const j = sub.toJSON();
      await rpc("advent_subscribe", { p_pass: pass, p_person: person, p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    },
    async forgetPush(endpoint) {
      await rpc("advent_unsubscribe", { p_pass: pass, p_endpoint: endpoint });
    },
  };
})();
