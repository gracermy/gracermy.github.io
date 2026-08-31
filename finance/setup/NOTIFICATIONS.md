# Bloom notifications, setup

Get a notification when someone adds an expense, records a payment, or joins
a shared wallet, plus a weekly summary. Everything here runs on Supabase's
**free tier**.

There are six steps and they must be done in order. Budget about 25 minutes.

> **Before you start.** On iPhone, notifications only work if Bloom has been
> **added to the Home Screen**. Apple does not allow web push in a normal
> Safari tab. Android and desktop have no such restriction.

---

## 1. Create the database table

Supabase Dashboard → **SQL Editor** → New query. Paste and run
[`push-schema.sql`](push-schema.sql).

This creates `push_subscriptions` (one row per device) plus the functions that
find who to notify: everyone in a wallet *except* the person who caused the
change, and the weekly summary data.

## 2. Install the Supabase CLI

If you already did this for the statement-reading feature, skip ahead.

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

Your project ref is in the Supabase dashboard URL.

## 3. Set the secrets

Your VAPID keys are already generated and the public half is committed in
`config.js`. The **private** half must only ever live as a Supabase secret,
never in the repo.

```bash
# The full key pair (private half included), one line, in single quotes.
supabase secrets set VAPID_KEYS='PASTE_THE_VAPID_KEYS_JSON_HERE'

# Your email, so push services can contact you about delivery problems.
supabase secrets set VAPID_SUBJECT='mailto:you@example.com'

# A long random string, this is what stops anyone else invoking the function.
supabase secrets set PUSH_HOOK_SECRET="$(openssl rand -hex 32)"
```

Print the hook secret, because you need it in step 5:

```bash
supabase secrets list
```

> If you ever need to regenerate the VAPID keys, everyone has to turn
> notifications off and on again, existing subscriptions are tied to the old
> key and will silently stop working.

## 4. Deploy the function

```bash
supabase functions deploy send-push --no-verify-jwt
```

`--no-verify-jwt` is required: the caller is the database webhook, not a
logged-in user. The function isn't left open, though. It checks the
`PUSH_HOOK_SECRET` header and refuses anything else.

## 5. Create the webhooks

Three webhooks. In the dashboard: **Database → Webhooks → Create a new hook**.
All three share the same type, method, URL and header:

| Field | Value |
|---|---|
| Type | HTTP Request |
| Method | `POST` |
| URL | `https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-push` |
| HTTP Headers | `x-push-secret` : *your PUSH_HOOK_SECRET* |

They differ only in name, table and events:

| Name | Table | Events |
|---|---|---|
| `notify_expense` | `shared_expenses` | **Insert** |
| `notify_settlement` | `settlements` | **Insert** |
| `notify_join` | `wallet_members` | **Update** |

> Expenses and settlements fire on Insert only, deliberately. Firing on updates
> would send a notification for every small correction, and a notification
> people learn to ignore is worse than no notification at all.
>
> Joins use Update because that's what joining is: the member row already
> exists (you added them by name or invited them by email), and joining fills
> in their account. The function checks for exactly that transition, so
> renaming a member or adding an email to one does not notify anyone.

## 6. Schedule the weekly summary

In the dashboard: **SQL Editor**, then run this once. Replace both placeholders
with your project ref and your `PUSH_HOOK_SECRET`.

```sql
-- pg_cron and pg_net are already enabled on Supabase.
select cron.schedule(
  'bloom-weekly-summary',
  '0 10 * * 1',          -- Mondays at 10:00 UTC
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-push-secret', 'YOUR_PUSH_HOOK_SECRET'),
    body    := jsonb_build_object('job', 'weekly-summary')
  );
  $$
);
```

The cron time is in **UTC**. Hong Kong is UTC+8, so `0 10 * * 1` arrives Monday
6pm your time. Adjust the hour to taste.

To check or change it later:

```sql
select * from cron.job;                          -- see the schedule
select cron.unschedule('bloom-weekly-summary');  -- remove it
```

People with no activity that week get nothing, rather than a "you spent
nothing" notification.

---

## Turn it on

1. Open Bloom → **Expense Tracker**.
2. Under **Notifications**, tap **Turn on notifications** and allow when asked.
3. Repeat on every device you want alerts on, subscriptions are per device,
   not per person.

Test it by having someone else add an expense to a shared wallet. (You won't be
notified about your own, that's intentional.)

---

## If notifications don't arrive

**The option isn't shown at all**
`VAPID_PUBLIC_KEY` is missing from `config.js`, or you're on an iPhone and
Bloom isn't installed to the Home Screen. The card tells you which.

**"Notifications are blocked"**
The browser is refusing at the OS or browser level. Only the person on that
device can undo it in their browser's site settings, since Bloom cannot re-ask.

**Turned on, but nothing arrives**
Check in this order:

1. Is the *other* person's device subscribed? You never get notified about your
   own actions, so testing alone always looks broken.
2. Supabase → Edge Functions → `send-push` → **Logs**. A `403` means the
   webhook's `x-push-secret` header doesn't match the secret; a `500` shows
   the actual error.
3. Database → Webhooks → the hook's recent deliveries. No deliveries means the
   webhook isn't firing, check it's on **Insert** for the right table.

**They arrived, then stopped**
Push subscriptions expire, especially on iOS after long disuse. Turn
notifications off and on again on that device. The function prunes dead
subscriptions automatically when a push comes back `404`/`410`.

---

## What it costs

Nothing. Free-tier Edge Functions include 500,000 invocations a month; a
household splitting a few expenses a day uses a few hundred. The push services
themselves (Apple, Google, Mozilla) are free.
