# Finance Tracker — Setup Guide

This app needs one free service: **Supabase** (your private login + database).
The AI statement-reading feature (added later) needs a **Claude API** account — you
can skip that until Phase 3.

Everything below is a one-time setup. Takes ~10 minutes.

---

## 1. Create a Supabase project (free)

1. Go to <https://supabase.com> and sign up (GitHub login works).
2. Click **New project**.
   - Name: anything, e.g. `finance-tracker`
   - Database password: pick a strong one and save it (you rarely need it again).
   - Region: choose one near you (e.g. Southeast Asia / Singapore for HK).
3. Wait ~2 minutes for it to provision.

## 2. Create the database tables

1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `finance/setup/schema.sql` from this repo, copy its entire contents,
   paste into the editor, and click **Run**.
3. You should see "Success. No rows returned." That created all tables + the
   security rules (Row Level Security) so each user only sees their own data.

## 3. Get your two config values

1. Go to **Project Settings** (gear icon) → **API**.
2. Copy:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public** key (a long string starting with `eyJ...`)
   - ⚠️ Do NOT copy the `service_role` key — that one is secret. The `anon`
     key is meant for the browser and is safe to use here.

## 4. Add the values to the app

1. Copy `finance/config.sample.js` to `finance/config.js` (same folder).
2. Open `finance/config.js` and paste your Project URL and anon key.
3. `config.js` is gitignored, so your values stay out of the public repo.

## 5. Turn on email/password login

1. In Supabase: **Authentication** → **Providers** → make sure **Email** is enabled.
2. For a private app with a few known users, it's easiest to **turn off email
   confirmation** while setting up:
   **Authentication** → **Sign In / Providers** (or **Settings**) → disable
   "Confirm email". (You can leave it on if you're fine clicking a confirm link.)
3. To limit who can join: after you and your chosen users have signed up, you can
   **disable new sign-ups** under **Authentication → Settings** so no one else can
   register. (Optional — do this once your circle is in.)

## 6. Run the app

- **Locally:** from the repo root, run `python3 -m http.server 8000`, then open
  <http://localhost:8000/finance/>.
- **Live:** once pushed to GitHub, it's at `https://gracermy.github.io/finance/`.
  (Remember: `config.js` is gitignored, so on the live site you either commit a
  config or use the in-app setup screen — see the app's first-run screen.)

---

## Later: Claude API (for AI statement reading — Phase 3)

You'll create an account at <https://console.anthropic.com>, add a payment method,
and generate an API key. That key is stored as a **secret in a Supabase Edge
Function** — never in the website code. We'll walk through this when we build that
feature. Estimated cost for your usage: a few cents per month.
