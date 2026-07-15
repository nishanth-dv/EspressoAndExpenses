import {
  annualCost,
  trialStatus,
  detectAnomaly,
  isBilling,
  isRecurring,
} from "./subscriptionUtils";

const INR0 = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Ranked, actionable insight cards built from the user's OWN subscription +
// transaction data. Pure. Honesty: "ghost" is framed as "no charge matched",
// never a usage claim (there is no usage signal to assert).
export function subscriptionInsights(
  subscriptions = [],
  transactions = [],
  now = new Date(),
) {
  const out = [];

  // 1. Trials about to convert into a real charge (surprise-charge guard).
  for (const s of subscriptions) {
    const t = trialStatus(s, now);
    if (t && t.days != null && t.days >= 0) {
      out.push({
        id: `trial-${s.id}`,
        kind: "trial",
        weight: t.soon ? 100 : 70,
        icon: "fa-hourglass-half",
        title: `${s.name} trial ends ${
          t.days === 0 ? "today" : t.days === 1 ? "tomorrow" : `in ${t.days}d`
        }`,
        detail: `Then ${INR0(t.firstCharge)} — cancel before to avoid it.`,
      });
    }
  }

  // 2 & 3. Price hikes + ghost (expected-but-unlogged) charges.
  for (const s of subscriptions) {
    for (const a of detectAnomaly(s, transactions, now)) {
      if (a.kind === "hike") {
        out.push({
          id: `hike-${s.id}`,
          kind: "hike",
          weight: 60,
          icon: "fa-arrow-trend-up",
          title: `${s.name} got pricier`,
          detail: a.message,
        });
      } else if (a.kind === "ghost") {
        out.push({
          id: `ghost-${s.id}`,
          kind: "ghost",
          weight: 50,
          icon: "fa-ghost",
          title: `${s.name}: no charge matched`,
          detail: "Expected a renewal but none was logged — paused, or worth a check.",
        });
      }
    }
  }

  // 4. Duplicate categories — 2+ active recurring subs in one category.
  const byCat = new Map();
  for (const s of subscriptions) {
    if (!isBilling(s) || !isRecurring(s)) continue;
    const cat = (s.category || "").trim();
    if (!cat) continue;
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  for (const [cat, list] of byCat) {
    if (list.length >= 2) {
      const yr = list.reduce((sum, s) => sum + annualCost(s), 0);
      out.push({
        id: `dup-${cat}`,
        kind: "dup",
        weight: 45,
        icon: "fa-layer-group",
        title: `${list.length} ${cat} subscriptions`,
        detail: `${INR0(yr)}/yr combined — keep the one you actually use?`,
      });
    }
  }

  // 5. Biggest bleeder — the priciest active recurring sub (cancel-and-save).
  const billing = subscriptions.filter((s) => isBilling(s) && isRecurring(s));
  if (billing.length) {
    const top = billing.reduce((a, b) =>
      annualCost(b) > annualCost(a) ? b : a,
    );
    out.push({
      id: `bleeder-${top.id}`,
      kind: "save",
      weight: 40,
      icon: "fa-scissors",
      title: `${top.name} is your priciest`,
      detail: `Cancelling would save ${INR0(annualCost(top))}/yr.`,
    });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
