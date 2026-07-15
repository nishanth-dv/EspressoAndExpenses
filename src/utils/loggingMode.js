export const LOG_MODES = [
  {
    key: "auto",
    label: "Auto-log",
    icon: "fa-robot",
    blurb: "We post each instalment on its due date, automatically.",
  },
  {
    key: "manual",
    label: "Remind me",
    icon: "fa-bell",
    blurb: "We nudge you each period; you log it with the real debit date.",
  },
  {
    key: "off",
    label: "I'll log it myself",
    icon: "fa-hand-pointer",
    blurb: "No schedule — you record each buy or sell as it happens.",
  },
];

const RECOMMENDATION = {
  sip: {
    mode: "auto",
    context:
      "Mutual-fund SIPs debit a fixed amount on a set NACH date every month — predictable enough to post automatically.",
  },
  rd: {
    mode: "auto",
    context:
      "A recurring deposit is a fixed monthly amount on a fixed date — safe to auto-log.",
  },
  plan: {
    mode: "auto",
    context:
      "A savings plan is a fixed recurring deposit on a set schedule — safe to auto-log.",
  },
  apy: {
    mode: "manual",
    context:
      "Atal Pension Yojana debits a fixed contribution, but the exact day isn't fixed — confirm each one when it actually clears.",
  },
  chit_fund: {
    mode: "manual",
    context:
      "A chit fund's monthly contribution changes with each auction, so confirm the actual amount when it's debited.",
  },
  lic: {
    mode: "manual",
    context:
      "LIC premiums fall on specific months and a missed one can lapse the policy — log each when it clears so arrears stay accurate.",
  },
  vpf: {
    mode: "manual",
    context:
      "VPF rides on your payroll and the amount can change with salary — confirm each contribution.",
  },
  ppf: {
    mode: "off",
    context:
      "PPF is funded whenever you choose, in varying amounts — record each deposit yourself.",
  },
  nps: {
    mode: "off",
    context:
      "NPS contributions are voluntary and irregular — record each one yourself.",
  },
};

const OFF_CONTEXT = {
  stock: "You buy and sell shares at will — record each trade yourself.",
  mf: "Lump-sum mutual-fund purchases happen on your terms — log each one yourself.",
  etf: "ETFs are bought and sold on the exchange when you choose.",
  ulip: "ULIP premiums vary and lock in — log each when paid.",
  fd: "A fixed deposit is a one-time placement — nothing recurring to log.",
  bond: "Bonds are bought once and held — no recurring instalment.",
  gold: "Gold is bought in one-offs — record each purchase yourself.",
  sgb: "Sovereign Gold Bonds are bought per tranche — log each yourself.",
  reit: "REIT units are traded when you choose.",
  invit: "InvIT units are traded when you choose.",
  scss: "SCSS is a one-time deposit — nothing recurring to log.",
  ssy: "SSY is funded whenever you choose — record each deposit yourself.",
  real_estate: "Property is a one-off — record it yourself.",
  nps_tier2: "NPS Tier-2 is funded voluntarily — record each contribution.",
  other: "Log entries yourself, whenever they happen.",
};

export function recommendedLogMode(typeKey) {
  if (RECOMMENDATION[typeKey]) return RECOMMENDATION[typeKey];
  return {
    mode: "off",
    context:
      OFF_CONTEXT[typeKey] ??
      "One-off or discretionary — record each buy or sell yourself.",
  };
}

export function resolveLogMode(inv) {
  const m = inv?.autoDeduct?.mode;
  if (m === "auto" || m === "manual" || m === "off") return m;
  if (inv?.type === "sip") return "auto";
  if (inv?.autoDeduct?.enabled) return "manual";
  return "off";
}
