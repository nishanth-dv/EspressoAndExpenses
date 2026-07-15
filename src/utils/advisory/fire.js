// Financial-independence ("FIRE") progress.
//
// The number that generates your expenses indefinitely at a safe withdrawal
// rate, how far along you are, and — given how much you invest each month — how
// many years until you get there. Projection is done nominally, year by year:
// the target inflates with the cost of living and contributions keep pace, so a
// ~10% nominal return still has to out-run a ~6%-inflating goalpost. A rough,
// honest guide, not a promise.

const NOMINAL_RETURN = 0.1; // long-run blended portfolio return
const INFLATION = 0.06; // cost-of-living / target growth
const MAX_YEARS = 60;

// swr = safe withdrawal rate (0.04 → the "25×" rule).
export function computeFire({
  monthlyExpense = 0,
  corpus = 0,
  monthlyContribution = 0,
  currentAge = null,
  swr = 0.04,
} = {}) {
  const annualExpense = Math.max(0, monthlyExpense) * 12;
  if (annualExpense <= 0) return null; // no spending baseline → nothing to size

  const rate = swr > 0 ? swr : 0.04;
  const fireNumber = annualExpense / rate; // == annualExpense × (1/swr)
  const startCorpus = Math.max(0, corpus);
  const progress = fireNumber > 0 ? startCorpus / fireNumber : 0;

  // Year-by-year nominal projection against an inflating target.
  let c = startCorpus;
  let annualContribution = Math.max(0, monthlyContribution) * 12;
  let target = fireNumber;
  let yearsToFI = progress >= 1 ? 0 : null;
  if (yearsToFI == null) {
    for (let y = 1; y <= MAX_YEARS; y += 1) {
      c = c * (1 + NOMINAL_RETURN) + annualContribution;
      target *= 1 + INFLATION;
      annualContribution *= 1 + INFLATION; // contributions rise with income
      if (c >= target) {
        yearsToFI = y;
        break;
      }
    }
  }

  return {
    fireNumber,
    corpus: startCorpus,
    annualExpense,
    monthlyContribution: Math.max(0, monthlyContribution),
    swr: rate,
    multiple: Math.round(1 / rate),
    progress, // real ratio (may exceed 1)
    pct: Math.min(100, Math.round(progress * 100)),
    yearsToFI, // null = not reachable within MAX_YEARS at this pace
    fiAge:
      yearsToFI != null && currentAge != null ? currentAge + yearsToFI : null,
    reachable: yearsToFI != null,
  };
}
