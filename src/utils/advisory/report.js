// One-tap advisory report — a shareable snapshot that composes the Understand
// analysis, the FIRE number, the health score and the top open actions into a
// single printable page + a plain-text summary for the clipboard. Pure: it just
// assembles what the lenses already compute, with no market fetch (rate-driven
// opportunity cards may be thinner offline — noted in the UI).

import { runAnalysis } from "./analysis";
import { runAdvisory } from "./engine";
import { computeFire } from "./fire";
import { mergeProfile, assetLabel } from "./profile";
import { isSuppressed } from "./state";
import { calcHealthScore, computeCardOutstanding } from "../solvencyUtils";

function healthOf(data) {
  const cards = data.cards ?? [];
  const commitments = data.commitments ?? [];
  const lendings = data.lendings ?? [];
  const txns = data.transactions ?? [];
  if (cards.length === 0 && commitments.length === 0 && lendings.length === 0)
    return null;
  const enriched = cards.map((c) => ({
    ...c,
    outstanding: computeCardOutstanding(c, txns, commitments),
  }));
  return calcHealthScore(
    enriched,
    commitments,
    lendings,
    data.preferences?.healthScore || {},
  );
}

export function buildReport(data = {}) {
  const analysis = runAnalysis(data);
  const profile = mergeProfile(data, data.preferences?.advisoryProfile);
  const advState = data.preferences?.advisoryState;
  const { cards, moneyFound } = runAdvisory(
    data,
    profile,
    {},
    data.preferences?.advisoryFeedback,
  );
  const actions = cards.filter((c) => !isSuppressed(advState, c.id)).slice(0, 6);

  const age = new Date().getFullYear() - profile.birthYear;
  const fire = computeFire({
    monthlyExpense: analysis.runway.monthlyExpense,
    corpus: analysis.netWorth.netWorth,
    monthlyContribution: Math.max(
      0,
      analysis.recurring.monthlyIncome - analysis.runway.monthlyExpense,
    ),
    currentAge: age,
  });

  const health = healthOf(data);
  const allocation = analysis.netWorth.assets
    .filter((a) => ["equity", "debt", "gold", "alt"].includes(a.cls))
    .map((a) => ({ label: assetLabel(a.cls), amount: a.amount }));
  const investTotal = allocation.reduce((s, a) => s + a.amount, 0);

  const generatedAt = new Date();
  const report = {
    generatedAt,
    dateLabel: generatedAt.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    netWorth: analysis.netWorth,
    waterfall: analysis.waterfall,
    runway: analysis.runway,
    allocation: allocation.map((a) => ({
      ...a,
      pct: investTotal > 0 ? a.amount / investTotal : 0,
    })),
    fire,
    health,
    actions,
    moneyFound,
    monthLabel: analysis.period.label,
  };
  return report;
}
