// Short, plain-English explainers shown behind a "Learn" toggle on each Action
// card — the "why does this matter" context, keyed by the card's category.

export const LEARN = {
  tax: {
    title: "Tax-saving, briefly",
    body: "Under the old regime you can shave taxable income with 80C (up to ₹1.5L via ELSS, PPF, EPF, life cover, home-loan principal), the extra ₹50k NPS deduction under 80CCD(1B), and health premiums under 80D. In equity, ₹1.25L of long-term gains are tax-free each year — booking them annually resets your cost base. Direct mutual-fund plans skip the ∼1%/yr commission that Regular plans carry.",
  },
  allocation: {
    title: "Why allocation matters",
    body: "Your split across equity, debt, gold and alternatives drives most of your long-run return and risk — more than picking individual funds. A target mix keeps you from being over-exposed when markets run, and rebalancing back to it quietly forces you to buy low and sell high. Redirect new SIPs into the lagging bucket before selling, to stay tax-efficient.",
  },
  cash: {
    title: "Making cash work",
    body: "Keep 3–6 months of expenses as an emergency buffer in a savings account or liquid fund. Cash beyond that is a drag — it barely beats inflation. For short-term parking, liquid or arbitrage funds usually beat savings-account interest post-tax; for longer horizons, debt funds or FDs. FD rates vary a lot between banks — shop around on renewal.",
  },
  goal: {
    title: "Funding a goal",
    body: "Work backwards: a target amount by a date, at an assumed return, tells you the monthly SIP needed. Longer goals (7y+) can lean equity for growth; near-term goals (under 3y) belong in debt so a market dip doesn't derail them. Step your SIP up with your income each year to arrive sooner.",
  },
  risk: {
    title: "Managing risk",
    body: "Risk isn't just market swings — it's concentration (too much in one holding), thin insurance, and high-interest debt. Cap any single holding near 20% of the portfolio, hold enough term + health cover, and clear expensive debt (cards, personal loans) before chasing returns. An emergency fund is your first line of defence.",
  },
  calendar: {
    title: "Maturities & renewals",
    body: "When an FD, bond or plan matures, decide ahead of time: renew at the best rate, redeploy to something better, or move it toward your target allocation. Money left idle after maturity quietly loses to inflation — set a reminder a couple of weeks before.",
  },
};

// A few cards want their own explainer rather than the generic category one —
// matched by id prefix, checked before the category fallback.
const BY_ID = [
  {
    match: (id) =>
      id.startsWith("card-best-") ||
      id.startsWith("card-fee-") ||
      id.startsWith("card-util-"),
    learn: {
      title: "Getting more from your cards",
      body: "Three levers. Keep utilisation under 30% of each limit — it lifts your credit score and clearing the balance avoids ∼36–42% p.a. interest. Put each category of spend on the card that rewards it best. And make sure any annual fee is out-earned by rewards, or waived by hitting its spend threshold. Always pay in full — interest wipes out rewards many times over — and watch for reward caps and excluded categories (fuel, rent and wallet loads often earn nothing).",
    },
  },
];

export function learnFor(card) {
  const hit = BY_ID.find((g) => g.match(card.id));
  if (hit) return hit.learn;
  return LEARN[card.category] || null;
}
