// Credit-card reward maths shared by the advisory engine's card modules.
// A card may optionally carry: annualFee, feeWaiverSpend, rewardBase (a base
// value-back %), and rewardCategories ([{ category, rate }] bonus %). All are
// optional — a card with none of them simply earns nothing and is skipped by
// the reward-driven modules.

// Categories that don't earn rewards / aren't real card "spend" we'd optimise.
const NON_SPEND = new Set(["Repayment", "Investment"]);

// Effective reward rate (as a fraction, e.g. 0.05) for a card in a category:
// the category bonus if one is set, otherwise the card's base rate, else 0.
export function effectiveRate(card, category) {
  const list = card?.rewardCategories;
  if (Array.isArray(list)) {
    const hit = list.find((r) => r.category === category);
    if (hit && hit.rate != null && hit.rate !== "") {
      const r = parseFloat(hit.rate);
      if (Number.isFinite(r)) return r / 100;
    }
  }
  const base = parseFloat(card?.rewardBase);
  return Number.isFinite(base) ? base / 100 : 0;
}

// True if a card has any reward info worth reasoning about.
export function hasRewardInfo(card) {
  const base = parseFloat(card?.rewardBase);
  const hasBase = Number.isFinite(base) && base > 0;
  const hasCats =
    Array.isArray(card?.rewardCategories) &&
    card.rewardCategories.some((r) => parseFloat(r.rate) > 0);
  return hasBase || hasCats;
}

// Trailing-window card spend, split by category. Returns
// { [cardId]: { total, byCat: { [category]: amount } } } over the last `months`
// months, plus the annualisation factor used to project those to a year.
export function cardSpend(data, months = 3) {
  const txns = data?.transactions ?? [];
  const cutoff = Date.now() - months * 30 * 86_400_000;
  const byCard = {};
  for (const t of txns) {
    if (t.transactionType !== "expense" || !t.cardId) continue;
    const cat = t.category || "Other";
    if (NON_SPEND.has(cat)) continue;
    const when = new Date(t.date || t.createdAt).getTime();
    if (!(when >= cutoff)) continue;
    const amt = Math.abs(parseFloat(t.amount) || 0);
    if (!amt) continue;
    const rec = (byCard[t.cardId] ??= { total: 0, byCat: {} });
    rec.total += amt;
    rec.byCat[cat] = (rec.byCat[cat] || 0) + amt;
  }
  return { byCard, annualize: 12 / months };
}

// Estimated annual rewards a card earns given its own trailing spend split.
export function annualRewards(card, cardRec, annualize) {
  if (!cardRec) return 0;
  let sum = 0;
  for (const cat in cardRec.byCat) {
    sum += cardRec.byCat[cat] * annualize * effectiveRate(card, cat);
  }
  return sum;
}
