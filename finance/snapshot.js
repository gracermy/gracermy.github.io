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

  // Given one snapshot's fully-loaded rows, compute its components.
  // `illiquidCost` is passed in (cumulative, computed at a higher level).
  function computeSnapshot(snap, illiquidCost) {
    let liquid = 0, liabilities = 0, income = 0;
    for (const b of snap.balances || []) {
      const acctType = b._accountType;
      const v = toBase(b.amount, b.exchange_rate);
      if (acctType === "liability") liabilities += v;
      else liquid += v; // liquid accounts
    }
    for (const inc of snap.income || []) {
      income += toBase(inc.amount, inc.exchange_rate);
    }
    const netWorth = liquid + illiquidCost - liabilities;
    return { liquid, illiquidCost, liabilities, income, netWorth };
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
      const c = computeSnapshot(snap, illiquidCost);
      const deltaNW = prev ? c.netWorth - prev.netWorth : null;
      // Real expense = income − Δnet worth. Only meaningful when there's a prior point.
      const expense = deltaNW === null ? null : c.income - deltaNW;
      out.push({ snapshot: snap, ...c, deltaNW, expense });
      prev = c;
    }
    return out;
  }

  return { toBase, computeTimeline, computeSnapshot, illiquidCostUpTo };
})();

// Currency formatting
function fmt(n, currency) {
  if (n === null || n === undefined || !isFinite(n)) return "—";
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
window.MONTH_NAMES = MONTH_NAMES;
