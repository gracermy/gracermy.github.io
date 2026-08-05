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
      const kind = draft.statement_kind === "spending" ? "Spending statement (credit card)" : "Asset statement (bank)";
      reviewWrap.append(el("div", { class: "section-hint" },
        `Detected: ${kind}` + (draft.period_month && draft.period_year ? ` · ${draft.period_month}/${draft.period_year}` : "")));

      // Balances
      if ((draft.balances || []).length) {
        reviewWrap.append(el("div", { style: "font-weight:600;margin:10px 0 4px;font-size:0.85rem" }, "Balances (you own)"));
        draft.balances.forEach((b) => reviewWrap.append(reviewRow(b, ["name", "amount", "currency"])));
      }
      // Liabilities
      if ((draft.liabilities || []).length) {
        reviewWrap.append(el("div", { style: "font-weight:600;margin:10px 0 4px;font-size:0.85rem;color:var(--neg)" }, "Liabilities (you owe)"));
        draft.liabilities.forEach((b) => reviewWrap.append(reviewRow(b, ["name", "amount", "currency"])));
      }
      // Illiquid (informational)
      if ((draft.illiquid_balances || []).length) {
        reviewWrap.append(el("div", { style: "font-weight:600;margin:10px 0 4px;font-size:0.85rem" }, "Illiquid balances (info)"));
        draft.illiquid_balances.forEach((b) => reviewWrap.append(reviewRow(b, ["name", "amount", "currency"])));
      }
      // Transactions summary (spending)
      const txns = draft.transactions || [];
      if (txns.length) {
        const spend = txns.filter((t) => !t.is_transfer);
        const byCat = {};
        spend.forEach((t) => { byCat[t.category || "other"] = (byCat[t.category || "other"] || 0) + (Number(t.amount) || 0); });
        reviewWrap.append(el("div", { style: "font-weight:600;margin:12px 0 4px;font-size:0.85rem" },
          `Spending by category (${spend.length} items, ${txns.length - spend.length} transfers excluded)`));
        Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
          reviewWrap.append(el("div", { class: "line-item" },
            el("span", { class: "li-name" }, cat),
            el("span", { class: "li-amt" }, Math.round(amt).toLocaleString())));
        });
      }

      const applyBtn = el("button", { class: "btn", type: "button" }, "Apply to this month");
      applyBtn.addEventListener("click", () => onApply(draft));
      reviewWrap.append(el("div", { class: "btn-row", style: "margin-top:12px" }, applyBtn));
    }

    // Editable review row (bind edits back into the draft object).
    function reviewRow(obj, fields) {
      const row = el("div", { class: "line-item" });
      const inputs = el("div", { class: "li-inputs" });
      fields.forEach((f) => {
        const inp = el("input", { value: obj[f] == null ? "" : obj[f], style: f === "name" ? "flex:2" : "" });
        if (f === "amount") inp.type = "number";
        inp.addEventListener("input", () => { obj[f] = f === "amount" ? Number(inp.value) : inp.value; });
        inputs.append(inp);
      });
      row.append(inputs);
      return row;
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
