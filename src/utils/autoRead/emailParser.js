// Parses a bank / UPI alert email (or SMS) into a transaction candidate.
// Pure + local. Tuned against real Indian bank alert formats (HDFC UPI shown
// below) and kept generic enough to widen to other banks/templates.
//
//   "Rs.100.00 is debited from your account ending 1957 towards VPA
//    ppqr01.ytvexg@iob (THYAGARAJU B S) on 16-06-26.
//    UPI transaction reference no.: 616719463129."

import { predictEntry } from "../smartFill";

// Sender domains used to scope the Gmail search to bank / UPI alert mail.
export const DEFAULT_ALERT_SENDERS = [
  "hdfcbank.net",
  "icicibank.com",
  "sbi.co.in",
  "axisbank.com",
  "kotak.com",
  "yesbank.in",
  "idfcfirstbank.com",
  "pnb.co.in",
];

const KNOWN_BANKS = [
  { key: "HDFC", re: /\bHDFC\b/i },
  { key: "ICICI", re: /\bICICI\b/i },
  { key: "SBI", re: /\bSBI\b|State Bank/i },
  { key: "Axis", re: /\bAxis\b/i },
  { key: "Kotak", re: /\bKotak\b/i },
  { key: "Yes Bank", re: /\bYes Bank\b/i },
  { key: "IDFC", re: /\bIDFC\b/i },
  { key: "PNB", re: /\bPNB\b|Punjab National/i },
];

export function parseAlertEmail(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.replace(/\s+/g, " ").trim();

  const amountM = t.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amountM) return null;
  const amount = parseFloat(amountM[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const debit = /\bdebited?\b|\bspent\b|\bpaid\b|\bwithdrawn\b|\bpurchase\b/i.test(t);
  const credit = /\bcredited?\b|\breceived\b|\bdeposited\b/i.test(t);
  const direction = credit && !debit ? "credit" : "debit";

  const last4M =
    t.match(/account ending\s*(\d{3,4})/i) ||
    t.match(/a\/c\s*(?:no\.?\s*)?(?:X+|x+|\*+)?(\d{3,4})\b/i) ||
    t.match(/ending\s+(?:with\s+)?(\d{3,4})/i);
  const last4 = last4M ? last4M[1] : null;

  const vpaM = t.match(/VPA\s+([\w.\-]+@[\w.\-]+)(?:\s*\(([^)]+)\))?/i);
  const vpa = vpaM ? vpaM[1] : null;
  let merchant = vpaM && vpaM[2] ? vpaM[2].trim() : null;
  if (!merchant) {
    const toM = t.match(
      /(?:to|towards|at|in favou?r of|from)\s+([A-Z][A-Za-z0-9 &.'_-]{2,40}?)(?:\s+on\b|\s+via\b|[.,]|$)/,
    );
    if (toM) merchant = toM[1].trim();
  }
  if (!merchant && vpa) merchant = vpa;

  let dateISO = null;
  const dateM = t.match(/on\s+(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/i);
  if (dateM) {
    let [, d, m, y] = dateM;
    if (y.length === 2) y = `20${y}`;
    dateISO = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Time is only present in some templates (this HDFC UPI mail has none).
  // Patterns: "16-06-26 20:05:30", "at 8:05 PM", "at 20:05".
  let time = null;
  const timeM =
    t.match(
      /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}[ ,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i,
    ) ||
    t.match(/\bat\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i) ||
    t.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)\b/i);
  if (timeM) {
    let h = parseInt(timeM[1], 10);
    const min = timeM[2];
    const ap = (timeM[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) time = `${String(h).padStart(2, "0")}:${min}`;
  }

  const mode = /UPI|VPA/i.test(t)
    ? "UPI"
    : /credit card/i.test(t)
      ? "Credit Card"
      : /debit card/i.test(t)
        ? "Debit Card"
        : /NEFT|IMPS|RTGS|net ?banking/i.test(t)
          ? "Bank Transfer"
          : "UPI";

  const refM = t.match(
    /\b(?:reference|ref|txn|utr|transaction id)\b\s*(?:no\.?|number|id)?\s*[.:]?\s*([A-Za-z0-9]{8,})/i,
  );
  const reference = refM ? refM[1] : null;

  const bank = (KNOWN_BANKS.find((b) => b.re.test(t)) || {}).key ?? null;

  let confidence = 0.45;
  if (dateISO) confidence += 0.15;
  if (merchant) confidence += 0.15;
  if (last4) confidence += 0.1;
  if (reference) confidence += 0.1;
  if (bank) confidence += 0.05;

  return {
    amount,
    direction,
    merchant,
    vpa,
    last4,
    dateISO,
    time,
    mode,
    reference,
    bank,
    confidence: Math.min(1, confidence),
  };
}

function localHM(d) {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}

function localDateISO(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

// Maps a parsed candidate to a draft transaction (pre-enrichment). `receivedAt`
// is the email's received time (or the capture time) — used as the clock time
// when the alert itself carries only a date, since the alert lands within
// seconds of the transaction.
export function candidateToTransaction(parsed, { receivedAt } = {}) {
  const ref = receivedAt ? new Date(receivedAt) : new Date();
  const dateISO = parsed.dateISO || localDateISO(ref);
  const timeHM = parsed.time || localHM(ref);
  const occurredAt = `${dateISO}T${timeHM}`;
  return {
    transactionType: parsed.direction === "credit" ? "income" : "expense",
    name: parsed.merchant || parsed.vpa || "UPI transaction",
    amount: String(parsed.amount),
    paymentMode: parsed.mode,
    occurredAt,
    ...(parsed.reference ? { reference: parsed.reference } : {}),
  };
}

// Full, ready-to-post transaction from a parsed alert: enriches category +
// account from merchant memory (smart-fill) and maps the alert's bank to a
// tracked account. Shared by the accept-thunk and the inline "edit" prefill.
export function buildCaptureTransaction(
  parsed,
  { transactions = [], accounts = [], receivedAt } = {},
) {
  const base = candidateToTransaction(parsed, { receivedAt });
  const pred = predictEntry(base.name, transactions, {
    type: base.transactionType,
  });

  let accountId = pred?.accountId || "";
  if (!accountId && parsed.bank) {
    const acc = accounts.find((a) =>
      (a.bank || "").toLowerCase().includes(parsed.bank.toLowerCase()),
    );
    if (acc) accountId = acc.id;
  }

  const tx = {
    ...base,
    category: pred?.category ?? "",
    ...(accountId ? { accountId } : {}),
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
  };
  if (tx.cardId || !tx.accountId) delete tx.accountId;
  return tx;
}
