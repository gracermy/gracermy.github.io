// Bloom configuration — COMMITTED on purpose (see below).
//
// This file ships to every device so the app "just works" with no per-device
// setup. That is SAFE because it contains only:
//   • SUPABASE_URL      — your project URL (public)
//   • SUPABASE_ANON_KEY — the ANON public key (designed to ship in client code;
//                         Row Level Security protects your data, not key secrecy)
//   • INVITE_PASSKEY    — gates who can create an account (a light gate)
//
// It does NOT contain — and must NEVER contain — your database password, your
// service_role key, or your Claude API key. (If you paste the service_role key
// by mistake, the app refuses to run.)
//
// ── FILL IN YOUR REAL VALUES BELOW ──
// Get URL + anon key from: Supabase → Project Settings → API
//   - "Project URL"        → SUPABASE_URL
//   - "anon public" key    → SUPABASE_ANON_KEY   (NOT the service_role key)

window.FINANCE_CONFIG = {
  SUPABASE_URL: "https://mpuyphvmpnxdlvoosiwn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_KJvAdAKrfZ4G43iHK-73jQ_5ppYbqcv",

  // Base currency for new snapshots (changeable per snapshot).
  BASE_CURRENCY: "HKD",

  // Share this only with people you want to let create an account.
  // Must match the INVITE_PASSKEY secret set on the parse-statement Edge Function.
  INVITE_PASSKEY: "flowers-diamond-rings",

  // Turn on AI statement reading (needs the deployed Edge Function + Claude key).
  AI_STATEMENTS: true,
};
