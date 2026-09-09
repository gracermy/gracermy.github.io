// Bloom statements: upload a bank/credit-card PDF, have the AI draft the
// numbers, review/correct, then apply into the current snapshot form.
//
// The AI output is ALWAYS a draft the user confirms. Nothing is written until
// the user clicks Apply. Depends on: supabase.js (FinanceDB), app.js exposes
// window.BloomStatements hooks it calls with the parsed draft.

const Statements = (() => {
  const db = window.FinanceDB;
  // Must match EXPENSE_CATS in app.js and CATEGORIES in the parse-statement
  // Edge Function, so a re-categorised line still maps to a real expense row.
  const CATEGORIES = ["rent", "food", "transport", "shopping", "travel", "entertainment", "fitness", "gift", "bills", "other"];

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

    // Turn the AI draft into month groups of individual spending LINES.
    // Preference order: explicit line items (transactions) -> the newer
    // monthly_breakdown / category_breakdown summaries (older drafts, which
    // carry no line detail, so each category becomes a single unnamed line).
    function buildMonths(d) {
      const MONTHS_IN = [];
      const groupFor = (year, month) => {
        const y = Number(year) || d.period_year || 0, m = Number(month) || d.period_month || 0;
        let g = MONTHS_IN.find((x) => x.year === y && x.month === m);
        if (!g) { g = { year: y, month: m, lines: [] }; MONTHS_IN.push(g); }
        return g;
      };

      // Preferred shape: monthly_breakdown categories each carrying their own
      // "lines". Those are already split by calendar month and converted to the
      // base currency by the Edge Function, so they need no further work.
      const mbLines = Array.isArray(d.monthly_breakdown)
        && d.monthly_breakdown.some((g) => (g.categories || []).some((c) => Array.isArray(c.lines) && c.lines.length));
      if (mbLines) {
        d.monthly_breakdown.forEach((g) => (g.categories || []).forEach((c, ci) => {
          const cat = c.category || "other";
          (c.lines || []).forEach((l, li) => {
            const amount = Math.max(0, Number(l.amount) || 0);
            if (!amount) return;
            groupFor(g.year, g.month).lines.push({
              _id: "m" + g.year + "-" + g.month + "-" + ci + "-" + li,
              date: l.date || null, time: l.time || null,
              description: l.description || "",
              amount, category: cat,
            });
          });
        }));
      } else if (Array.isArray(d.transactions) && d.transactions.length) {
        // Real line items. Self-transfers are dropped here (they're listed
        // separately above as transfers), everything else becomes a line.
        d.transactions.forEach((t, i) => {
          if (t.is_transfer) return;
          const amount = Math.max(0, Number(t.amount) || 0);
          if (!amount) return;
          const date = t.date || null;
          const [yy, mm] = date ? date.split("-") : [];
          groupFor(yy, mm).lines.push({
            _id: "t" + i,
            date, time: t.time || null,
            description: t.description || "",
            amount,
            category: t.category || "other",
          });
        });
      } else {
        // Legacy/summary drafts: no line detail exists, so a category total is
        // shown as one line with the category as its own reference name.
        const fromCats = (cats, year, month) => (cats || []).forEach((c, i) => {
          const amount = Math.max(0, Number(c.amount) || 0);
          if (!amount) return;
          groupFor(year, month).lines.push({
            _id: "c" + year + "-" + month + "-" + i,
            date: null, time: null,
            description: c.category || "other",
            amount,
            category: c.category || "other",
          });
        });
        if (Array.isArray(d.monthly_breakdown) && d.monthly_breakdown.length) {
          d.monthly_breakdown.forEach((g) => fromCats(g.categories, g.year, g.month));
        } else {
          fromCats(d.category_breakdown, d.period_year, d.period_month);
        }
      }

      // If the statement printed a stable spending total, scale the lines so
      // they add up to it: the AI's per-line figures are the breakdown, the
      // printed total is the authority.
      const rawTotal = MONTHS_IN.reduce((sum, g) => sum + g.lines.reduce((x, l) => x + l.amount, 0), 0);
      const stated = (d.spending_total != null && isFinite(d.spending_total) && Number(d.spending_total) >= 0)
        ? Number(d.spending_total) : null;
      if (stated != null && rawTotal > 0 && Math.abs(stated - rawTotal) > 1) {
        const factor = stated / rawTotal;
        MONTHS_IN.forEach((g) => g.lines.forEach((l) => { l.amount = l.amount * factor; }));
      }
      // Nothing itemised but a total is known: one "other" line in the closing month.
      if (!MONTHS_IN.length && stated > 0) {
        groupFor(d.period_year, d.period_month).lines.push({
          _id: "total", date: null, time: null, description: "Statement total", amount: stated, category: "other",
        });
      }

      MONTHS_IN.forEach((g) => g.lines.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.time || "").localeCompare(String(b.time || ""))));
      MONTHS_IN.sort((a, b) => (a.year - b.year) || (a.month - b.month));
      return MONTHS_IN;
    }

    // Group one month's surviving lines by category, in descending size, and
    // give each category the sum of its lines. Recomputed on every render so
    // deletes and category changes are reflected immediately.
    function categorise(mg) {
      const map = new Map();
      mg.lines.forEach((l) => {
        const key = (l.category || "other").trim() || "other";
        if (!map.has(key)) map.set(key, { category: key, amount: 0, lines: [] });
        const g = map.get(key);
        g.amount += l.amount;
        g.lines.push(l);
      });
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    }

    const monthTotal = (mg) => mg.lines.reduce((s, l) => s + l.amount, 0);
    const draftTotal = () => (draft._months || []).reduce((s, g) => s + monthTotal(g), 0);

    function renderReview() {
      reviewWrap.innerHTML = "";
      if (!draft) return;
      // Ensure arrays exist so delete/edit is uniform.
      draft.balances = draft.balances || [];
      draft.liabilities = draft.liabilities || [];
      draft.illiquid_balances = draft.illiquid_balances || [];
      // Build the per-CALENDAR-MONTH breakdown ONCE. Each month group holds the
      // individual statement LINES (date/time, reference name, amount), and the
      // categories are derived from those lines every render — so deleting a
      // line or moving it to another category updates the totals for free.
      // A cross-month statement (e.g. 5 Jun–4 Jul) yields two month groups.
      if (!draft._months) draft._months = buildMonths(draft);

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
        // The statement balance is what was owed on the statement's CLOSING
        // date, which is usually weeks before this snapshot. If the bill has
        // since been paid, that money has already left the bank account, so
        // keeping the old figure would count it twice.
        reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
          "This is the statement balance. Keep it as is; if you've already paid the bill, flip it to paid on the snapshot form so it isn't subtracted twice."));
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
      // Transfers between your own accounts are the main way spending gets
      // double-counted: money leaving a bank and arriving in a wallet appears
      // as a debit on one statement and a credit on the other. Showing them
      // makes the exclusion auditable instead of silent.
      const transfers = Array.isArray(draft.transfers) ? draft.transfers : [];
      const maybeTransfers = Array.isArray(draft.possible_transfers) ? draft.possible_transfers : [];
      if (transfers.length || maybeTransfers.length) {
        reviewWrap.append(groupHeader("Transfers (not counted as spending)"));
        reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
          "Money moved between your own accounts, so it isn't spending. Check the list: anything wrongly here means real spending is missing, and anything missing from it will be counted twice."));
        transfers.forEach((tr) => reviewWrap.append(transferRow(tr, false)));
        if (maybeTransfers.length) {
          reviewWrap.append(el("div", { class: "section-hint", style: "margin:8px 0 4px" },
            "These look like transfers but were counted as spending. If any is a transfer to your own account, delete it from the categories below."));
          maybeTransfers.forEach((tr) => reviewWrap.append(transferRow(tr, true)));
        }
      }

      const cur = curPeriod();
      if ((draft._months || []).length) {
        const crossMonth = draft._months.length > 1;
        reviewWrap.append(groupHeader(`Spending from this statement: ${Math.round(draftTotal()).toLocaleString()}`));
        if (crossMonth) {
          reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
            "This statement crosses months. Each month's spending is shown separately, and only the month you're adding now is applied. Come back to the other month to apply its part."));
        }
        reviewWrap.append(el("div", { class: "section-hint", style: "margin-top:0" },
          "Every line on the statement, grouped by category. Move a line to another category or delete it, and the totals follow."));
        draft._months.forEach((mg) => {
          const isCurrent = mg.year === cur.year && mg.month === cur.month;
          const label = `${MONTHS[(mg.month || 1) - 1]} ${mg.year} — ${Math.round(monthTotal(mg)).toLocaleString()}` + (isCurrent ? "  (this month, applied)" : "  (apply when you add this month)");
          reviewWrap.append(el("div", { style: `font-weight:600;margin:14px 0 4px;font-size:0.8rem;${isCurrent ? "color:var(--accent)" : "color:var(--text-muted)"}` }, label));
          const wrapMg = el("div", isCurrent ? {} : { style: "opacity:0.6" });
          categorise(mg).forEach((c) => {
            wrapMg.append(catHeader(c));
            c.lines.forEach((l) => wrapMg.append(lineRow(l, () => { arrRemove(mg.lines, l); renderReview(); })));
          });
          if (!mg.lines.length) wrapMg.append(el("div", { class: "section-hint", style: "margin-top:0" }, "No spending lines left in this month."));
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
      // The parsed figure is the statement balance and is kept as-is. Whether
      // it has been paid is set on the snapshot form's owed/paid switch, so
      // there is one place that decision lives.
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

    // A read-only transfer line. `suspect` marks one the AI kept as spending
    // but that looks like a self-transfer, so it needs a human decision.
    function transferRow(tr, suspect) {
      const amt = Math.round(Number(tr.amount) || 0).toLocaleString();
      return el("div", { class: "line-item", style: suspect ? "border-color:rgba(192,68,63,0.35)" : "" },
        el("span", { class: "li-name", style: "font-size:0.85rem" },
          tr.description || "(no description)",
          tr.date ? el("span", { class: "member-status" }, tr.date) : null),
        el("span", { class: "li-amt" }, amt),
        suspect ? el("span", { class: "tag", style: "background:rgba(192,68,63,0.12);color:var(--neg)" }, "check") : null);
    }

    // A category heading inside a month: the category name and the sum of the
    // lines under it. Not editable: the total is whatever its lines add up to,
    // so it can never disagree with the list beneath it.
    function catHeader(c) {
      return el("div", { class: "stmt-cat-head" },
        el("span", { class: "stmt-cat-name" }, c.category),
        el("span", { class: "stmt-cat-total" }, Math.round(c.amount).toLocaleString()));
    }

    // One statement line: date and time, the reference name as printed, and the
    // amount. The category dropdown moves it to another group; ✕ drops it.
    function lineRow(l, onDelete) {
      const when = [l.date || "", l.time || ""].filter(Boolean).join(" ");
      const catSel = el("select", { class: "stmt-line-cat" });
      // The app's own categories, plus whatever the AI came back with so an
      // unrecognised category is still selectable rather than silently reset.
      const cats = [...CATEGORIES];
      if (l.category && !cats.includes(l.category)) cats.unshift(l.category);
      cats.forEach((c) => catSel.append(el("option", { value: c, ...(c === l.category ? { selected: "" } : {}) }, c)));
      catSel.addEventListener("change", () => { l.category = catSel.value; renderReview(); });

      return el("div", { class: "line-item stmt-line" },
        el("span", { class: "stmt-line-when" }, when || "—"),
        el("span", { class: "stmt-line-ref", title: l.description }, l.description || "(no reference)"),
        el("span", { class: "stmt-line-amt" }, Math.round(l.amount).toLocaleString()),
        catSel,
        el("button", { class: "btn-icon", type: "button", title: "Remove this line", onClick: onDelete }, "✕"));
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
