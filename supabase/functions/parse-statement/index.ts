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

const SYSTEM_PROMPT = `You read a single bank or credit-card statement (PDF) and return STRICT JSON describing what it contains. You never invent data. If a value is not clearly present, omit it or use null.

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
  "transactions": [                          // spending statements only: individual line items
    { "date": "<YYYY-MM-DD or null>", "description": "<merchant/desc>", "amount": <positive number spent>, "currency": "<ISO code>",
      "category": "<one of: ${CATEGORIES.join(", ")}>", "is_transfer": <true if this is a self-payment, wallet top-up, or paying your own card bill (NOT real spending), else false> }
  ]
}

Rules:
- If the statement prints an exchange rate for a foreign-currency line, put it in exchange_rate_to_hkd.
- A credit-card "statement balance" is a liability (amount owed) -> put it under "liabilities", positive.
- On a credit-card statement, deposits/payments INTO the card (e.g. paying the bill, a refund) and wallet top-ups (e.g. Octopus) are transfers, not expenses: set is_transfer=true. Purchases are is_transfer=false with a best-guess category.
- Categorize by merchant when possible (restaurants/food delivery -> food; ride-hailing/MTR/Octopus -> transport; clothing/marketplaces -> shopping; gym/classes -> fitness; streaming/bars -> entertainment). If unsure, use "other".
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

    // 3. Read the uploaded PDF (base64) from the request body.
    const body = await req.json();
    const pdfBase64: string = body?.pdf_base64 || "";
    if (!pdfBase64) return json({ error: "no_pdf" }, 400);

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
        system: SYSTEM_PROMPT,
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
