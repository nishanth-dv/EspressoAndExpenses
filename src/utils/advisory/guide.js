// Concrete, step-by-step "how to actually do this" guides behind each card's
// "Do it" button — so a recommendation becomes a flow, not just a deep-link.
// Keyed by specific card id first, then falling back to the category.

const BY_CATEGORY = {
  tax: {
    title: "Use the deduction",
    steps: [
      "Pick the instrument — ELSS (equity, 3-yr lock-in), or PPF/NPS (debt, longer lock-in).",
      "Invest the shortfall before 31 March to claim it this financial year.",
      "For gains harvesting, sell to realise long-term gains within the ₹1.25L tax-free limit and re-buy the same day.",
    ],
  },
  allocation: {
    title: "Rebalance to target",
    steps: [
      "Compare each asset class to its target weight.",
      "Redirect new SIPs into the under-weight bucket first — the cheapest way to rebalance.",
      "Only sell from an over-weight bucket if the drift is large, and do it tax-aware.",
    ],
  },
  cash: {
    title: "Put the cash to work",
    steps: [
      "Keep 3–6 months of expenses as your buffer — don't touch that.",
      "Park the surplus in a liquid or arbitrage fund (better post-tax than savings for short horizons).",
      "For longer horizons, move it into your target allocation.",
    ],
  },
  goal: {
    title: "Set up the SIP",
    steps: [
      "Start a monthly SIP for the amount shown.",
      "Equity funds for goals 7+ years away; debt for goals under 3 years.",
      "Automate an annual step-up so it keeps pace with your income.",
    ],
  },
  risk: {
    title: "Reduce the risk",
    steps: [
      "Tackle the biggest exposure first — high-interest debt, thin insurance, or a concentrated holding.",
      "Build the emergency fund before locking money away.",
      "Revisit once the immediate gap is closed.",
    ],
  },
};

const BY_ID = [
  {
    match: (id) => id.startsWith("mf-direct-"),
    guide: {
      title: "Switch to the Direct plan",
      steps: [
        "Open your investment app or the AMC's own website.",
        "Find this fund and note its current value and units.",
        "Stop any SIP into the Regular plan.",
        "Search the exact same fund with “Direct” in the name and start a fresh SIP / invest there.",
        "Move the existing corpus only once you're past the exit-load window and mindful of LTCG — otherwise just redirect new money.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("fd-"),
    guide: {
      title: "Move the FD to a better rate",
      steps: [
        "Wait for maturity — breaking early usually costs a rate penalty.",
        "Compare 1-yr FD rates across banks and small-finance banks (often 0.5–1% higher).",
        "On maturity, don't auto-renew — book fresh at the best rate, or move to a debt fund for a longer horizon.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("conc-"),
    guide: {
      title: "Reduce the concentration",
      steps: [
        "Pick a target weight (∼20% of the portfolio is a common cap).",
        "Trim the excess — prefer redirecting new SIPs elsewhere over selling.",
        "If you must sell, book within your ₹1.25L tax-free LTCG limit where you can.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("lic-"),
    guide: {
      title: "Review the policy",
      steps: [
        "Ask the insurer for the policy's IRR, surrender value and paid-up value.",
        "Compare continuing vs making it paid-up and redirecting the premium.",
        "If switching, first buy a pure term cover, then invest the freed-up premium into an index fund.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("card-util-"),
    guide: {
      title: "Bring utilisation down",
      steps: [
        "Pay the statement in full before the due date to dodge ∼36–42% p.a. interest.",
        "If you can't clear it all, pay enough to get under 30% of the limit.",
        "Ask for a limit increase, or spread spends across cards, to lower the ratio.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("card-best-"),
    guide: {
      title: "Route this spend to the right card",
      steps: [
        "Set the higher-earning card as the default for this category (autopay, saved on the app/merchant).",
        "Watch for reward caps or category exclusions — split spend if a monthly cap kicks in.",
        "Keep paying every card in full so interest never eats the extra rewards.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("card-fee-"),
    guide: {
      title: "Make the fee pay for itself",
      steps: [
        "Check for a spend-based fee waiver and whether concentrating spend here reaches it.",
        "Weigh the annual fee against the rewards and perks you actually use.",
        "If it still doesn't add up, ask to downgrade to a no-fee variant (keeps your credit history) rather than closing it.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("subs-"),
    guide: {
      title: "Audit subscriptions",
      steps: [
        "Open the Subscriptions page and scan each one.",
        "Cancel anything you haven't used this month.",
        "For the rest, check annual plans (often 15–20% cheaper) and drop tiers you don't need.",
      ],
    },
  },
  {
    match: (id) => id.startsWith("debt-"),
    guide: {
      title: "Attack the debt",
      steps: [
        "List loans by interest rate, highest first (the avalanche method).",
        "Put every spare rupee toward the top one while paying minimums on the rest.",
        "Avoid new EMIs until your debt-to-income is comfortably under 40%.",
      ],
    },
  },
  {
    match: (id) => id === "insurance-term",
    guide: {
      title: "Get / top up term cover",
      steps: [
        "Aim for roughly 10–15× your annual income in pure term insurance.",
        "Buy online directly from the insurer (cheapest) — skip riders you don't need.",
        "Disclose everything honestly so a claim isn't rejected later.",
      ],
    },
  },
  {
    match: (id) => id === "insurance-health",
    guide: {
      title: "Get health cover",
      steps: [
        "Aim for at least a ₹5–10L family floater.",
        "Prefer no room-rent cap and a short pre-existing-disease waiting period.",
        "Buy while healthy — waiting periods and premiums only rise with age.",
      ],
    },
  },
];

export function guideFor(card) {
  const hit = BY_ID.find((g) => g.match(card.id));
  if (hit) return hit.guide;
  return BY_CATEGORY[card.category] || null;
}

// Step-by-step guide for a Review verdict. "Keep" has no action, so returns null.
const VERDICT_GUIDES = {
  watch: {
    title: "Keep an eye on it",
    steps: [
      "No urgent action — just monitor it.",
      "Refresh its price (or resume the SIP) so the numbers are current.",
      "If it keeps lagging over the next quarter, consider switching.",
    ],
  },
  trim: {
    title: "Trim the position",
    steps: [
      "Pick a target weight — around 20% of your portfolio is a common cap.",
      "Reduce the excess — prefer redirecting new SIPs elsewhere over selling.",
      "If you sell, book gains within your ₹1.25L tax-free LTCG limit where you can.",
    ],
  },
  switch: {
    title: "Switch to a better option",
    steps: [
      "Identify the cheaper/better alternative — a Direct plan, a low-cost index fund, or a higher-rate FD.",
      "Start putting new money into the alternative first.",
      "Move the existing corpus once you're past any exit load and mindful of LTCG.",
    ],
  },
  exit: {
    title: "Exit this holding",
    steps: [
      "Confirm why — persistent underperformance, high cost, or it no longer fits your plan.",
      "Redeem, minding exit load and LTCG (book within the ₹1.25L free limit where you can).",
      "Redeploy the proceeds into your target allocation.",
    ],
  },
};

export function verdictGuide(verdict) {
  return VERDICT_GUIDES[verdict] || null;
}
