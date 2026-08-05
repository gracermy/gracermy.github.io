// Finance app configuration — TEMPLATE.
//
// SETUP: copy this file to `config.js` in the same folder and fill in the two
// values from your Supabase project (Settings -> API):
//   - Project URL     e.g. https://abcdefgh.supabase.co
//   - anon public key (a long JWT string; this key is safe to expose in the
//     browser — Row Level Security is what actually protects your data)
//
// `config.js` is gitignored so you can keep your own values out of the repo.
// The app reads window.FINANCE_CONFIG below.

window.FINANCE_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",

  // Default base currency for new snapshots (you can change per snapshot).
  BASE_CURRENCY: "HKD",

  // Invite passkey: users must type this before they can create an account.
  // Share it only with people you want to let in. Change it anytime to stop
  // new signups. NOTE: this is checked in the browser, so it's a casual gate
  // to keep random people out — not unbreakable. The real protection for your
  // Claude API spend is the server-side check in the statement Edge Function
  // (added in Phase 3). Existing accounts keep working if you change this.
  INVITE_PASSKEY: "change-me-to-a-secret-phrase",

  // AI statement reading (Phase 3). Leave false until you've deployed the
  // parse-statement Edge Function and set your Claude API key as a Supabase
  // secret (see finance/setup/edge-functions/README.md). When true, the
  // snapshot form shows an "upload statement" option.
  AI_STATEMENTS: false,
};
