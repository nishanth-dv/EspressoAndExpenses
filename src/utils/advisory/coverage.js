// Profile-coverage meter — "complete your profile to unlock more insights".
//
// Several advisory modules stay silent until the user supplies a light input
// (take-home pay, existing cover, goals, card reward rates). This computes a
// completeness checklist so the page can show what's filled in and — crucially —
// which insights each missing piece would switch on. Pure; derives from the
// merged profile + data, nothing persisted.

import { hasRewardInfo } from "./cardRewards";

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Each item: is it satisfied, and what does filling it unlock. `where` routes
// the fix — "profile" opens the Actions profile panel, "cards" → Solvency.
export function computeCoverage(data, profile) {
  const cards = data?.cards ?? [];
  const items = [
    {
      key: "income",
      label: "Monthly take-home",
      done: num(profile?.monthlyIncome) > 0,
      unlocks: "savings rate, EMI load, insurance & retirement gap",
      where: "profile",
    },
    {
      key: "tax",
      label: "Tax slab & regime",
      done: num(profile?.taxSlab) > 0,
      unlocks: "80C, NPS & best-regime advice",
      where: "profile",
    },
    {
      key: "term",
      label: "Term-life cover",
      done: `${profile?.termCover ?? ""}` !== "",
      unlocks: "life-cover gap check",
      where: "profile",
    },
    {
      key: "health",
      label: "Health cover",
      done: `${profile?.healthCover ?? ""}` !== "",
      unlocks: "health-cover adequacy check",
      where: "profile",
    },
    {
      key: "goals",
      label: "At least one goal",
      done: (profile?.goals?.length || 0) > 0,
      unlocks: "goal-based SIP targets",
      where: "profile",
    },
    {
      key: "rewards",
      label: "Card reward rates",
      done: cards.length === 0 || cards.some(hasRewardInfo),
      unlocks: "best-card routing & fee-vs-benefit",
      where: cards.length ? "cards" : null,
      hidden: cards.length === 0, // nothing to configure
    },
  ].filter((i) => !i.hidden);

  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const missing = items.filter((i) => !i.done);
  return { pct, done, total, items, missing };
}
