// Bloom statements: upload a bank/credit-card PDF, have the AI draft the
// numbers, review/correct, then apply into the current snapshot form.
//
// The AI output is ALWAYS a draft the user confirms. Nothing is written until
// the user clicks Apply. Depends on: supabase.js (FinanceDB), app.js exposes
// window.BloomStatements hooks it calls with the parsed draft.

const Statements = (() => {
  const db = window.FinanceDB;

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) { if (kid == null) continue; n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Call the Edge Function to parse a PDF. Returns the draft object or throws.
  async function parseStatement(file) {
    const sb = db.getClient();
    const { data: sess } = await sb.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const base = db.functionsUrl();
    if (!base) throw new Error("App is not configured for AI statements.");
    const pdf_base64 = await fileToBase64(file);
    const resp = await fetch(base + "/parse-statement", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "content-type": "application/json",
        "x-invite-passkey": db.invitePasskey(),
      },
      body: JSON.stringify({ pdf_base64 }),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = out.error === "invalid_passkey" ? "Invite passkey rejected by the server."
        : out.error === "not_authenticated" ? "Please sign in again."
        : out.error === "claude_error" ? "The AI service returned an error. Check your Claude API key/credit."
        : out.detail || out.error || "Could not read the statement.";
      throw new Error(msg);
    }
    return out.draft;
  }

  // Build the upload + review widget. `onApply(draft)` is called with the
  // (possibly edited) draft when the user confirms.
  function widget(onApply) {
    const fileIn = el("input", { type: "file", accept: "application/pdf" });
    const status = el("div", { class: "section-hint", style: "margin-top:8px" });
    const reviewWrap = el("div", {});
    const uploadBtn = el("button", { class: "btn btn-sm", type: "button" }, "Read statement");

    let draft = null;

    uploadBtn.addEventListener("click", async () => {
      reviewWrap.innerHTML = "";
      const file = fileIn.files && fileIn.files[0];
      if (!file) { status.textContent = "Choose a PDF first."; return; }
      status.textContent = "Reading… this takes a few seconds.";
      uploadBtn.disabled = true;
      try {
        // Call through the exposed object so it can be mocked in preview.
        draft = await window.BloomStatements.parseStatement(file);
        status.textContent = "Draft ready. Review below, correct anything, then Apply.";
        renderReview();
      } catch (e) {
        status.className = "error-msg";
        status.textContent = e.message || "Failed to read the statement.";
      } finally {
        uploadBtn.disabled = false;
      }
    });

    function renderReview() {
      reviewWrap.innerHTML = "";
      if (!draft) return;
      // Ensure arrays exist so delete/edit is uniform.
      draft.balances = draft.balances || [];
      draft.liabilities = draft.liabilities || [];
      draft.illiquid_balances = draft.illiquid_balances || [];
      // Build the category breakdown ONCE, SCALED to the stable spending_total.
      // The total comes from the statement's balances (opening + in − closing),
      // NOT from summing/labeling transactions — so it's stable on re-read.
      if (!draft._categories) {
        // The AI's raw category split (proportions only).
        let raw = (draft.category_breakdown || []).map((c) => ({ category: c.category || "other", amount: Math.max(0, Number(c.amount) || 0) }));
        // Fall back to old-style transactions if a legacy response comes back.
        if (raw.length === 0 && Array.isArray(draft.transactions)) {
          const byCat = {};
          draft.transactions.filter((t) => !t.is_transfer).forEach((t) => { byCat[t.category || "other"] = (byCat[t.category || "other"] || 0) + (Number(t.amount) || 0); });
          raw = Object.entries(byCat).map(([category, amount]) => ({ category, amount }));
        }
        const rawSum = raw.reduce((s, c) => s + c.amount, 0);
        // The authoritative total: the stable spending_total if present, else the raw sum.
        draft._total = (draft.spending_total != null && isFinite(draft.spending_total) && draft.spending_total >= 0)
          ? Number(draft.spending_total) : (rawSum || 0);
        // Scale each category so the breakdown sums exactly to _total.
        if (rawSum > 0) {
          draft._categories = raw.map((c) => ({ category: c.category, amount: Math.round(c.amount / rawSum * draft._total) }));
        } else if (draft._total > 0) {
          draft._categories = [{ category: "other", amount: Math.round(draft._total) }];
        } else {
          draft._categories = [];
        }
        draft._categories.sort((a, b) => b.amount - a.amount);
      }

      const kind = draft.statement_kind === "spending" ? "Spending statement (credit card)" : "Asset statement (bank)";
      reviewWrap.append(el("div", { class: "section-hint" },
        `Detected: ${kind}` + (draft.period_month && draft.period_year ? ` · ${draft.period_month}/${draft.period_year}` : "")));

      const groupHeader = (text, color) => el("div", { style: `font-weight:600;margin:10px 0 4px;font-size:0.85rem${color ? ";color:" + color : ""}` }, text);

      // Balances (you own)
      if (draft.balances.length) {
        reviewWrap.append(groupHeader("Balances (you own)"));
        draft.balances.forEach((b) => reviewWrap.append(reviewRow(b, ["name", "amount", "currency"], () => { arrRemove(draft.balances, b); renderReview(); })));
      }
      // Liabilities
      if (draft.liabilities.length) {
        reviewWrap.append(groupHeader("Liabilities (you owe)", "var(--neg)"));
        draft.liabilities.forEach((b) => reviewWrap.append(reviewRow(b, ["name", "amount", "currency"], () => { arrRemove(draft.liabilities, b); renderReview(); })));
      }
      // Illiquid market values (informational — market value that fluctuates)
      if (draft.illiquid_balances.length) {
        reviewWrap.append(groupHeader("Illiquid market value (info, fluctuates)"));
        reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" }, "This is the current market value, not your cost. It's shown separately and does not affect your derived expense. Delete any you don't want to record."));
        draft.illiquid_balances.forEach((b) => reviewWrap.append(reviewRow(b, ["name", "amount", "currency"], () => { arrRemove(draft.illiquid_balances, b); renderReview(); })));
      }
      // Spending: a STABLE total (from balances) + a category breakdown scaled to it.
      if (draft._total > 0 || draft._categories.length) {
        reviewWrap.append(groupHeader(`Spending this statement: ${Math.round(draft._total).toLocaleString()}`));
        reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
          "This total is the net drop in your balance (money in minus what's left), so transfers and cash you moved and moved back cancel out. The categories below are just a rough split of that total."));
        draft._categories.forEach((c) => reviewWrap.append(catRow(c, () => { arrRemove(draft._categories, c); renderReview(); })));
      }

      const applyBtn = el("button", { class: "btn", type: "button" }, "Apply to this month");
      applyBtn.addEventListener("click", () => onApply(draft));
      reviewWrap.append(el("div", { class: "btn-row", style: "margin-top:12px" }, applyBtn));
    }

    function arrRemove(arr, item) { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); }

    // Editable review row with a delete (✕) button. Binds edits back into `obj`.
    function reviewRow(obj, fields, onDelete) {
      const inputs = el("div", { class: "li-inputs" });
      fields.forEach((f) => {
        const inp = el("input", { value: obj[f] == null ? "" : obj[f], style: f === "name" ? "flex:2" : "" });
        if (f === "amount") inp.type = "number";
        inp.addEventListener("input", () => { obj[f] = f === "amount" ? Number(inp.value) : inp.value; });
        inputs.append(inp);
      });
      return el("div", { class: "line-item" }, inputs,
        el("button", { class: "btn-icon", type: "button", title: "Remove", onClick: onDelete }, "✕"));
    }

    // Editable spending-category row (rename category, edit amount, delete).
    function catRow(c, onDelete) {
      const nameIn = el("input", { value: c.category, style: "flex:2" });
      const amtIn = el("input", { type: "number", value: c.amount, style: "max-width:110px" });
      nameIn.addEventListener("input", () => { c.category = nameIn.value; });
      amtIn.addEventListener("input", () => { c.amount = Number(amtIn.value) || 0; });
      return el("div", { class: "line-item" },
        el("div", { class: "li-inputs" }, nameIn, amtIn),
        el("button", { class: "btn-icon", type: "button", title: "Remove", onClick: onDelete }, "✕"));
    }

    return el("div", { class: "shell", style: "margin-top:12px" },
      el("h3", {}, "Read a statement (AI draft)"),
      el("div", { class: "section-hint" }, "Upload a bank or credit-card PDF. The AI fills in a draft you can correct. Nothing is saved until you Apply."),
      fileIn,
      el("div", { class: "btn-row" }, uploadBtn),
      status, reviewWrap
    );
  }

  return { widget, parseStatement };
})();

window.BloomStatements = Statements;
