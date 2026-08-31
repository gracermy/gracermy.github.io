// Supabase Edge Function: send-push
//
// Called by a Database Webhook whenever a row lands in shared_expenses or
// settlements. Looks up everyone in that wallet EXCEPT the person who caused
// the change, and sends them a push notification.
//
// SECURITY: this function is called by Supabase itself, not by a browser.
//   * It uses the SERVICE ROLE key, which bypasses RLS — necessary, because it
//     must read push subscriptions belonging to other people. That is exactly
//     why this work happens server-side: a browser must never be able to read
//     another member's push endpoints.
//   * It verifies a shared secret header, so only our webhook can invoke it.
//     Without that, anyone who learned the URL could spam notifications.
//
// Deploy:  supabase functions deploy send-push --no-verify-jwt
//   (--no-verify-jwt because the caller is the database webhook, which sends
//    our own secret header instead of a user JWT.)
// Secrets: supabase secrets set VAPID_KEYS='{"publicKey":{...},"privateKey":{...}}'
//          supabase secrets set VAPID_SUBJECT=mailto:you@example.com
//          supabase secrets set PUSH_HOOK_SECRET=some-long-random-string
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_KEYS = Deno.env.get("VAPID_KEYS")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") || "";

const db = createClient(SUPABASE_URL, SERVICE_KEY);

// Built once per cold start, not per request.
let appServerPromise: Promise<webpush.ApplicationServer> | null = null;
function appServer() {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const keys = await webpush.importVapidKeys(JSON.parse(VAPID_KEYS), { extractable: false });
      return await webpush.ApplicationServer.new({
        contactInformation: VAPID_SUBJECT,
        vapidKeys: keys,
      });
    })();
  }
  return appServerPromise;
}

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency", currency, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
};

// Build the notification text for one database event.
// Returns null when the event shouldn't notify anyone.
async function buildMessage(table: string, row: Record<string, unknown>) {
  const walletId = row.wallet_id as string;
  if (!walletId) return null;

  const { data: wallet } = await db
    .from("wallets").select("name, emoji, base_currency").eq("id", walletId).maybeSingle();
  if (!wallet) return null;

  if (table === "shared_expenses") {
    const { data: payer } = await db
      .from("wallet_members").select("display_name")
      .eq("id", row.paid_by_member_id as string).maybeSingle();
    const rate = Number(row.exchange_rate) || 1;
    const amount = (Number(row.amount) || 0) * rate;
    const what = (row.description as string) || (row.category as string) || "an expense";
    return {
      title: `${wallet.emoji || "👛"} ${wallet.name}`,
      body: `${payer?.display_name || "Someone"} added ${what} · ${money(amount, wallet.base_currency)}`,
      url: `/finance/#wallet/${walletId}`,
    };
  }

  if (table === "settlements") {
    const [{ data: from }, { data: to }] = await Promise.all([
      db.from("wallet_members").select("display_name").eq("id", row.from_member_id as string).maybeSingle(),
      db.from("wallet_members").select("display_name").eq("id", row.to_member_id as string).maybeSingle(),
    ]);
    const rate = Number(row.exchange_rate) || 1;
    const amount = (Number(row.amount) || 0) * rate;
    return {
      title: `${wallet.emoji || "👛"} ${wallet.name}`,
      body: `${from?.display_name || "Someone"} paid ${to?.display_name || "someone"} ${money(amount, wallet.base_currency)}`,
      url: `/finance/#wallet/${walletId}`,
    };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Only our own webhook may invoke this.
  if (!HOOK_SECRET || req.headers.get("x-push-secret") !== HOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let payload: { type?: string; table?: string; record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Only new rows notify. An edit shouldn't ping everyone again — a
  // notification per typo correction is how people learn to ignore them.
  if (payload.type !== "INSERT" || !payload.record || !payload.table) {
    return new Response(JSON.stringify({ skipped: "not an insert" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = await buildMessage(payload.table, payload.record);
  if (!message) {
    return new Response(JSON.stringify({ skipped: "nothing to say" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Everyone in the wallet except whoever caused this.
  const actor = (payload.record.created_by as string) || "00000000-0000-0000-0000-000000000000";
  const { data: targets, error } = await db.rpc("wallet_push_targets", {
    wid: payload.record.wallet_id as string,
    actor,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (!targets || !targets.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "no subscribers" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const server = await appServer();
  const body = JSON.stringify(message);
  let sent = 0;
  const expired: string[] = [];

  await Promise.all(targets.map(async (t: { endpoint: string; p256dh: string; auth: string }) => {
    try {
      const subscriber = server.subscribe({
        endpoint: t.endpoint,
        keys: { p256dh: t.p256dh, auth: t.auth },
      });
      await subscriber.pushTextMessage(body, {});
      sent++;
    } catch (e) {
      // 404/410 mean the browser threw this subscription away (app deleted,
      // permission revoked, iOS expiry). Those rows are dead weight that would
      // fail forever, so collect them for deletion.
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) expired.push(t.endpoint);
    }
  }));

  if (expired.length) {
    await db.from("push_subscriptions").delete().in("endpoint", expired);
  }

  return new Response(JSON.stringify({ sent, pruned: expired.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
