// ── Merchant fingerprint ───────────────────────────────
//
// Given a raw statement description like:
//
//   "UPI/PAYTM*BLINKIT/525012345678/SWIPE/HDFC"
//   "POS 4317XXXXXXXX5421 ZOMATO LIMITED        BANGALORE     IN"
//   "NEFT-AXIB000000123-SWIGGY INSTAMART PRIVATE LIMITED"
//
// produce a stable, normalised "merchant fingerprint" that survives
// across statements. The fingerprint is what we use as the lookup key
// in the learned alias table and the implicit per-user index.
//
// Strategy:
//   1. Strip rail/channel prefixes (UPI/, NEFT-, IMPS-, POS, ATW, etc.)
//   2. Strip transaction reference numbers — long runs of digits, hex
//      ids, common reference patterns.
//   3. Tokenise on common bank-statement separators ( / - * | )
//   4. Drop short / numeric tokens; keep the first 2 meaningful tokens.
//   5. Uppercase + collapse whitespace for stable comparison.
//
// Returns null when nothing usable survives (e.g. pure ATM withdrawal
// without merchant data). Callers treat null as "no fingerprint, fall
// through to generic heuristics."

const RAIL_PREFIXES = [
  /^upi[/\-:]/i,
  /^upi$/i,
  /^neft[/\-:]/i,
  /^neft$/i,
  /^imps[/\-:]/i,
  /^imps$/i,
  /^rtgs[/\-:]/i,
  /^rtgs$/i,
  /^pos[/\-: ]/i,
  /^pos$/i,
  /^ach[/\-:]/i,
  /^atw[/\-:]/i,
  /^atm[/\-:]/i,
  /^ecs[/\-:]/i,
  /^bil[/\-:]/i,
  /^bil$/i,
  /^chq[/\-:]/i,
  /^chq$/i,
  /^ft[/\-:]/i,
  /^vpa[/\-:]/i,
];

// Tokens we never want to treat as the merchant — these are bank /
// payment-rail boilerplate that pollutes long narrations.
const NOISE_TOKENS = new Set([
  "UPI", "NEFT", "IMPS", "RTGS", "POS", "ATW", "ATM", "ECS",
  "VPA", "FT", "BIL", "ACH", "TPT", "P2A", "P2P", "P2M",
  "SWIPE", "MERCHANT", "PAYMENT", "TRANSFER", "PAYTM", "GPAY",
  "PHONEPE", "RAZORPAY", "BHARATPE", "BBPS",
  "HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "YESB", "PNB",
  "BANK", "LIMITED", "LTD", "PVT", "PRIVATE", "INDIA", "IN",
]);

// Hex-ish or long-digit tokens are almost always reference numbers.
const REF_TOKEN = /^[0-9]{4,}$/;
const ALPHANUM_REF = /^[A-Z0-9]{8,}$/;

export function extractMerchantFingerprint(description) {
  if (!description) return null;
  let s = String(description).trim();
  if (!s) return null;

  // Repeatedly strip rail prefixes — some narrations stack them
  // ("UPI/NEFT-..." in some bank flavours).
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of RAIL_PREFIXES) {
      if (re.test(s)) {
        s = s.replace(re, "").trim();
        changed = true;
      }
    }
  }

  // Replace common separators with spaces and collapse.
  const tokens = s
    .toUpperCase()
    .split(/[/\-*|.,;:()\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !REF_TOKEN.test(t))
    .filter((t) => !ALPHANUM_REF.test(t) || /[A-Z]/.test(t.slice(0, 4))); // keep early-letter tokens

  // Drop noise tokens but only after we've extracted them — if every
  // token is noise (e.g. "UPI NEFT TRANSFER") return null rather than
  // an empty fingerprint.
  const meaningful = tokens.filter((t) => !NOISE_TOKENS.has(t));
  if (meaningful.length === 0) return null;

  // Take the first 2 meaningful tokens — that's usually enough to
  // identify the merchant ("BLINKIT", "ZOMATO LIMITED", "SWIGGY
  // INSTAMART"). More tokens just add noise that breaks matching when
  // a future statement formats the same merchant differently.
  return meaningful.slice(0, 2).join(" ");
}

// Quick substring containment check, used when we want to match a
// user-defined alias pattern that's shorter than what the fingerprint
// extractor produces (e.g. user typed "BLINKIT", current row's
// fingerprint is "BLINKIT MUMBAI"). Bidirectional so either direction
// of inclusion counts as a hit.
export function fingerprintMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}
