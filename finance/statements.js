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
      body: JSON.stringify({ pdf_base64, base_currency: db.baseCurrency() }),
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
  // (possibly edited) draft when the user confirms. `accounts` = the user's
  // existing accounts. `curPeriod()` returns {year, month} of the month being
  // added, so cross-month statements can highlight/apply the right portion.
  function widget(onApply, accounts, curPeriod) {
    accounts = accounts || [];
    curPeriod = curPeriod || (() => ({ year: 0, month: 0 }));
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
      // Build per-CALENDAR-MONTH category breakdowns ONCE, scaled so the total
      // across all months equals the stable spending_total. A cross-month
      // statement (e.g. 5 Jun–4 Jul) yields two month groups.
      if (!draft._months) {
        // Gather raw month groups from monthly_breakdown (new) or fall back to a
        // single group from category_breakdown / transactions (legacy).
        let groups = [];
        if (Array.isArray(draft.monthly_breakdown) && draft.monthly_breakdown.length) {
          groups = draft.monthly_breakdown.map((g) => ({
            year: Number(g.year) || draft.period_year, month: Number(g.month) || draft.period_month,
            cats: (g.categories || []).map((c) => ({ category: c.category || "other", amount: Math.max(0, Number(c.amount) || 0) })),
          }));
        } else {
          let raw = (draft.category_breakdown || []).map((c) => ({ category: c.category || "other", amount: Math.max(0, Number(c.amount) || 0) }));
          if (raw.length === 0 && Array.isArray(draft.transactions)) {
            const byCat = {};
            draft.transactions.filter((t) => !t.is_transfer).forEach((t) => { byCat[t.category || "other"] = (byCat[t.category || "other"] || 0) + (Number(t.amount) || 0); });
            raw = Object.entries(byCat).map(([category, amount]) => ({ category, amount }));
          }
          groups = [{ year: draft.period_year, month: draft.period_month, cats: raw }];
        }
        const grandRaw = groups.reduce((s, g) => s + g.cats.reduce((x, c) => x + c.amount, 0), 0);
        draft._total = (draft.spending_total != null && isFinite(draft.spending_total) && draft.spending_total >= 0)
          ? Number(draft.spending_total) : (grandRaw || 0);
        // Scale every category by the same factor so all months sum to _total.
        const factor = grandRaw > 0 ? draft._total / grandRaw : 0;
        draft._months = groups.map((g) => {
          const cats = g.cats.map((c) => ({ category: c.category, amount: Math.round(c.amount * factor) })).sort((a, b) => b.amount - a.amount);
          return { year: g.year, month: g.month, categories: cats, total: cats.reduce((s, c) => s + c.amount, 0) };
        });
        // If nothing scaled but there's a total, put it all as "other" in the closing month.
        if (draft._months.length === 0 && draft._total > 0) {
          draft._months = [{ year: draft.period_year, month: draft.period_month, categories: [{ category: "other", amount: Math.round(draft._total) }], total: Math.round(draft._total) }];
        }
      }

      const kind = draft.statement_kind === "spending" ? "Spending statement (credit card)" : "Asset statement (bank)";
      reviewWrap.append(el("div", { class: "section-hint" },
        `Detected: ${kind}` + (draft.period_month && draft.period_year ? ` · ${draft.period_month}/${draft.period_year}` : "")));

      const groupHeader = (text, color) => el("div", { style: `font-weight:600;margin:10px 0 4px;font-size:0.85rem${color ? ";color:" + color : ""}` }, text);

      // Auto-match each drafted balance to an account (by name), once.
      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const autoMatch = (name, wantTypes) => {
        const key = norm(name); if (!key) return "";
        const pool = accounts.filter((a) => wantTypes.includes(a.type));
        let m = pool.find((a) => norm(a.name) === key);
        if (!m) m = pool.find((a) => { const an = norm(a.name); return an && (an.includes(key) || key.includes(an)); });
        return m ? m.id : "";
      };
      const initAssign = (list, wantTypes) => list.forEach((b) => { if (b._acct === undefined) b._acct = autoMatch(b.name, wantTypes); });
      initAssign(draft.balances, ["liquid"]);
      initAssign(draft.liabilities, ["liability"]);
      initAssign(draft.illiquid_balances, ["illiquid"]);

      // Balances (you own) → each assigns to a liquid account
      if (draft.balances.length) {
        reviewWrap.append(groupHeader("Balances (you own)"));
        draft.balances.forEach((b) => reviewWrap.append(balanceRow(b, ["liquid"], () => { arrRemove(draft.balances, b); renderReview(); })));
      }
      // Liabilities → liability account
      if (draft.liabilities.length) {
        reviewWrap.append(groupHeader("Liabilities (you owe)", "var(--neg)"));
        draft.liabilities.forEach((b) => reviewWrap.append(balanceRow(b, ["liability"], () => { arrRemove(draft.liabilities, b); renderReview(); })));
      }
      // Illiquid market values → illiquid account
      if (draft.illiquid_balances.length) {
        reviewWrap.append(groupHeader("Illiquid market value (info, fluctuates)"));
        reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" }, "Current market value (info only). Delete any you don't want."));
        draft.illiquid_balances.forEach((b) => reviewWrap.append(balanceRow(b, ["illiquid"], () => { arrRemove(draft.illiquid_balances, b); renderReview(); })));
      }
      // Spending from this statement: a real total (money that left, excl. self
      // transfers/income), split by category. Clear merchants labeled; the rest
      // → "other". Your MONTHLY total still comes from net-worth change; these
      // per-statement lines are the breakdown of where it went.
      // Spending split by calendar month. Only the CURRENT month's portion is
      // applied; other months are shown so you know to apply them separately.
      const MONTHS = window.MONTH_NAMES || ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const cur = curPeriod();
      if ((draft._months || []).length) {
        const crossMonth = draft._months.length > 1;
        reviewWrap.append(groupHeader(`Spending from this statement: ${Math.round(draft._total).toLocaleString()}`));
        if (crossMonth) {
          reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
            "This statement crosses months. Each month's spending is shown separately — only the month you're adding now is applied. Come back to the other month to apply its part."));
        } else {
          reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
            "Clear shops are labeled; transfers go to 'other'. Edit or delete any line."));
        }
        draft._months.forEach((mg) => {
          const isCurrent = mg.year === cur.year && mg.month === cur.month;
          const label = `${MONTHS[(mg.month || 1) - 1]} ${mg.year} — ${Math.round(mg.total).toLocaleString()}` + (isCurrent ? "  (this month → applied)" : "  (apply when you add this month)");
          reviewWrap.append(el("div", { style: `font-weight:600;margin:10px 0 4px;font-size:0.8rem;${isCurrent ? "color:var(--accent)" : "color:var(--text-muted)"}` }, label));
          const wrapMg = el("div", isCurrent ? {} : { style: "opacity:0.6" });
          mg.categories.forEach((c) => wrapMg.append(catRow(c, () => { arrRemove(mg.categories, c); renderReview(); })));
          reviewWrap.append(wrapMg);
        });
      }

      const applyBtn = el("button", { class: "btn", type: "button" }, "Apply to this month");
      applyBtn.addEventListener("click", () => onApply(draft));
      reviewWrap.append(el("div", { class: "btn-row", style: "margin-top:12px" }, applyBtn));
    }

    function arrRemove(arr, item) { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); }

    // A drafted balance row: editable name/amount/currency + an "account" dropdown
    // (existing accounts of the right type, or "+ new account"). The chosen target
    // is stored on the object as _acct ("" | account id | "__new__").
    function balanceRow(obj, wantTypes, onDelete) {
      const inputs = el("div", { class: "li-inputs" });
      // name + amount + currency
      ["name", "amount", "currency"].forEach((f) => {
        const inp = el("input", { value: obj[f] == null ? "" : obj[f], style: f === "name" ? "flex:2" : "max-width:90px" });
        if (f === "amount") inp.type = "number";
        inp.addEventListener("input", () => { obj[f] = f === "amount" ? Number(inp.value) : inp.value; });
        inputs.append(inp);
      });
      // account assignment dropdown
      const sel = el("select", { style: "max-width:150px" });
      const pool = accounts.filter((a) => wantTypes.includes(a.type));
      pool.forEach((a) => sel.append(el("option", { value: a.id, ...(obj._acct === a.id ? { selected: "" } : {}) }, a.name)));
      sel.append(el("option", { value: "__new__", ...(obj._acct === "__new__" ? { selected: "" } : {}) }, "+ new account"));
      if (obj._acct === "" ) { // no match: default to "+ new account" and flag it visually
        const opt = el("option", { value: "", selected: "" }, "— choose account —");
        sel.insertBefore(opt, sel.firstChild);
      }
      sel.addEventListener("change", () => { obj._acct = sel.value; });
      const wrap = el("div", { class: "line-item" }, inputs,
        el("span", { class: "muted", style: "font-size:0.72rem;align-self:center" }, "→"),
        sel,
        el("button", { class: "btn-icon", type: "button", title: "Remove", onClick: onDelete }, "✕"));
      // Highlight rows that still need a choice.
      if (!obj._acct) wrap.style.borderColor = "var(--accent)";
      return wrap;
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
