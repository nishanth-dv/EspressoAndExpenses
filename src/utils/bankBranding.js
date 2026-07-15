const BRANDING = {
  Cash: { color: "#2E7D5B", short: "₹" },
  HDFC: { color: "#004C8F", short: "HD" },
  ICICI: { color: "#AE275F", short: "IC" },
  SBI: { color: "#22409A", short: "SBI" },
  Axis: { color: "#97144D", short: "AX" },
  Kotak: { color: "#003D79", short: "KO" },
  IDFC: { color: "#9C1D26", short: "ID" },
  "Yes Bank": { color: "#00518F", short: "YES" },
  IndusInd: { color: "#9B1B30", short: "IN" },
  Amex: { color: "#2E77BC", short: "AE" },
  Citi: { color: "#003B70", short: "CITI" },
  "Standard Chartered": { color: "#0473EA", short: "SC" },
  RBL: { color: "#C8102E", short: "RBL" },
  "Karnataka Bank": { color: "#ED1C24", short: "KBL" },
  KBL: { color: "#ED1C24", short: "KBL" },
};

const LOGO_ALIASES = {
  "karnataka bank": "kbl",
  "karnataka bank ltd": "kbl",
  "karnataka bank limited": "kbl",
  "the karnataka bank": "kbl",
  "the karnataka bank ltd": "kbl",
  karnataka: "kbl",
  kbl: "kbl",
};

export function getBankBranding(bank, fallbackColor) {
  if (bank && BRANDING[bank]) return BRANDING[bank];
  const name = (bank || "").trim();
  const short = name
    ? name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 3)
        .toUpperCase()
    : "?";
  return { color: fallbackColor || "#6b7280", short: short || "?" };
}

export function bankSlug(bank) {
  return (bank || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function bankLogoSlug(bank) {
  const norm = (bank || "").trim().toLowerCase();
  return LOGO_ALIASES[norm] || bankSlug(bank);
}
