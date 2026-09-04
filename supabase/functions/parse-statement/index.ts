// Supabase Edge Function: parse-statement
// Reads an uploaded bank/credit-card statement PDF with Claude Haiku 4.5 and
// returns a STRUCTURED DRAFT (balances, liabilities, exchange rates, and
// categorized transactions) for the user to review and correct in the app.
//
// SECURITY: this function is the real gate on Grace's Claude API spend.
//   1. It requires a valid Supabase auth session (the caller must be logged in).
//   2. It requires the correct invite passkey in the request (server-side check;
//      unlike the browser passkey, this cannot be bypassed by reading page source).
// The Claude API key lives ONLY here as a Supabase secret (CLAUDE_API_KEY),
// never in the website code.
//
// Deploy:  supabase functions deploy parse-statement
// Secrets: supabase secrets set CLAUDE_API_KEY=sk-ant-...
//          supabase secrets set INVITE_PASSKEY=your-phrase
// (SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")!;
const INVITE_PASSKEY = Deno.env.get("INVITE_PASSKEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-invite-passkey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Categories the app understands (must match EXPENSE_CATS in app.js).
const CATEGORIES = ["rent", "food", "transport", "shopping", "travel", "entertainment", "fitness", "gift", "bills", "other"];

const buildPrompt = (BASE_CURRENCY: string) => `You read a single bank or credit-card statement (PDF) and return STRICT JSON describing what it contains. You never invent data. If a value is not clearly present, omit it or use null.

Return an object with these fields:
{
  "statement_kind": "asset" | "spending",   // asset = bank/savings statement showing balances you OWN; spending = credit-card statement (a liability you OWE)
  "period_month": <1-12 or null>,           // the statement's closing month
  "period_year": <YYYY or null>,
  "balances": [                              // closing balances shown on the statement
    { "name": "<account/sub-account label>", "amount": <number>, "currency": "<ISO code>", "exchange_rate_to_hkd": <number or null> }
  ],
  "liabilities": [                           // amounts OWED (e.g. a credit-card statement balance). Enter as a POSITIVE number owed.
    { "name": "<card label>", "amount": <number>, "currency": "<ISO code>" }
  ],
  "illiquid_balances": [                     // MPF / pension / investment CURRENT MARKET VALUE printed on the statement (fluctuates; informational only)
    { "name": "<label>", "amount": <number>, "currency": "<ISO code>" }
  ],
  "spending_total": <number or null>,        // THE STABLE TOTAL SPENDING for this statement (see the formula below). This is the authoritative number.
  "opening_balance": <number or null>,       // opening/brought-forward balance of the main account
  "closing_balance": <number or null>,       // closing balance of the main account
  "total_out": <number or null>,             // sum of ALL debits/withdrawals (money leaving the account)
  "income_in": <number or null>,             // salary / genuine income credited during the period (0 if none)
  "self_transfer_out": <number or null>,     // debits that are NOT spending: cash withdrawn that was later re-deposited, money moved to your own other account/wallet, paying your own card bill, and any debit whose matching credit also appears (round-trips). Sum of those debits.
  "transfers": [                              // EVERY debit you classified as a self-transfer above, listed individually so the user can check them. This is the single most common source of double-counted spending, so it must be auditable rather than hidden inside a total.
    { "date": "<YYYY-MM-DD or null>", "description": "<as printed>", "amount": <positive number in BASE_CURRENCY> }
  ],
  "possible_transfers": [                     // debits you did NOT exclude but that LOOK like they might be transfers to your own account or e-wallet (e.g. to Octopus, PayMe, Alipay, WeChat Pay, a named wallet, or another bank in your own name). Listing them lets the user confirm. Do not also put these in "transfers".
    { "date": "<YYYY-MM-DD or null>", "description": "<as printed>", "amount": <positive number in BASE_CURRENCY> }
  ],
  "monthly_breakdown": [                      // spending split by the CALENDAR MONTH of each transaction's date. A statement window that crosses months (e.g. 5 Jun–4 Jul) produces two entries. Amounts are rough — the app rescales.
    { "year": <YYYY>, "month": <1-12>, "categories": [ { "category": "<one of: ${CATEGORIES.join(", ")}>", "amount": <positive number in BASE_CURRENCY> } ] }
  ]
}

CURRENCY — ALL money amounts you output must be in the base currency (${BASE_CURRENCY}):
- spending_total, total_out, self_transfer_out, income_in, and every monthly_breakdown category amount must be converted to ${BASE_CURRENCY}.
- If the statement is entirely in ${BASE_CURRENCY}, no conversion is needed.
- If any transaction is in a foreign currency, convert it to ${BASE_CURRENCY} using the exchange rate printed on the statement (or the HKD-equivalent column if the statement shows one — many statements print both). If no rate is printed, use a reasonable approximate rate and still output ${BASE_CURRENCY}.
- The "balances", "liabilities", and "illiquid_balances" arrays keep their OWN currency + the exchange_rate_to_hkd field (the app converts those). Only the SPENDING numbers above are pre-converted to ${BASE_CURRENCY}.

HOW TO COMPUTE spending_total — it is MONEY THAT LEFT and did NOT come back. It must be STABLE (not depend on how you label lines). It is NOT reduced by salary/income.
- EVERY statement (bank OR card) has a spending_total — it is essentially never zero if money went out. A transfer-heavy bank account still has real spending (fees, payments, transfers out); those all count, most as category "other".
- Formula for ALL statements:
    spending_total = total_out - self_transfer_out
  where:
    total_out = the sum of ALL debits / withdrawals / money leaving the account (fees, purchases, transfers to people, ATM, everything out).
    self_transfer_out = ONLY the debits that are genuinely NOT spending: cash you withdrew that came back in the same statement, money moved to your own other account/wallet, paying your OWN credit-card bill, and any debit whose exact matching credit also appears (round-trips). If in doubt whether an outgoing transfer to a person is spending, TREAT IT AS SPENDING (do not put it in self_transfer_out) and categorize it as "other".
  Do NOT subtract salary or incoming money from spending_total — income is separate. Someone earning 20000 salary and spending 14000 has spending_total 14000, not -6000.
- Sanity check using the printed balances: opening_balance + (all credits including salary) - (all debits) should ≈ closing_balance. Use this to make sure you captured the debits correctly, so the same statement always yields the same spending_total.
- Set spending_total to null ONLY if you truly cannot read the debits; then the app falls back to its own figure.

monthly_breakdown rules — THE GUIDING PRINCIPLE: only label what is CLEARLY a recognizable merchant purchase; put everything else in "other".
- Group spending by the CALENDAR MONTH of each transaction's own date (use the activity/transaction date, not the statement date). A statement covering 5 Jun–4 Jul produces TWO entries: one {year:2026, month:6} for the 5–30 Jun transactions, one {year:2026, month:7} for the 1–4 Jul transactions. If the whole statement is within one calendar month, return a single entry.
- Within each month entry, these are ONLY the proportional split across categories. The app rescales them, so per-line precision does not matter — only the rough split.
- LABEL a transaction ONLY when the description is a recognizable merchant/brand and the category is obvious:
    restaurants / food delivery / supermarkets (Keeta, McDonald's, Pepper Lunch, Wellcome, PARKnSHOP, Lung Fung) -> food;
    ride-hailing / MTR / Octopus fares -> transport;
    clothing / online marketplaces (UNIQLO, Taobao, Revolve) -> shopping;
    gym / fitness classes (ClassPass, Active Minds) -> fitness;
    streaming / bars / cinemas -> entertainment;
    rent -> rent; utilities / telecom -> bills.
- Put in "other" (do NOT guess a specific category): any transfer or FPS payment to/from a PERSON's name, generic references, bank-to-bank transfers, ATM/cash withdrawals, ambiguous merchant names, or anything you are not confident about. A bank/savings statement that is mostly person-to-person transfers should be almost entirely "other".
- EXCLUDE entirely (not spending at all): salary/income, paying your own credit-card bill, moving money between your own accounts, wallet top-ups, and cash withdrawn then re-deposited.

Other rules:
- If the statement prints an exchange rate for a foreign-currency line, put it in exchange_rate_to_hkd.
- A credit-card "statement balance" is a liability (amount owed) -> put it under "liabilities", positive.
- Do not include a "transactions" list; only the aggregate fields above.
- Output ONLY the JSON object, no prose.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    // 1. Require a valid Supabase auth session.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "not_authenticated" }, 401);
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "not_authenticated" }, 401);

    // 2. Server-side invite passkey check (the real spend gate).
    if (INVITE_PASSKEY) {
      const provided = req.headers.get("x-invite-passkey") || "";
      if (provided !== INVITE_PASSKEY) return json({ error: "invalid_passkey" }, 403);
    }

    // 3. Read the uploaded PDF (base64) + base currency from the request body.
    const body = await req.json();
    const pdfBase64: string = body?.pdf_base64 || "";
    if (!pdfBase64) return json({ error: "no_pdf" }, 400);
    const baseCurrency: string = (typeof body?.base_currency === "string" && body.base_currency.trim()) ? body.base_currency.trim().toUpperCase().slice(0, 6) : "HKD";

    // 4. Call Claude Haiku 4.5 with the PDF as a document block.
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system: buildPrompt(baseCurrency),
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: "Read this statement and return the JSON described in your instructions." },
          ],
        }],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      return json({ error: "claude_error", detail: errText.slice(0, 500) }, 502);
    }
    const claudeData = await claudeResp.json();
    const textBlock = (claudeData.content || []).find((b: any) => b.type === "text");
    const raw = textBlock?.text || "";

    // 5. Parse the model's JSON (tolerate a stray code fence).
    let draft: unknown;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      draft = JSON.parse(cleaned);
    } catch {
      return json({ error: "parse_failed", raw: raw.slice(0, 1000) }, 502);
    }

    return json({ draft, usage: claudeData.usage || null }, 200);
  } catch (e) {
    return json({ error: "server_error", detail: String(e).slice(0, 500) }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
