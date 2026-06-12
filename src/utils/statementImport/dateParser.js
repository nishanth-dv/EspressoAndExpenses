// ── Lenient date parser ────────────────────────────────
//
// Bank exports use everything from "15/01/2025" to "15-Jan-2025" to ISO.
// Returns an ISO string anchored at local midnight (so date-only ledger
// comparisons stay correct), or null if the input doesn't match any
// supported pattern.
//
// Heuristic for ambiguous formats: prefer Indian DD/MM/YYYY when both
// day and month components fit (i.e. day > 12 disambiguates). When both
// are ≤12, default to DD/MM/YYYY since the app's target audience is
// Indian banks.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function parseDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  // ISO: 2025-01-15 or 2025-01-15T...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return makeISO(+iso[1], +iso[2] - 1, +iso[3]);

  // DD MMM YYYY: "15 Jan 2025" / "15-Jan-2025" / "15-Jan-25"
  const named = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{2,4})$/);
  if (named) {
    const mo = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (mo == null) return null;
    return makeISO(yr4(+named[3]), mo, +named[1]);
  }

  // DD/MM/YYYY or DD-MM-YYYY (Indian default)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const a = +dmy[1];
    const b = +dmy[2];
    const y = yr4(+dmy[3]);
    // Day > 12 → unambiguous DD/MM. Otherwise we assume DD/MM.
    if (a > 31 || b > 12) {
      // Probably MM/DD/YYYY then.
      return makeISO(y, a - 1, b);
    }
    return makeISO(y, b - 1, a);
  }

  // Last resort — let JS try.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return makeISO(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

function yr4(y) {
  if (y < 100) return y < 70 ? 2000 + y : 1900 + y;
  return y;
}

function makeISO(yr, mo, day) {
  // Local-midnight anchor so the ledger's date-only comparisons aren't
  // thrown off by UTC offset when the user is in IST etc.
  return new Date(yr, mo, day).toISOString();
}

// Parse an Indian-formatted amount string. Strips ₹, commas, parens
// (for negative numbers as some statements use "(123.45)" for debits).
// Returns { abs: number, signed: number } — signed is negative if the
// original string indicated a negative.
export function parseAmount(input) {
  if (input == null || input === "") return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const negParen = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,₹\s()]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  let n = parseFloat(cleaned);
  if (negParen) n = -Math.abs(n);
  return { abs: Math.abs(n), signed: n };
}
