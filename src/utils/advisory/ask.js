// Advisory "Ask" — client half of the grounded Q&A layer.
//
// buildSnapshot() distils the user's data into a compact DERIVED summary: net
// worth, allocation, cash flow, FIRE, health and the top advisory actions — the
// same numbers the lenses already show. The raw transaction ledger, account
// numbers and card numbers never leave the device. askAdvisor() POSTs that
// snapshot + the question to the Worker, which forwards to the configured LLM.

import { getAccessToken } from "../googleDrive";
import { runAnalysis } from "./analysis";
import { runAdvisory } from "./engine";
import { computeFire } from "./fire";
import { mergeProfile, assetLabel } from "./profile";
import { isSuppressed } from "./state";

const API = import.meta.env.VITE_API_URL ?? "";

const round = (n) => Math.round(Number(n) || 0);

export function buildSnapshot(data = {}, market = {}) {
  const analysis = runAnalysis(data);
  const profile = mergeProfile(data, data.preferences?.advisoryProfile);
  const advState = data.preferences?.advisoryState;
  const { cards, moneyFound } = runAdvisory(
    data,
    profile,
    market,
    data.preferences?.advisoryFeedback,
  );
  const active = cards.filter((c) => !isSuppressed(advState, c.id)).slice(0, 8);

  const age = new Date().getFullYear() - profile.birthYear;
  const monthlyExpense = analysis.runway.monthlyExpense;
  const monthlyIncome = analysis.recurring.monthlyIncome;
  const fire = computeFire({
    monthlyExpense,
    corpus: analysis.netWorth.netWorth,
    monthlyContribution: Math.max(0, monthlyIncome - monthlyExpense),
    currentAge: age,
  });

  const invest = analysis.netWorth.assets
    .filter((a) => ["equity", "debt", "gold", "alt"].includes(a.cls))
    .map((a) => ({ class: assetLabel(a.cls), amount: round(a.amount) }));
  const investTotal = invest.reduce((s, a) => s + a.amount, 0);

  return {
    currency: "INR",
    asOf: new Date().toISOString().slice(0, 10),
    profile: {
      age,
      risk: profile.riskAppetite,
      taxSlabPct: round((profile.taxSlab || 0) * 100),
      taxRegime: profile.taxRegime,
      emergencyMonthsTarget: profile.emergencyMonths,
      dependents: Number(profile.dependents) || 0,
      goals: (profile.goals || []).map((g) => ({
        name: g.name,
        target: round(g.targetAmount),
        by: g.targetYear,
      })),
    },
    netWorth: round(analysis.netWorth.netWorth),
    grossAssets: round(analysis.netWorth.grossAssets),
    totalLiabilities: round(analysis.netWorth.totalLiab),
    cashOnHand: round(analysis.runway.cash),
    monthlyIncome: round(monthlyIncome),
    monthlyExpense: round(monthlyExpense),
    monthlySavings: round(Math.max(0, monthlyIncome - monthlyExpense)),
    cashRunwayMonths: analysis.runway.months != null ? Number(analysis.runway.months.toFixed(1)) : null,
    allocation: invest.map((a) => ({
      ...a,
      pct: investTotal > 0 ? round((a.amount / investTotal) * 100) : 0,
    })),
    thisMonth: {
      income: round(analysis.waterfall.income),
      spent: round(analysis.waterfall.expenses),
      invested: round(analysis.waterfall.investments),
      net: round(analysis.waterfall.netFlow),
    },
    topSpendingCategories: analysis.spending.byCategory
      .slice(0, 6)
      .map((r) => ({ category: r.label, amount: round(r.amount) })),
    financialIndependence: fire
      ? {
          targetCorpus: round(fire.fireNumber),
          progressPct: fire.pct,
          yearsAway: fire.reachable ? fire.yearsToFI : null,
        }
      : null,
    moneyOnTablePerYear: round(moneyFound),
    topActions: active.map((c) => ({
      title: c.title,
      impact: c.impactLabel,
      savingPerYear: round(c.saving),
      why: c.action,
    })),
  };
}

// Ask a question. Returns { answer }. Throws an Error whose `.code` is one of
// "not_configured" | "unauthorized" | "error" so the UI can react precisely.
export async function askAdvisor(question, snapshot, history = []) {
  const token = await getAccessToken();
  let res;
  try {
    res = await fetch(`${API}/advisory/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question, snapshot, history }),
    });
  } catch {
    const e = new Error("Couldn't reach the assistant.");
    e.code = "error";
    throw e;
  }
  if (res.status === 503) {
    const e = new Error("The assistant isn't configured yet.");
    e.code = "not_configured";
    throw e;
  }
  if (!res.ok) {
    const e = new Error(
      res.status === 401 ? "Session expired — sign in again." : "The assistant hit an error.",
    );
    e.code = res.status === 401 ? "unauthorized" : "error";
    throw e;
  }
  const body = await res.json().catch(() => ({}));
  if (!body.answer) {
    const e = new Error("No answer came back.");
    e.code = "error";
    throw e;
  }
  return { answer: body.answer };
}
