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

  if (table === "wallet_members") {
    return {
      title: `${wallet.emoji || "👛"} ${wallet.name}`,
      body: `${row.display_name || "Someone"} joined the wallet`,
      url: `/finance/#wallet/${walletId}`,
    };
  }

  return null;
}

type Target = { endpoint: string; p256dh: string; auth: string };

// Send one message to a set of devices, pruning any the push service reports
// as gone. Shared by the event notifications and the weekly digest.
async function pushToTargets(targets: Target[], message: unknown) {
  if (!targets.length) return { sent: 0, pruned: 0 };
  const server = await appServer();
  const body = JSON.stringify(message);
  let sent = 0;
  const expired: string[] = [];

  await Promise.all(targets.map(async (t) => {
    try {
      const subscriber = server.subscribe({
        endpoint: t.endpoint,
        keys: { p256dh: t.p256dh, auth: t.auth },
      });
      await subscriber.pushTextMessage(body, {});
      sent++;
    } catch (e) {
      // 404/410 mean the browser threw this subscription away (app deleted,
      // permission revoked, iOS expiry). Those rows would fail forever.
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) expired.push(t.endpoint);
    }
  }));

  if (expired.length) {
    await db.from("push_subscriptions").delete().in("endpoint", expired);
  }
  return { sent, pruned: expired.length };
}

// The weekly digest: one notification per person summarising the last 7 days.
// Sent to everyone who has notifications on and had activity; people with a
// quiet week get nothing rather than a "you spent nothing" ping.
async function sendWeeklySummaries() {
  const { data: rows, error } = await db.rpc("weekly_summaries");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let people = 0, sent = 0;
  for (const r of (rows || [])) {
    const { data: targets } = await db.rpc("user_push_targets", { uid: r.user_id });
    if (!targets || !targets.length) continue;

    const share = money(Number(r.your_share) || 0, r.currency);
    const total = money(Number(r.total_spent) || 0, r.currency);
    const n = Number(r.expense_count) || 0;
    const wallets = Number(r.wallet_count) || 1;
    const where = wallets === 1 ? "1 wallet" : `${wallets} wallets`;

    const result = await pushToTargets(targets as Target[], {
      title: "Your week in Bloom",
      body: `${n} ${n === 1 ? "expense" : "expenses"} across ${where}. ${total} spent, your share ${share}.`,
      url: "/finance/#wallets",
    });
    people++;
    sent += result.sent;
  }

  return new Response(JSON.stringify({ people, sent }), {
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Only our own webhook may invoke this.
  if (!HOOK_SECRET || req.headers.get("x-push-secret") !== HOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let payload: {
    type?: string;
    table?: string;
    record?: Record<string, unknown>;
    old_record?: Record<string, unknown>;
    job?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // The weekly digest is triggered by pg_cron rather than a table event.
  if (payload.job === "weekly-summary") {
    return await sendWeeklySummaries();
  }

  if (!payload.record || !payload.table) {
    return new Response(JSON.stringify({ skipped: "no record" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Someone joining is an UPDATE, not an insert: the member row already exists
  // (added by name or invited by email) and joining fills in its user_id. So
  // this is the one update worth notifying about, and only on the exact
  // transition from unlinked to linked.
  const isJoin = payload.table === "wallet_members"
    && payload.type === "UPDATE"
    && !payload.old_record?.user_id
    && !!payload.record.user_id;

  // Otherwise only new rows notify. Editing an expense shouldn't ping everyone
  // again: a notification per typo correction is how people learn to ignore them.
  if (!isJoin && payload.type !== "INSERT") {
    return new Response(JSON.stringify({ skipped: "not a notifiable change" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  // A plain insert into wallet_members is someone being ADDED to a wallet, not
  // joining it. The person doesn't have an account yet, so nobody needs telling.
  if (!isJoin && payload.table === "wallet_members") {
    return new Response(JSON.stringify({ skipped: "member added, not joined" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = await buildMessage(payload.table, payload.record);
  if (!message) {
    return new Response(JSON.stringify({ skipped: "nothing to say" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Everyone in the wallet except whoever caused this. For a join, the actor is
  // the person who just joined (they don't need telling about themselves);
  // for expenses and settlements it's whoever saved the row.
  const actor = (isJoin
    ? (payload.record.user_id as string)
    : (payload.record.created_by as string)) || "00000000-0000-0000-0000-000000000000";
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

  const result = await pushToTargets(targets as Target[], message);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});
