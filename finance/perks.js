// Bloom Perks — the cards and memberships you hold. Data layer, no DOM.
//
// The THIRD tracker, independent of the other two: it shares no math with the
// net-worth engine or the bill splitter and never appears on their screens.
//
// The hard problem here is naming. Hang Seng sells both an "enJoy Card" and an
// "enJoy Visa Platinum Card"; an "MPOWER Platinum" and an "MMPOWER World
// Mastercard" differ by one letter and are different products. Getting the
// product wrong means every benefit gathered against it is wrong. So typed
// names go through a resolver that PROPOSES and lets the user CONFIRM —
// never autocorrects, because a silent substitution is invisible when wrong.
//
// Depends on: supabase.js (window.FinanceDB).

const Perks = (() => {
  const sb = () => window.FinanceDB.getClient();

  // ── Reading ───────────────────────────────────────────
  async function loadCards() {
    const { data, error } = await sb()
      .from("perk_cards").select("*").order("sort_order").order("created_at");
    if (error) throw error;
    return data || [];
  }

  // Offers for the cards you hold. Phase 2 fills this table; until then it is
  // empty and every screen must read correctly with nothing in it.
  async function loadOffers() {
    const { data, error } = await sb()
      .from("perk_offers").select("*").order("merchant");
    if (error) throw error;
    return data || [];
  }

  // ── The resolver ──────────────────────────────────────
  // Sends what was typed, gets back candidates per entry. Never writes anything:
  // the user picks first. Throws with a readable message so the UI can show it.
  async function resolve(entries, kind) {
    const client = sb();
    const { data: sess } = await client.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const base = window.FinanceDB.functionsUrl();
    if (!base) throw new Error("App is not configured for name checking.");

    const resp = await fetch(base + "/resolve-cards", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "content-type": "application/json",
        "x-invite-passkey": window.FinanceDB.invitePasskey(),
      },
      body: JSON.stringify({ entries, kind }),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = out.error === "invalid_passkey" ? "Invite passkey rejected by the server."
        : out.error === "not_authenticated" ? "Please sign in again."
        : out.error === "claude_error" ? "The AI service returned an error. Check your Claude API key/credit."
        : out.detail || out.error || "Could not check those names.";
      throw new Error(msg);
    }
    return out.results || [];
  }

  // ── Gathering ─────────────────────────────────────────
  // Fetches current benefits for ONE card. The caller loops over cards so
  // progress can be shown and a single failure does not lose the whole run.
  async function gatherFor(card) {
    const client = sb();
    const { data: sess } = await client.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const base = window.FinanceDB.functionsUrl();
    if (!base) throw new Error("App is not configured for gathering.");

    const resp = await fetch(base + "/gather-perks", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "content-type": "application/json",
        "x-invite-passkey": window.FinanceDB.invitePasskey(),
      },
      body: JSON.stringify({
        name: card.name, issuer: card.issuer || "", tier: card.tier || "", kind: card.kind || "card",
      }),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = out.error === "invalid_passkey" ? "Invite passkey rejected by the server."
        : out.error === "not_authenticated" ? "Please sign in again."
        : out.error === "claude_error" ? "The AI service returned an error. Check your Claude API key/credit."
        : out.detail || out.error || "Could not gather perks.";
      throw new Error(msg);
    }
    return { offers: out.offers || [], notes: out.notes || null };
  }

  // Replace one card's offers with a freshly gathered set. Delete-then-insert
  // rather than merge: a benefit that has QUIETLY DISAPPEARED from the issuer's
  // page should vanish from your list too. Merging would preserve it forever,
  // which is exactly the stale-but-confident entry this feature must avoid.
  async function replaceOffers(cardId, offers) {
    const client = sb();
    const { error: delErr } = await client.from("perk_offers").delete().eq("card_id", cardId);
    if (delErr) throw delErr;
    const rows = (offers || [])
      .filter((o) => o && o.merchant && o.headline)
      .map((o) => ({
        card_id: cardId,
        merchant: String(o.merchant).trim(),
        headline: String(o.headline).trim(),
        detail: o.detail || null,
        requirements: o.requirements || null,
        tier: o.tier || null,
        starts_on: validDate(o.starts_on),
        ends_on: validDate(o.ends_on),
        source_url: o.source_url || null,
        gathered_at: new Date().toISOString(),
      }));
    if (!rows.length) return [];
    const { data, error } = await client.from("perk_offers").insert(rows).select();
    if (error) throw error;
    return data || [];
  }

  // The model may return "ongoing", "" or a malformed date; only a real
  // YYYY-MM-DD reaches a date column.
  function validDate(v) {
    if (!v || typeof v !== "string") return null;
    const m = v.trim().match(/^\d{4}-\d{2}-\d{2}$/);
    return m ? v.trim() : null;
  }

  // ── Searching ─────────────────────────────────────────
  // Searches WHAT WAS ALREADY GATHERED — no API call, no wait, no cost. This is
  // the whole point of gathering in bulk: looking something up at the till
  // should be instant.
  function search(offers, cards, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const byCard = {};
    (cards || []).forEach((c) => { byCard[c.id] = c; });
    return (offers || [])
      .map((o) => ({ offer: o, card: byCard[o.card_id] }))
      .filter(({ offer, card }) => {
        const hay = [
          offer.merchant, offer.headline, offer.detail, offer.requirements,
          card && card.name, card && card.issuer,
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      // Live offers first, then expired: an expired match is still worth
      // showing (it explains why you remembered a deal) but must never lead.
      .sort((a, b) => (isExpired(a.offer) ? 1 : 0) - (isExpired(b.offer) ? 1 : 0));
  }

  // ── Writing ───────────────────────────────────────────
  // `rows` are already-decided cards: either a candidate the user picked, or
  // an unverified fallback keeping exactly what they typed. Inserted in one go
  // so adding six cards is one confirmation, not six.
  async function addCards(rows) {
    if (!rows.length) return [];
    const { data, error } = await sb().from("perk_cards").insert(rows).select();
    if (error) throw error;
    return data || [];
  }

  async function updateCard(id, patch) {
    const { error } = await sb().from("perk_cards").update(patch).eq("id", id);
    if (error) throw error;
  }

  async function deleteCard(id) {
    // perk_offers cascades on card_id, so its rows go with it.
    const { error } = await sb().from("perk_cards").delete().eq("id", id);
    if (error) throw error;
  }

  // ── Helpers ───────────────────────────────────────────
  // How stale the gathered offers are. Phase 2 shows this prominently: an entry
  // that looks current but is months old is worse than no entry at all.
  function lastGathered(offers) {
    let newest = null;
    (offers || []).forEach((o) => {
      const t = o.gathered_at ? new Date(o.gathered_at) : null;
      if (t && (!newest || t > newest)) newest = t;
    });
    return newest;
  }

  function daysSince(date) {
    if (!date) return null;
    return Math.floor((Date.now() - date.getTime()) / 86400000);
  }

  // An offer whose end date has passed is shown as expired rather than removed,
  // so it is obvious WHY something vanished from the list.
  function isExpired(offer) {
    if (!offer || !offer.ends_on) return false;
    const end = new Date(offer.ends_on + "T23:59:59");
    return end.getTime() < Date.now();
  }

  // A card's display name, including tier when it changes what you get.
  function cardLabel(c) {
    if (!c) return "";
    return c.tier ? `${c.name} · ${c.tier}` : c.name;
  }

  return {
    loadCards, loadOffers, resolve,
    gatherFor, replaceOffers, search,
    addCards, updateCard, deleteCard,
    lastGathered, daysSince, isExpired, cardLabel,
  };
})();

window.Perks = Perks;
