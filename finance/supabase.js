// Supabase client init + config resolution.
//
// Config comes from two places, merged with localStorage taking priority:
//   1. window.FINANCE_CONFIG  (from config.js — convenient for local dev)
//   2. localStorage["bloom_config"]  (saved by the in-app first-run setup screen)
// This lets the live site (where config.js is gitignored and not deployed) get
// its config from a setup screen, per device, without committing secrets.
//
// The @supabase/supabase-js UMD bundle is loaded via CDN in index.html and
// exposes a global `supabase` with createClient().

const LS_KEY = "bloom_config";
let client = null;
let configError = null;

function savedConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
}

// Merged config: localStorage wins over config.js field-by-field.
function config() {
  const file = window.FINANCE_CONFIG || {};
  const ls = savedConfig() || {};
  return { ...file, ...ls };
}

function isPlaceholder(cfg) {
  return !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT") ||
    !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON");
}

function initSupabase() {
  const cfg = config();
  if (isPlaceholder(cfg)) { configError = "missing-config"; return null; }
  if (!window.supabase || !window.supabase.createClient) { configError = "sdk-not-loaded"; return null; }
  client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  configError = null;
  return client;
}

function getClient() {
  if (!client) initSupabase();
  return client;
}

// Called by the setup screen. Persists to localStorage and re-inits the client.
function saveConfig(values) {
  const clean = {
    SUPABASE_URL: (values.SUPABASE_URL || "").trim(),
    SUPABASE_ANON_KEY: (values.SUPABASE_ANON_KEY || "").trim(),
    INVITE_PASSKEY: (values.INVITE_PASSKEY || "").trim(),
    BASE_CURRENCY: (values.BASE_CURRENCY || "HKD").trim(),
    AI_STATEMENTS: !!values.AI_STATEMENTS,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(clean));
  client = null; // force re-init with new values
  return initSupabase();
}

function clearConfig() { localStorage.removeItem(LS_KEY); client = null; }
function hasSavedConfig() { return !!savedConfig(); }

function getConfigError() { return configError; }
function baseCurrency() { return config().BASE_CURRENCY || "HKD"; }
function invitePasskey() { return config().INVITE_PASSKEY || ""; }
function functionsUrl() {
  const url = config().SUPABASE_URL;
  if (!url) return "";
  return url.replace(".supabase.co", ".functions.supabase.co");
}
function aiEnabled() { return !!config().AI_STATEMENTS; }

window.FinanceDB = {
  initSupabase, getClient, getConfigError, baseCurrency, invitePasskey,
  functionsUrl, aiEnabled, saveConfig, clearConfig, hasSavedConfig, config,
};
