# Where the Edge Functions actually live

**Deploy source: `/supabase/functions/<name>/index.ts` at the REPO ROOT.**
That is what `supabase functions deploy` reads, and it is the only copy that matters.

The files in `finance/setup/edge-functions/` are a **doc mirror** kept next to the
setup instructions. They once drifted a month behind the deployed function, which
would have silently reverted currency conversion, the `spending_total` formula and
the transfers audit if anyone had deployed from here.

If you edit a function: edit the root `supabase/functions/` copy, deploy, then copy
it here. Never deploy from this folder.
