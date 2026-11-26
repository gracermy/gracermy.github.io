// Supabase Edge Function: advent-push
//
// Sends Our Advent Calendar's notifications. It never decides on its own what
// to send: it claims whatever is waiting in the advent_outbox queue (filled by
// the database trigger and the 10:00 / 22:00 jobs in advent/push-setup.sql)
// and sends that. Because of that it needs no secret — a stray call can only
// deliver notifications that were already due, once.
//
// Deploy:  npx supabase@latest functions deploy advent-push --no-verify-jwt
// Uses the VAPID_KEYS / VAPID_SUBJECT secrets Bloom's send-push already set.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import * as webpush from "jsr:@negrel/webpush@0.3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const VAPID_KEYS = Deno.env.get("VAPID_KEYS")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const APP_URL = "/advent/";

let serverPromise: Promise<webpush.ApplicationServer> | null = null;
function appServer() {
  serverPromise ??= (async () => webpush.ApplicationServer.new({
    contactInformation: VAPID_SUBJECT,
    vapidKeys: await webpush.importVapidKeys(JSON.parse(VAPID_KEYS), { extractable: false }),
  }))();
  return serverPromise;
}

type Person = "a" | "b";
type Message = { title: string; body: string; url: string; tag: string };
const other = (p: Person): Person => (p === "a" ? "b" : "a");

const TYPE_LABEL: Record<string, string> = {
  coupon: "💌 Love coupon day",
  question: "💭 Question day",
  spinner: "🎡 Date spinner day",
  memory: "📸 Memory day",
  challenge: "✨ Tiny challenge day",
};

async function kv(key: string) {
  const { data } = await db.from("advent_kv").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

// Names and day types come from rows the private content file loads
// (pool:people, pool:schedule), so this code holds nothing personal.
async function names(): Promise<Record<Person, string>> {
  const people = (await kv("pool:people")) as { id: Person; name: string }[] | null;
  const n = { a: "Your partner", b: "Your partner" } as Record<Person, string>;
  for (const p of people || []) n[p.id] = p.name;
  return n;
}

async function send(person: Person, msg: Message) {
  const { data: targets } = await db.from("advent_push").select("endpoint, p256dh, auth").eq("person", person);
  if (!targets?.length) return 0;
  const server = await appServer();
  const expired: string[] = [];
  let sent = 0;
  await Promise.all(targets.map(async (t) => {
    try {
      await server.subscribe({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } })
        .pushTextMessage(JSON.stringify(msg), {});
      sent++;
    } catch (e) {
      // 404/410: the phone threw this subscription away (app removed, iOS expiry).
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 410) expired.push(t.endpoint);
      else console.error("push failed", status, e);
    }
  }));
  if (expired.length) await db.from("advent_push").delete().in("endpoint", expired);
  return sent;
}

// One of you did something: tell the other.
async function onEvent(key: string, by: Person, n: Record<Person, string>) {
  const P = n[by];
  const used = key.match(/^wallet:used:day:(\d+):(coupon|spin)(?::([ab]))?$/);
  if (used) {
    const [, d, what, writer] = used;
    const to = what === "coupon" ? (writer as Person) : other(by);
    if (to === by) return 0;
    return send(to, {
      title: what === "coupon" ? `${P} used your coupon 💌` : `${P} cashed in a date 💚`,
      body: what === "coupon" ? `The one from day ${d}. Time to deliver!` : `The date from day ${d}'s spin.`,
      url: `${APP_URL}#wallet`, tag: key,
    });
  }
  const m = key.match(/^day:(\d+):(\w+)(?::([ab]))?$/);
  if (!m) return 0;
  const d = Number(m[1]), what = m[2];
  const url = `${APP_URL}#day-${d}`;
  const text: Record<string, [string, string]> = {
    coupon: [`${P} wrote you a love coupon 💌`, `It's sealed in door ${d}. Write yours to swap!`],
    answer: [`${P} answered today's question 💭`, `Answer yours to see what ${P} said.`],
    judge:  [`${P} marked your guess`, `Open door ${d} to see if you got it right.`],
    spin:   [`${P} spun the wheel 🎡`, `Your date from door ${d} is in the wallet.`],
    memory: [`${P} shared a memory 📸`, `Share yours in door ${d} to see it.`],
    done:   [`${P} finished the challenge ✨`, `Door ${d}: your turn!`],
  };
  if (!text[what]) return 0;
  // If the reader has already done their part, the nudge reads differently.
  const mineDone = await kv(`day:${d}:${what}:${other(by)}`);
  let [title, body] = text[what];
  if (mineDone && what === "answer") body = `Both answers are in. Open door ${d} to see them!`;
  if (mineDone && what === "memory") body = `Both photos are in. Open door ${d} to see them!`;
  if (mineDone && what === "coupon") body = `Open door ${d} to unseal it.`;
  if (mineDone && what === "done") body = `You both did it! 🎉`;
  return send(other(by), { title, body, url, tag: `day-${d}-${what}` });
}

async function dayType(d: number) {
  const schedule = (await kv("pool:schedule")) as string[] | null;
  return schedule?.[d - 1] || "";
}

async function onDaily(d: number) {
  const label = TYPE_LABEL[await dayType(d)] || "A new surprise";
  const msg = { title: `Door ${d} is open! 🎄`, body: `${label}. Go and open it together.`, url: `${APP_URL}#day-${d}`, tag: `daily-${d}` };
  return (await send("a", msg)) + (await send("b", msg));
}

async function onNudge(d: number, n: Record<Person, string>) {
  let sent = 0;
  for (const p of ["a", "b"] as Person[]) {
    if (await kv(`day:${d}:open:${p}`)) continue; // already opened today's door
    const partnerOpened = await kv(`day:${d}:open:${other(p)}`);
    sent += await send(p, {
      title: `You haven't opened door ${d} yet 👀`,
      body: partnerOpened ? `${n[other(p)]} already did. Don't keep them waiting!` : `There's still time before midnight.`,
      url: `${APP_URL}#day-${d}`, tag: `nudge-${d}`,
    });
  }
  return sent;
}

Deno.serve(async () => {
  const { data: rows, error } = await db.rpc("advent_claim");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!rows?.length) return new Response(JSON.stringify({ sent: 0 }));
  const n = await names();
  let sent = 0;
  for (const r of rows) {
    try {
      if (r.kind === "event") sent += await onEvent(r.payload.key, r.payload.by, n);
      if (r.kind === "daily") sent += await onDaily(r.payload.day);
      if (r.kind === "nudge") sent += await onNudge(r.payload.day, n);
    } catch (e) {
      console.error("row failed", r.id, e);
    }
  }
  return new Response(JSON.stringify({ processed: rows.length, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
