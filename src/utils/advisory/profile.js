// Personalized profile: the "should-be" reference points the engine measures
// your data against. Sensible defaults are inferred from your data; every field
// is tweakable and persisted under preferences.advisoryProfile.

const TYPE_ASSET_CLASS = {
  stock: "equity",
  mf: "equity",
  sip: "equity",
  etf: "equity",
  ulip: "equity",
  fd: "debt",
  rd: "debt",
  ppf: "debt",
  nps: "debt",
  nps_tier2: "debt",
  lic: "debt",
  plan: "debt",
  bond: "debt",
  vpf: "debt",
  apy: "debt",
  scss: "debt",
  ssy: "debt",
  chit_fund: "debt",
  gold: "gold",
  sgb: "gold",
  crypto: "alt",
  real_estate: "alt",
  reit: "alt",
  invit: "alt",
};

export function assetClassOf(typeKey, investmentTypes) {
  const tagged = (investmentTypes || []).find(
    (x) => x.key === typeKey || x.id === typeKey,
  );
  if (tagged?.assetClass) return tagged.assetClass;
  const t = String(typeKey || "").toLowerCase();
  if (TYPE_ASSET_CLASS[t]) return TYPE_ASSET_CLASS[t];
  if (/stock|share|equity|etf|mutual|\bmf\b|sip|elss|index|nifty|sensex/.test(t))
    return "equity";
  if (/gold|sgb|silver|metal/.test(t)) return "gold";
  if (
    /\bfd\b|deposit|\brd\b|ppf|epf|vpf|nps|bond|debenture|scss|nsc|provident|pension|chit/.test(
      t,
    )
  )
    return "debt";
  if (/crypto|bitcoin|\bbtc\b|ethereum|coin|reit|invit|real|property|land/.test(t))
    return "alt";
  return "alt";
}

const ASSET_LABELS = {
  equity: "Equity",
  debt: "Debt / Fixed",
  gold: "Gold",
  alt: "Alternatives",
};

export function assetLabel(cls) {
  return ASSET_LABELS[cls] ?? cls;
}

function glidePath(age, risk) {
  let equity = Math.max(20, Math.min(85, 100 - age));
  equity += risk === "aggressive" ? 10 : risk === "conservative" ? -15 : 0;
  equity = Math.max(10, Math.min(90, Math.round(equity)));
  const gold = 10;
  const alt = 0;
  const debt = Math.max(0, 100 - equity - gold - alt);
  return { equity, debt, gold, alt };
}

function annualIncome(transactions) {
  const cutoff = Date.now() - 365 * 86_400_000;
  let sum = 0;
  for (const t of transactions ?? []) {
    if (t.transactionType !== "income") continue;
    const d = new Date(t.occurredAt || t.createdAt).getTime();
    if (Number.isFinite(d) && d >= cutoff) sum += parseFloat(t.amount) || 0;
  }
  return sum;
}

// Rough marginal slab from annual income (new-regime-ish brackets). It's only a
// default — the user confirms/edits it.
function inferSlab(income) {
  if (income >= 1500000) return 0.3;
  if (income >= 1200000) return 0.2;
  if (income >= 900000) return 0.15;
  if (income >= 600000) return 0.1;
  if (income >= 300000) return 0.05;
  return 0;
}

export function inferProfile(data) {
  const income = annualIncome(data?.transactions);
  return {
    birthYear: new Date().getFullYear() - 30,
    riskAppetite: "moderate",
    taxRegime: "new",
    taxSlab: income > 0 ? inferSlab(income) : 0.3,
    emergencyMonths: 6,
    used80C: 0,
    npsExtraUsed: 0,
    ltcgRealized: 0,
    monthlyIncome: "",
    // Phase 3 — light inputs for protection & retirement advice.
    dependents: 0,
    termCover: "", // existing term life sum assured (₹)
    healthCover: "", // existing health cover (₹)
    retireAge: 60,
    goals: [],
    targetAllocation: glidePath(30, "moderate"),
  };
}

// Stored profile overrides inferred defaults. If the user set age + risk but no
// explicit target, regenerate the glide path from those.
export function mergeProfile(data, stored) {
  const base = inferProfile(data);
  const merged = { ...base, ...(stored || {}) };
  if (!stored || !stored.targetAllocation) {
    const age = new Date().getFullYear() - merged.birthYear;
    merged.targetAllocation = glidePath(age, merged.riskAppetite);
  }
  return merged;
}

export { glidePath };
