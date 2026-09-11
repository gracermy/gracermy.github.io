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
    addCards, updateCard, deleteCard,
    lastGathered, daysSince, isExpired, cardLabel,
  };
})();

window.Perks = Perks;
