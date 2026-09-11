// Supabase Edge Function: gather-perks
//
// Gathers what the user's cards and memberships currently get them, using
// Claude with the server-side web search tool, and returns a structured draft.
//
// WHY ONE BIG GATHER RATHER THAN PER-QUESTION LOOKUP:
// searching live on every "what about Wellcome?" costs money per question and
// takes 10-20s. Gathering once and storing the result makes every later search
// free and instant, and lets you browse what you have rather than only
// answering questions you already thought to ask. The cost is staleness, which
// is why every offer carries when it was gathered and when it ends.
//
// WHAT IS DELIBERATELY EXCLUDED: new-customer and welcome offers, and anything
// requiring a new application. Search results are dominated by them (they are
// what banks market), and they are useless to someone who already holds the
// card. Including them would fill the list with attractive offers the user
// cannot actually use, which is worse than an empty list.
//
// Deploy: supabase functions deploy gather-perks

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

const buildPrompt = (today: string) => `You research what a Hong Kong credit card or membership currently gets its EXISTING holder, using web search. Today is ${today}.

Search the issuer's own pages first, then reputable Hong Kong sources. Prefer what the issuer publishes over what a comparison site summarises.

Return STRICT JSON:
{
  "offers": [
    {
      "merchant": "<the shop, chain, or category this applies at, e.g. \\"Wellcome\\", \\"Supermarkets\\", \\"Any merchant\\">",
      "headline": "<one short line: the benefit itself, e.g. \\"8% off on the 3rd, 13th and 23rd\\">",
      "detail": "<a fuller sentence or two, if there is more worth knowing>",
      "requirements": "<the conditions a holder must meet: minimum spend, registration, caps, eligible days, excluded goods. Write \\"None stated\\" only if you genuinely found none>",
      "tier": "<the tier this applies to, if the card has tiers and this differs between them; otherwise null>",
      "starts_on": "<YYYY-MM-DD or null>",
      "ends_on": "<YYYY-MM-DD, or null if it is an ongoing card feature with no end date>",
      "source_url": "<the page you actually took this from>",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "notes": "<anything the holder should know that is not an offer: a recent change to the card's terms, a benefit that just ended. One or two sentences, or null>"
}

Rules:
- EXCLUDE welcome offers, sign-up bonuses, new-customer promotions, referral bonuses, and anything conditional on applying for a card. The user ALREADY HOLDS this card; those offers are unavailable to them and would be noise at best and misleading at worst. This exclusion matters more than completeness — search results are dominated by these, so you must actively leave them out.
- EXCLUDE offers that have clearly already ended before ${today}.
- REQUIREMENTS ARE THE POINT. Hong Kong offers carry heavy fine print: minimum spend, monthly caps, registration, eligible dates, excluded categories, first-N-customers. Those exclusions are exactly what a summary loses, and a holder who acts on a benefit they do not qualify for is worse off than one who never saw it. Capture them specifically ("min HK$100 net spend in store", not "conditions apply").
- "source_url" must be a page you actually used. Never invent one. If a benefit has no source you can point at, leave it out.
- Set "confidence" honestly: "high" only when the issuer's own page states it plainly; "low" when you are inferring or the source is dated.
- If the card has tiers and a benefit differs by tier, produce SEPARATE entries with "tier" set. If it applies to all tiers, use null.
- Prefer FEWER, well-sourced entries over many vague ones. Five accurate benefits beat twenty guesses.
- If you find nothing usable, return an empty offers array. That is a valid and honest answer.
- Output ONLY the JSON object, no prose.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "not_authenticated" }, 401);
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "not_authenticated" }, 401);

    if (INVITE_PASSKEY) {
      const provided = req.headers.get("x-invite-passkey") || "";
      if (provided !== INVITE_PASSKEY) return json({ error: "invalid_passkey" }, 403);
    }

    const body = await req.json();
    const name: string = String(body?.name || "").trim();
    const issuer: string = String(body?.issuer || "").trim();
    const tier: string = String(body?.tier || "").trim();
    const kind: string = body?.kind === "membership" ? "membership" : "card";
    if (!name) return json({ error: "no_name" }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const subject = [issuer, name].filter(Boolean).join(" ")
      + (tier ? ` (the holder's tier is: ${tier})` : "");

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        // Opus for the gathering: this is a research task where missing a
        // requirement has a real cost to the user at the till.
        model: "claude-opus-5",
        max_tokens: 8000,
        system: buildPrompt(today),
        // The server-side web search tool runs on Anthropic's side; results
        // come back in the same response, no client loop needed.
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
        messages: [{
          role: "user",
          content: `Research what this ${kind} currently gets an EXISTING holder in Hong Kong, and return the JSON described in your instructions.\n\n${subject}`,
        }],
      }),
    });

    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      return json({ error: "claude_error", detail: errText.slice(0, 500) }, 502);
    }
    const claudeData = await claudeResp.json();

    // With a server tool in play the response holds several blocks (search
    // calls, their results, then the text). The JSON is in the LAST text block.
    const texts = (claudeData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text);
    const raw = texts.length ? texts[texts.length - 1] : "";

    let parsed: any;
    try {
      const cleaned = String(raw).trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "parse_failed", raw: String(raw).slice(0, 1000) }, 502);
    }

    return json({
      offers: Array.isArray(parsed.offers) ? parsed.offers : [],
      notes: parsed.notes || null,
      usage: claudeData.usage || null,
    }, 200);
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
