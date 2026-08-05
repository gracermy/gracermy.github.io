// Bloom charts: inline SVG, theme-aware, built from the computed timeline.
// Follows the dataviz method: thin marks, 2px surface gaps, direct labels,
// a legend for >=2 series, hover tooltips, recessive grid/axes.
//
// Palette roles pull from CSS vars set per theme in style.css (--series-*).
// Exposes window.Charts.render(container, timeline, currency).

const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    return n;
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Compact money for axis ticks / labels, e.g. 100,661 -> "101k"
  function compact(n) {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e3) return Math.round(n / 1e3) + "k";
    return String(Math.round(n));
  }

  function labelFor(t) { return (window.MONTH_NAMES[t.snapshot.period_month - 1] || "").slice(0, 3) + " " + String(t.snapshot.period_year).slice(2); }

  // Shared tooltip element (one per chart container)
  function makeTip(container) {
    const tip = document.createElement("div");
    tip.className = "chart-tip hidden";
    container.appendChild(tip);
    return tip;
  }

  // ── Net worth over time (single-series area+line) ──
  function netWorthChart(timeline, cur) {
    const W = 680, H = 240, padL = 44, padR = 16, padT = 16, padB = 28;
    const wrap = el("div", { class: "chart-card" });
    wrap.appendChild(el("h3", {}, "Net worth over time"));
    if (timeline.length < 2) { wrap.appendChild(el("div", { class: "chart-empty" }, "Add another month to see the trend.")); return wrap; }

    const box = el("div", { class: "chart-box" });
    const tip = makeTip(box);
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", preserveAspectRatio: "none", role: "img", "aria-label": "Net worth over time" });

    const vals = timeline.map((t) => t.netWorth);
    const min = Math.min(0, ...vals), max = Math.max(...vals);
    const x = (i) => padL + (timeline.length === 1 ? 0 : i * (W - padL - padR) / (timeline.length - 1));
    const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / (max - min || 1));

    // gridlines + y ticks (recessive)
    const ticks = 4;
    for (let g = 0; g <= ticks; g++) {
      const v = min + (max - min) * g / ticks, yy = y(v);
      s.appendChild(svg("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: "var(--chart-grid)", "stroke-width": 1 }));
      const tk = svg("text", { x: padL - 6, y: yy + 3, "text-anchor": "end", class: "chart-tick" }); tk.textContent = compact(v); s.appendChild(tk);
    }
    // area
    let dArea = `M ${x(0)} ${y(min)}`;
    timeline.forEach((t, i) => { dArea += ` L ${x(i)} ${y(t.netWorth)}`; });
    dArea += ` L ${x(timeline.length - 1)} ${y(min)} Z`;
    s.appendChild(svg("path", { d: dArea, fill: "var(--series-accent)", "fill-opacity": 0.12, stroke: "none" }));
    // line (2px)
    let dLine = "";
    timeline.forEach((t, i) => { dLine += (i ? " L" : "M") + ` ${x(i)} ${y(t.netWorth)}`; });
    s.appendChild(svg("path", { d: dLine, fill: "none", stroke: "var(--series-accent)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

    // x labels (first, last, and a middle one if room)
    const showIdx = timeline.length <= 6 ? timeline.map((_, i) => i) : [0, Math.floor((timeline.length - 1) / 2), timeline.length - 1];
    showIdx.forEach((i) => { const tx = svg("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "chart-tick" }); tx.textContent = labelFor(timeline[i]); s.appendChild(tx); });

    // markers + hover
    const crosshair = svg("line", { x1: 0, x2: 0, y1: padT, y2: H - padB, stroke: "var(--chart-axis)", "stroke-width": 1, class: "hidden" });
    s.appendChild(crosshair);
    timeline.forEach((t, i) => {
      const dot = svg("circle", { cx: x(i), cy: y(t.netWorth), r: 4, fill: "var(--chart-surface)", stroke: "var(--series-accent)", "stroke-width": 2 });
      s.appendChild(dot);
      const hit = svg("rect", { x: x(i) - 18, y: padT, width: 36, height: H - padT - padB, fill: "transparent", style: "cursor:pointer" });
      hit.addEventListener("mouseenter", () => {
        crosshair.setAttribute("x1", x(i)); crosshair.setAttribute("x2", x(i)); crosshair.classList.remove("hidden");
        dot.setAttribute("r", 6);
        tip.innerHTML = `<strong>${labelFor(timeline[i]).replace(/(\d\d)$/, "20$1")}</strong><br>Net worth ${fmt(t.netWorth, cur)}` +
          (t.deltaNW == null ? "" : `<br>Growth ${fmtSigned(t.deltaNW, cur)}`);
        tip.classList.remove("hidden");
        const px = x(i) / W * box.clientWidth, py = y(t.netWorth) / H * box.clientHeight;
        tip.style.left = Math.min(Math.max(px, 60), box.clientWidth - 60) + "px";
        tip.style.top = Math.max(py - 10, 8) + "px";
      });
      hit.addEventListener("mouseleave", () => { crosshair.classList.add("hidden"); dot.setAttribute("r", 4); tip.classList.add("hidden"); });
      s.appendChild(hit);
    });

    box.appendChild(s);
    wrap.appendChild(box);
    return wrap;
  }

  // ── Income vs Expense per month (grouped bars) ──
  function incomeExpenseChart(timeline, cur) {
    const pts = timeline.filter((t) => t.expense !== null); // need a prior month for expense
    const wrap = el("div", { class: "chart-card" });
    wrap.appendChild(el("h3", {}, "Income vs expense"));
    wrap.appendChild(legend([["Income", "var(--series-income)"], ["Expense", "var(--series-expense)"]]));
    if (pts.length === 0) { wrap.appendChild(el("div", { class: "chart-empty" }, "Add a second month to compare income and expense.")); return wrap; }

    const W = 680, H = 220, padL = 44, padR = 12, padT = 12, padB = 28;
    const box = el("div", { class: "chart-box" });
    const tip = makeTip(box);
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", preserveAspectRatio: "none", role: "img", "aria-label": "Income versus expense per month" });
    const max = Math.max(1, ...pts.map((t) => Math.max(t.income, t.expense)));
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const groupW = (W - padL - padR) / pts.length;
    const barW = Math.min(22, groupW / 2 - 4);

    const ticks = 3;
    for (let g = 0; g <= ticks; g++) { const v = max * g / ticks, yy = y(v); s.appendChild(svg("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: "var(--chart-grid)", "stroke-width": 1 })); const tk = svg("text", { x: padL - 6, y: yy + 3, "text-anchor": "end", class: "chart-tick" }); tk.textContent = compact(v); s.appendChild(tk); }

    pts.forEach((t, i) => {
      const gx = padL + i * groupW + groupW / 2;
      const bars = [["income", t.income, "var(--series-income)", -barW - 1], ["expense", t.expense, "var(--series-expense)", 1]];
      bars.forEach(([name, v, color, off]) => {
        const bx = gx + off, by = y(v), bh = (H - padB) - by;
        const r = svg("rect", { x: bx, y: by, width: barW, height: Math.max(bh, 0), rx: 3, fill: color });
        r.addEventListener("mouseenter", () => {
          tip.innerHTML = `<strong>${labelFor(t).replace(/(\d\d)$/, "20$1")}</strong><br>${name === "income" ? "Income" : "Expense"} ${fmt(v, cur)}`;
          tip.classList.remove("hidden");
          tip.style.left = Math.min(Math.max(gx / W * box.clientWidth, 60), box.clientWidth - 60) + "px";
          tip.style.top = Math.max(by / H * box.clientHeight - 10, 8) + "px";
        });
        r.addEventListener("mouseleave", () => tip.classList.add("hidden"));
        s.appendChild(r);
      });
      const tx = svg("text", { x: gx, y: H - 8, "text-anchor": "middle", class: "chart-tick" }); tx.textContent = labelFor(t); s.appendChild(tx);
    });

    box.appendChild(s); wrap.appendChild(box); return wrap;
  }

  // ── Asset composition (stacked bars: liquid / illiquid / liabilities) ──
  function compositionChart(timeline, cur) {
    const wrap = el("div", { class: "chart-card" });
    wrap.appendChild(el("h3", {}, "What you're made of"));
    wrap.appendChild(legend([["Liquid", "var(--series-1)"], ["Illiquid", "var(--series-2)"], ["Liabilities", "var(--series-3)"]]));
    if (timeline.length === 0) { wrap.appendChild(el("div", { class: "chart-empty" }, "No data yet.")); return wrap; }

    const W = 680, H = 220, padL = 44, padR = 12, padT = 12, padB = 28;
    const box = el("div", { class: "chart-box" });
    const tip = makeTip(box);
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", preserveAspectRatio: "none", role: "img", "aria-label": "Asset composition per month" });
    // scale spans from most-negative (liabilities) to max positive stack
    const tops = timeline.map((t) => t.liquid + t.illiquidCost);
    const bots = timeline.map((t) => -t.liabilities);
    const max = Math.max(1, ...tops), min = Math.min(0, ...bots);
    const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / (max - min || 1));
    const groupW = (W - padL - padR) / timeline.length;
    const barW = Math.min(30, groupW - 10);

    // zero line
    s.appendChild(svg("line", { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: "var(--chart-axis)", "stroke-width": 1 }));

    timeline.forEach((t, i) => {
      const gx = padL + i * groupW + groupW / 2 - barW / 2;
      // positive stack: liquid then illiquid (2px gap between via inset)
      const segs = [
        ["Liquid", t.liquid, "var(--series-1)", 0, t.liquid],
        ["Illiquid", t.illiquidCost, "var(--series-2)", t.liquid, t.liquid + t.illiquidCost],
      ];
      segs.forEach(([name, v, color, from, to]) => {
        if (v <= 0) return;
        const yTop = y(to), yBot = y(from);
        const r = svg("rect", { x: gx, y: yTop, width: barW, height: Math.max(yBot - yTop - 2, 0), rx: 2, fill: color });
        r.addEventListener("mouseenter", () => showTip(tip, box, gx + barW / 2, yTop, W, H, `<strong>${labelFor(t).replace(/(\d\d)$/, "20$1")}</strong><br>${name} ${fmt(v, cur)}`));
        r.addEventListener("mouseleave", () => tip.classList.add("hidden"));
        s.appendChild(r);
      });
      // liabilities (below zero)
      if (t.liabilities > 0) {
        const yTop = y(0), yBot = y(-t.liabilities);
        const r = svg("rect", { x: gx, y: yTop + 1, width: barW, height: Math.max(yBot - yTop - 1, 0), rx: 2, fill: "var(--series-3)" });
        r.addEventListener("mouseenter", () => showTip(tip, box, gx + barW / 2, yBot, W, H, `<strong>${labelFor(t).replace(/(\d\d)$/, "20$1")}</strong><br>Liabilities ${fmt(t.liabilities, cur)}`));
        r.addEventListener("mouseleave", () => tip.classList.add("hidden"));
        s.appendChild(r);
      }
      const tx = svg("text", { x: gx + barW / 2, y: H - 8, "text-anchor": "middle", class: "chart-tick" }); tx.textContent = labelFor(t); s.appendChild(tx);
    });

    box.appendChild(s); wrap.appendChild(box); return wrap;
  }

  function showTip(tip, box, sx, sy, W, H, html) {
    tip.innerHTML = html; tip.classList.remove("hidden");
    tip.style.left = Math.min(Math.max(sx / W * box.clientWidth, 60), box.clientWidth - 60) + "px";
    tip.style.top = Math.max(sy / H * box.clientHeight - 10, 8) + "px";
  }

  function legend(items) {
    const l = el("div", { class: "chart-legend" });
    items.forEach(([name, color]) => l.appendChild(el("span", { class: "chart-legend-item" },
      el("span", { class: "chart-swatch", style: `background:${color}` }), name)));
    return l;
  }

  // small el() shim (charts.js may load before app.js's el; define our own)
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === "class") n.className = v; else if (k === "style") n.setAttribute("style", v); else if (v != null) n.setAttribute(k, v); }
    for (const kid of kids.flat()) { if (kid == null) continue; n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  }

  function render(container, timeline, cur) {
    container.innerHTML = "";
    container.appendChild(netWorthChart(timeline, cur));
    container.appendChild(incomeExpenseChart(timeline, cur));
    container.appendChild(compositionChart(timeline, cur));
  }

  return { render };
})();

window.Charts = Charts;
