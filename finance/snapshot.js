// Financial model + data helpers.
// Core rule: value_in_base = amount * exchange_rate.
//   exchange_rate = how many units of BASE currency 1 unit of the line's
//   currency is worth. (Same currency as base => rate 1.)
//
// Net worth    = Σ liquid balances (base) + Σ illiquid-at-cost (base) − Σ liabilities (base)
// Real expense = total income (base) − Δ net worth  (vs previous snapshot)

const Model = (() => {

  function toBase(amount, rate) {
    const a = Number(amount) || 0;
    const r = Number(rate);
    return a * (isFinite(r) && r > 0 ? r : 1);
  }

  // Sum illiquid holdings AT COST from all moves up to and including a snapshot.
  // Illiquid net worth is cumulative: every 'in' adds, every 'out' subtracts,
  // across the whole history up to this snapshot's date.
  function illiquidCostUpTo(allMoves, snapshotDate) {
    let total = 0;
    for (const m of allMoves) {
      if (m._date <= snapshotDate) {
        const v = toBase(m.amount, m.exchange_rate);
        total += m.direction === "in" ? v : -v;
      }
    }
    return total;
  }

  // Per-account at-cost totals up to a date (for the market/cost fallback).
  function illiquidCostByAcctUpTo(allMoves, snapshotDate) {
    const byAcct = {};
    for (const m of allMoves) {
      if (m._date <= snapshotDate) {
        const v = toBase(m.amount, m.exchange_rate);
        byAcct[m.account_id] = (byAcct[m.account_id] || 0) + (m.direction === "in" ? v : -v);
      }
    }
    return byAcct;
  }

  // Given one snapshot's fully-loaded rows, compute its components.
  // `illiquidCost` is passed in (cumulative, computed at a higher level).
  function computeSnapshot(snap, illiquidCost) {
    let liquid = 0, liabilities = 0, income = 0, paidLiabilities = 0;
    for (const b of snap.balances || []) {
      const acctType = b._accountType;
      const v = toBase(b.amount, b.exchange_rate);
      if (acctType === "liability") {
        // A card marked paid keeps its statement balance on record (so you can
        // see what the bill was) but is NOT owed any more: that money already
        // left the bank account, so subtracting it too would count it twice.
        if (b.is_paid) paidLiabilities += v;
        else liabilities += v;
      }
      else liquid += v; // liquid accounts
    }
    for (const inc of snap.income || []) {
      income += toBase(inc.amount, inc.exchange_rate);
    }
    // Market value of illiquid accounts recorded this snapshot (informational).
    // For accounts with a recorded market value we use it; accounts without one
    // fall back to their at-cost contribution so the market total is complete.
    const marketByAcct = {};
    for (const m of snap.marketValues || []) {
      marketByAcct[m.account_id] = (marketByAcct[m.account_id] || 0) + toBase(m.amount, m.exchange_rate);
    }
    const hasMarket = Object.keys(marketByAcct).length > 0;
    // illiquidMarket = sum of recorded market values + at-cost for the rest.
    // costByAcct is the per-account at-cost (passed in via snap._illiquidCostByAcct).
    const costByAcct = snap._illiquidCostByAcct || {};
    let illiquidMarket = 0;
    const allIlliquidIds = new Set([...Object.keys(costByAcct), ...Object.keys(marketByAcct)]);
    for (const id of allIlliquidIds) {
      illiquidMarket += (id in marketByAcct) ? marketByAcct[id] : (costByAcct[id] || 0);
    }

    // `liabilities` counts only what is still OWED; paid-off cards are excluded
    // above. `paidLiabilities` is kept for display, so a settled bill can still
    // be shown without affecting any total.
    const netWorth = liquid + illiquidCost - liabilities;                 // at-cost (drives expense)
    const marketNetWorth = liquid + illiquidMarket - liabilities;         // market (informational)
    return { liquid, illiquidCost, illiquidMarket, hasMarket, liabilities, paidLiabilities, income, netWorth, marketNetWorth };
  }

  // Compute a full timeline: array of snapshots (ascending by date) each with
  // components + deltas + derived expense.
  // `snapshots` must each carry balances/income arrays and _date; `allMoves`
  // is every illiquid_move with _date + direction.
  function computeTimeline(snapshots, allMoves) {
    const ordered = [...snapshots].sort((a, b) => (a._date < b._date ? -1 : a._date > b._date ? 1 : 0));
    const out = [];
    let prev = null;
    for (const snap of ordered) {
      const illiquidCost = illiquidCostUpTo(allMoves, snap._date);
      snap._illiquidCostByAcct = illiquidCostByAcctUpTo(allMoves, snap._date);
      const c = computeSnapshot(snap, illiquidCost);
      const deltaNW = prev ? c.netWorth - prev.netWorth : null;
      // Real expense = income − Δnet worth. Only meaningful when there's a prior point.
      const expense = deltaNW === null ? null : c.income - deltaNW;
      out.push({ snapshot: snap, ...c, deltaNW, expense });
      prev = c;
    }
    return out;
  }

  return { toBase, computeTimeline, computeSnapshot, illiquidCostUpTo, illiquidCostByAcctUpTo };
})();

// ── Private mode ──────────────────────────────────────
// Hides every money figure behind dots so the app can be shown to someone
// without showing what you actually have. Deliberately enforced inside the two
// formatters rather than at each call site: every amount in the app already
// goes through fmt()/fmtSigned(), so masking here covers the dashboard, the
// tracker cards, the charts and every modal at once, and a figure added later
// is hidden automatically instead of leaking because someone forgot.
//
// This is PRIVACY, NOT SECURITY. The numbers are still in memory and in the
// network responses; it only stops someone reading them over your shoulder.
//
// Per device (localStorage), like the theme: hiding on your laptop while
// showing someone the app should not blank your phone.
const PRIVATE_KEY = "bloom-private";
function isPrivate() {
  try { return localStorage.getItem(PRIVATE_KEY) === "1"; } catch { return false; }
}
function setPrivate(on) {
  try { localStorage.setItem(PRIVATE_KEY, on ? "1" : "0"); } catch {}
  document.documentElement.classList.toggle("is-private", !!on);
}
// Mask that keeps the shape of a figure (a sign, some digits) without its
// value, so layout doesn't jump when you toggle.
function maskedAmount(n) {
  const neg = typeof n === "number" && isFinite(n) && n < 0;
  return (neg ? "−" : "") + "••••";
}

// Currency formatting
function fmt(n, currency) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  if (isPrivate()) return maskedAmount(n);
  const cur = currency || (window.FinanceDB && window.FinanceDB.baseCurrency()) || "HKD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: cur, maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return cur + " " + Math.round(n).toLocaleString();
  }
}
function fmtSigned(n, currency) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  // Keep the +/− so "grew" vs "fell" still reads, but hide the amount.
  if (isPrivate()) return (n < 0 ? "−" : "+") + "••••";
  const s = fmt(Math.abs(n), currency);
  return (n < 0 ? "−" : "+") + s.replace(/^[−-]/, "");
}

// Month/year helpers. Snapshots are identified by period_year + period_month.
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function periodLabel(year, month) { return MONTH_NAMES[(month || 1) - 1] + " " + year; }
// A sortable key for a period (YYYY-MM, first of month) used internally as _date.
function periodKey(year, month) { return String(year) + "-" + String(month).padStart(2, "0"); }
function fmtUpdated(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

window.Model = Model;
window.fmt = fmt;
window.fmtSigned = fmtSigned;
window.periodLabel = periodLabel;
window.periodKey = periodKey;
window.fmtUpdated = fmtUpdated;
window.isPrivate = isPrivate;
window.setPrivate = setPrivate;
// Reflect the saved choice on <html> immediately, so CSS that depends on it is
// correct on the very first paint rather than flashing the real figures.
try { document.documentElement.classList.toggle("is-private", isPrivate()); } catch {}
window.MONTH_NAMES = MONTH_NAMES;
