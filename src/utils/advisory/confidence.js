// Transparent, factor-weighted confidence. The score and the plain-English
// explanation are both derived deterministically from the same factors — no
// LLM, no cost, and it can't invent a number.

export function score({
  kind = "fact",
  signalStrength = 0.5,
  freshnessDays = 0,
  fit = null,
  reliability = null,
}) {
  let base = kind === "rule" ? 90 : kind === "fact" ? 85 : 55;
  let s = base + signalStrength * 10 - Math.min(20, freshnessDays * 0.5);
  if (fit != null) s += fit * 5;
  if (reliability != null) s = s * 0.6 + reliability * 40;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// High / Moderate / Low band for a 0–100 score.
export function band(s) {
  if (s >= 80) return "high";
  if (s >= 55) return "moderate";
  return "low";
}

// CSS modifier for the shared confidence badge, so every tab colours it the same.
export function confClass(s) {
  if (s >= 80) return "adv-conf--high";
  if (s >= 55) return "adv-conf--mid";
  return "adv-conf--low";
}

// What the number actually means — shown at the foot of every breakdown.
export const CONFIDENCE_MEANING =
  "Confidence measures how sure we are the suggestion is worth your attention — how strong, current and rule-based the signal is — not a prediction of the market.";

// A transparent, line-by-line breakdown of how the score was reached, using the
// exact same factors as score(). Rows are reconciled to sum to the final score
// so the arithmetic the user sees always adds up to the number on the badge.
export function breakdown(factors = {}) {
  const {
    kind = "fact",
    signalStrength = 0.5,
    freshnessDays = 0,
    fit = null,
    reliability = null,
  } = factors;

  const rows = [];
  const base = kind === "rule" ? 90 : kind === "fact" ? 85 : 55;
  rows.push({
    label: "Basis",
    points: base,
    hint:
      kind === "rule"
        ? "a tax or regulatory rule, not a forecast"
        : kind === "fact"
          ? "a published figure, not a forecast"
          : "a forecast-based estimate",
  });
  rows.push({
    label: "Signal strength",
    points: Math.round(signalStrength * 10),
    hint:
      signalStrength >= 0.7
        ? "the edge is large"
        : signalStrength <= 0.3
          ? "the edge is modest"
          : "the edge is moderate",
  });
  rows.push({
    label: "Data freshness",
    points: Math.round(-Math.min(20, freshnessDays * 0.5)),
    hint:
      freshnessDays > 7
        ? `data is about ${Math.round(freshnessDays)} days old`
        : "data is current",
  });
  if (fit != null)
    rows.push({
      label: "Fit to your plan",
      points: Math.round(fit * 5),
      hint: fit >= 0.7 ? "cleanly closes a gap in your plan" : "a partial fit",
    });
  if (reliability != null)
    rows.push({
      label: "Track record",
      points: 0, // reconciled below (reliability blends rather than adds)
      hint: `signals like this are historically right about ${Math.round(
        reliability * 100,
      )}% of the time`,
    });

  const total = score(factors);
  // Absorb the blend/rounding drift into the last row so the column sums to total.
  const summed = rows.reduce((s, r) => s + r.points, 0);
  rows[rows.length - 1].points += total - summed;

  return { total, band: band(total), rows, meaning: CONFIDENCE_MEANING };
}

// A full, plain-English description of WHAT the number means and WHY it landed
// where it did — so the user can trust (or discount) the suggestion themselves.
export function reasonFor(
  { kind = "fact", signalStrength = 0.5, freshnessDays = 0, fit = null, reliability = null },
  s = null,
) {
  const b = s == null ? null : band(s);
  const lead =
    b === "high"
      ? "High confidence — this is well-grounded and worth acting on."
      : b === "moderate"
        ? "Moderate confidence — a solid signal, but weigh it against your own situation."
        : b === "low"
          ? "Low confidence — a softer signal; treat it as a prompt to look, not a must-do."
          : null;

  const why = [];
  if (kind === "rule")
    why.push("it comes from a tax or regulatory rule, not a forecast");
  else if (kind === "fact")
    why.push("it's based on a published figure, not a forecast");
  else why.push("it's a forecast-based signal, so it carries more uncertainty");

  if (signalStrength >= 0.7) why.push("the edge is large");
  else if (signalStrength <= 0.3) why.push("the edge is modest");
  else why.push("the edge is moderate");

  why.push(
    freshnessDays > 7
      ? `the underlying data is about ${Math.round(freshnessDays)} days old`
      : "the underlying data is current",
  );

  if (reliability != null)
    why.push(
      `signals like this have historically been right about ${Math.round(
        reliability * 100,
      )}% of the time`,
    );
  if (fit != null && fit >= 0.7)
    why.push("it cleanly closes a gap in your plan");

  const factorSentence = why.join("; ");
  const capped = factorSentence.charAt(0).toUpperCase() + factorSentence.slice(1);
  const meaning =
    "Confidence measures how sure we are the suggestion is worth your attention — how strong, current and rule-based the signal is — not a prediction of the market.";

  return lead
    ? `${lead} The ${s}/100 score reflects that ${factorSentence}. ${meaning}`
    : `${capped}. ${meaning}`;
}

export function withConfidence(card) {
  const f = card.factors ?? {};
  const s = score(f);
  return {
    ...card,
    confidence: s,
    reason: reasonFor(f, s),
    confidenceBreakdown: breakdown(f),
  };
}
