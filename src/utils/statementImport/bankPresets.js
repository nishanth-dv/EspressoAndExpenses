// ── Bank presets ───────────────────────────────────────
//
// Lightweight registry that recognises a bank from its statement header
// signature. Used for:
//   • Display in the review UI ("Detected: HDFC Bank")
//   • Per-bank column-mapping overrides where the generic sniffer would
//     otherwise have to guess
//   • Higher baseline confidence for rows from a recognised export, on
//     the theory that we trust our preset more than a heuristic
//
// The sniffer in columnSniffer.js handles the common Indian-bank header
// vocabulary already (Narration / Particulars / Withdrawal / Deposit
// etc.), so most presets here are just signatures. As real-world quirks
// surface, each preset gets a `columns` override that wins over the
// generic detection.

export const BANK_PRESETS = [
  {
    key: "hdfc",
    label: "HDFC Bank",
    signatures: [
      /\bhdfc\s+bank\b/i,
      /\bhdfc\s+bank\s+limited\b/i,
    ],
  },
  {
    key: "icici",
    label: "ICICI Bank",
    signatures: [
      /\bicici\s+bank\b/i,
      /\bicicibank\b/i,
    ],
  },
  {
    key: "sbi",
    label: "State Bank of India",
    signatures: [
      /\bstate\s+bank\s+of\s+india\b/i,
      /\bsbi\s+account\b/i,
      /\bsbin\b/i,
    ],
  },
  {
    key: "axis",
    label: "Axis Bank",
    signatures: [
      /\baxis\s+bank\b/i,
      /\baxisbank\b/i,
    ],
  },
  {
    key: "kotak",
    label: "Kotak Mahindra Bank",
    signatures: [
      /\bkotak\s+mahindra\s+bank\b/i,
      /\bkotak\s+bank\b/i,
    ],
  },
];

// Given the parsed rows[][], scan the top ~30 cells for a bank signature.
// We look in the top portion because statement headers (logo line,
// "<Bank Name> Statement of Account") sit before the transaction table.
// Returns the matching preset or null.
export function detectBank(rows) {
  if (!rows?.length) return null;
  const blob = rows
    .slice(0, 30)
    .flat()
    .join(" ")
    .toLowerCase();
  for (const preset of BANK_PRESETS) {
    if (preset.signatures.some((re) => re.test(blob))) return preset;
  }
  return null;
}
