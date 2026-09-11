// Supabase Edge Function: resolve-cards
//
// Turns what someone TYPED ("hang seng enjoy", "mox") into the actual product
// they hold. This matters more than it sounds: Hang Seng sells both an "enJoy
// Card" and an "enJoy Visa Platinum Card", and an "MPOWER Platinum" alongside
// an "MMPOWER World Mastercard" — one letter apart, different benefits. A promo
// gathered against the wrong product is simply wrong.
//
// IT PROPOSES, THE USER CONFIRMS. It deliberately does not autocorrect: a silent
// substitution would leave someone holding offers for a card they don't own with
// no sign anything was swapped. Ambiguity is surfaced, not hidden.
//
// SECURITY: same gate as parse-statement — a valid session plus the server-side
// invite passkey. The Claude key lives only here.
//
// Deploy: supabase functions deploy resolve-cards

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

const SYSTEM_PROMPT = `You identify credit cards and membership/loyalty programmes from what a user typed, for a personal finance app used in HONG KONG. Default to Hong Kong issuers and programmes unless the input clearly points elsewhere.

You are given a list of typed entries. For EACH one, return the real products it might be.

Return STRICT JSON:
{
  "results": [
    {
      "typed": "<the input string, copied back exactly>",
      "kind": "card" | "membership",
      "candidates": [
        {
          "name": "<the official product name, as the issuer writes it>",
          "issuer": "<bank / company name>",
          "tiers": ["<tier names, if this product has tiers the user must choose between>"],
          "distinguisher": "<ONE short line naming what sets this apart from the OTHER candidates for this same input>",
          "official_url": "<the issuer's own page for this product, or null>",
          "confidence": "high" | "medium" | "low"
        }
      ]
    }
  ]
}

Rules:
- If the input clearly identifies ONE product, return exactly one candidate with confidence "high".
- If it is ambiguous, return EVERY plausible product (2-4), each with a distinguisher. This is the case that matters most: "Hang Seng enJoy" must return both the enJoy Card and the enJoy Visa Platinum Card, because they are different products.
- "distinguisher" must be the DIFFERENCE, not marketing copy. Name the concrete benefit or audience that separates it from its siblings ("8% at Wellcome on the 3rd, 13th, 23rd" beats "a rewarding everyday card"). If two candidates would get the same distinguisher, you have not distinguished them.
- TIERS: list them only when the tier changes what the holder actually gets, so the user must pick one. Mox Credit is the clear example: from 1 September 2026, Mox+ holders earn 2% unlimited cashback and holders without Mox+ earn 1%, on the same card. Where tiers do not change benefits, return an empty array.
- If you cannot identify the product at all, return an EMPTY candidates array. Do not invent a plausible-sounding card. An honest "not found" keeps what the user typed; a fabricated match silently corrupts their records.
- Never return a product from the wrong issuer just because the name is similar.
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
    const entries: string[] = Array.isArray(body?.entries) ? body.entries : [];
    const kindHint: string = body?.kind === "membership" ? "membership" : "card";
    if (!entries.length) return json({ error: "no_entries" }, 400);
    // A sane ceiling: this is one person adding their own wallet, not a bulk import.
    if (entries.length > 25) return json({ error: "too_many" }, 400);

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
          content: `These are ${kindHint === "membership" ? "membership / loyalty programme" : "credit card"} names a Hong Kong user typed. Identify each.\n\n`
            + entries.map((e, i) => `${i + 1}. ${e}`).join("\n"),
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

    let parsed: any;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "parse_failed", raw: raw.slice(0, 1000) }, 502);
    }

    return json({ results: parsed.results || [], usage: claudeData.usage || null }, 200);
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
