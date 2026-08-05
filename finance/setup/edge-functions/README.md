# AI statement reading — setup (Phase 3)

This adds the "Read a statement" button to Bloom: upload a bank or credit-card
PDF and Claude drafts the numbers for you to confirm. It needs two things you set
up once: a **Claude API account** (pay-as-you-go, ~pennies/month) and the
**parse-statement Edge Function** deployed to your Supabase project (holds the
API key server-side; it never touches the website code).

Everything until now (login, snapshots, charts) works without this. Do this only
when you want the upload feature.

---

## 1. Create a Claude API account (~5 min)

1. Go to <https://console.anthropic.com> and sign up. **This is separate from any
   Claude.ai/Claude Code subscription** — it's pay-as-you-go and billed on its own.
2. Add a payment method (Billing). Add a small amount of credit (even $5 lasts a
   very long time — statement scans cost well under a cent each with Haiku).
3. Create an **API key** (API Keys → Create Key). Copy it (starts with `sk-ant-`).
   Keep it secret — anyone with it can spend your credit.

## 2. Install the Supabase CLI (~5 min)

The Edge Function is deployed with the Supabase CLI.

- macOS: `brew install supabase/tap/supabase`
- Or see <https://supabase.com/docs/guides/cli> for other options.

Then log in and link your project (from the repo root):

```
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project ref is in the Supabase dashboard URL (`https://supabase.com/dashboard/project/<REF>`),
or under Project Settings → General.

## 3. Set the secrets (the API key lives here, not in the website)

```
supabase secrets set CLAUDE_API_KEY=sk-ant-your-key-here
supabase secrets set INVITE_PASSKEY=your-invite-phrase
```

- `CLAUDE_API_KEY` — your key from step 1.
- `INVITE_PASSKEY` — **the same phrase** you put in `finance/config.js`. This is
  the real gate on your API spend: the function refuses to run unless the caller
  is logged in AND sends this exact passkey. (The browser passkey alone is only a
  casual gate; this server-side check is the true wallet protection.)

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by the platform automatically —
you do not set those.

## 4. Deploy the function

From the repo root (the function code is in this folder):

```
supabase functions deploy parse-statement --project-ref YOUR_PROJECT_REF
```

The CLI looks for functions in `supabase/functions/` by default. Either move/copy
`parse-statement/` there, or run the deploy from inside
`finance/setup/edge-functions/` after copying it into a `supabase/functions/`
layout. (Simplest: copy `finance/setup/edge-functions/parse-statement` to
`supabase/functions/parse-statement` at the repo root, then run the deploy.)

## 5. Turn it on in the app

In `finance/config.js`, set:

```js
AI_STATEMENTS: true,
```

Reload the app. The snapshot form now shows **"Read a statement (AI draft)"**.

---

## How it works (and stays cheap + private)

- You upload a PDF → the browser sends it (with your login token + invite passkey)
  to the `parse-statement` Edge Function.
- The function verifies you're logged in, checks the passkey, then calls **Claude
  Haiku 4.5** with the PDF and a strict extraction prompt.
- Claude returns a **draft** (balances, liabilities, printed FX rates, and
  categorized transactions). The app shows it for you to review and correct.
- **Nothing is saved until you click Apply.** Apply fills your balance rows (matched
  to your accounts by name and type) and seeds big-picture expense lines from the
  categories. Transfers/self-payments (e.g. paying your own card, Octopus top-ups)
  are flagged and excluded from the category totals.

**Cost:** roughly $0.005–0.01 per statement with Haiku 4.5; a handful per month is
a few cents. **Privacy:** the PDF goes to your Edge Function → the Claude API for
that one request; it is not stored by the app. **VPN:** your users do NOT need your
VPN — the API call originates from Supabase's servers, not anyone's browser.

## Troubleshooting

- "Invite passkey rejected by the server" → the `INVITE_PASSKEY` secret doesn't
  match `config.js`. Re-set the secret and redeploy.
- "The AI service returned an error" → check your Claude API account has credit and
  the `CLAUDE_API_KEY` secret is correct.
- To change the model later, edit `model: "claude-haiku-4-5"` in
  `parse-statement/index.ts` (e.g. to `claude-sonnet-5` for tougher statements) and
  redeploy.
