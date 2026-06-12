// ── Generic column sniffer ─────────────────────────────
//
// Given the rows produced by parseCSV(), figure out which columns hold
// the date, description, debit/credit (or signed amount), and balance.
// Designed to be liberal — Indian bank exports use wildly different
// header conventions ("Narration", "Particulars", "Description", "Txn
// Description" …), so we lean on substring matches + a positional
// fallback when headers are absent.
//
// Returns:
//   {
//     headerRowIdx: number,   // -1 means no header detected (positional)
//     columns: {
//       date,          required
//       description,   required
//       debit          mutually exclusive with amount
//       credit         mutually exclusive with amount
//       amount         single signed column
//     }
//   }
//
// Caller treats columns.amount as the sole money column when present;
// otherwise reads debit / credit as a pair.

const HEADER_KEYWORDS = {
  date: ["transaction date", "txn date", "value date", "date"],
  description: [
    "narration",
    "particulars",
    "description",
    "details",
    "remarks",
    "transaction details",
  ],
  debit: ["debit", "withdrawal", "withdrawals", "dr amount", " dr ", "debit amount"],
  credit: ["credit", "deposit", "deposits", "cr amount", " cr ", "credit amount"],
  amount: ["amount", "amount (inr)", "txn amount"],
  balance: ["balance", "running balance", "closing balance"],
};

function matchHeader(cell, keywords) {
  const c = " " + cell.toLowerCase() + " ";
  return keywords.some((k) => c.includes(k));
}

export function detectColumns(rows) {
  if (!rows || rows.length === 0) return null;

  // Find the first row that looks like a header — at least 3 non-empty
  // cells AND containing at least one of: "date", "amount", "narration",
  // "description", "debit", or "credit". This guards against bank PDFs
  // that prepend account-summary text before the table.
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = rows[i];
    if (r.filter((c) => c !== "").length < 3) continue;
    const blob = r.join(" ").toLowerCase();
    if (
      /\b(date)\b/.test(blob) &&
      /\b(amount|debit|credit|narration|description|particulars|withdrawal|deposit)\b/.test(
        blob,
      )
    ) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) return positionalFallback(rows);

  const header = rows[headerRowIdx];
  const cols = {};
  for (const key of Object.keys(HEADER_KEYWORDS)) {
    const idx = header.findIndex((c) => matchHeader(c, HEADER_KEYWORDS[key]));
    if (idx !== -1) cols[key] = idx;
  }

  // Sanity: if both 'amount' and one of (debit/credit) matched, prefer
  // the debit/credit pair — bank exports that have both usually mean
  // "amount" is a redundant copy in one of them.
  if (cols.amount !== undefined && (cols.debit !== undefined || cols.credit !== undefined)) {
    delete cols.amount;
  }

  // Must have at minimum a date and at least one money column.
  const hasMoney =
    cols.amount !== undefined ||
    cols.debit !== undefined ||
    cols.credit !== undefined;
  if (cols.date === undefined || !hasMoney) {
    return positionalFallback(rows);
  }

  // Description is nice-to-have but not strictly required. If absent,
  // pick the column with the longest average text length below.
  if (cols.description === undefined) {
    cols.description = guessDescriptionByLength(rows, headerRowIdx, cols);
  }

  return { headerRowIdx, columns: cols };
}

// Positional fallback when no recognisable header is present. Looks at
// the first 30 data rows and picks:
//   • date: column where most cells parse as a date
//   • amount/debit/credit: column(s) where most cells parse as a number
//   • description: longest-text column among the rest
function positionalFallback(rows) {
  if (rows.length < 2) return null;
  const cellCount = Math.max(...rows.map((r) => r.length));
  if (cellCount < 3) return null;

  const sample = rows.slice(0, 30);
  const dateCol = pickColumn(sample, cellCount, (c) => looksLikeDate(c));
  const numericCol = pickColumn(sample, cellCount, (c) => looksLikeNumber(c));
  if (dateCol === -1 || numericCol === -1) return null;

  const usedCols = new Set([dateCol, numericCol]);
  let descCol = -1;
  let bestLen = 0;
  for (let i = 0; i < cellCount; i++) {
    if (usedCols.has(i)) continue;
    let total = 0;
    let n = 0;
    for (const r of sample) {
      if (typeof r[i] === "string" && r[i] !== "") {
        total += r[i].length;
        n++;
      }
    }
    const avg = n > 0 ? total / n : 0;
    if (avg > bestLen) {
      bestLen = avg;
      descCol = i;
    }
  }

  return {
    headerRowIdx: -1,
    columns: {
      date: dateCol,
      description: descCol === -1 ? numericCol : descCol,
      amount: numericCol,
    },
  };
}

function pickColumn(rows, cellCount, predicate) {
  let bestCol = -1;
  let bestHits = 0;
  for (let i = 0; i < cellCount; i++) {
    let hits = 0;
    for (const r of rows) {
      if (predicate(r[i] ?? "")) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = i;
    }
  }
  return bestHits > rows.length / 3 ? bestCol : -1;
}

function guessDescriptionByLength(rows, headerRowIdx, cols) {
  const sample = rows.slice(headerRowIdx + 1, headerRowIdx + 31);
  const used = new Set(Object.values(cols));
  const cellCount = Math.max(...sample.map((r) => r.length));
  let bestCol = 0;
  let bestLen = 0;
  for (let i = 0; i < cellCount; i++) {
    if (used.has(i)) continue;
    let total = 0;
    let n = 0;
    for (const r of sample) {
      if (typeof r[i] === "string" && r[i] !== "") {
        total += r[i].length;
        n++;
      }
    }
    const avg = n > 0 ? total / n : 0;
    if (avg > bestLen) {
      bestLen = avg;
      bestCol = i;
    }
  }
  return bestCol;
}

function looksLikeDate(s) {
  if (!s) return false;
  // Quick patterns: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD MMM YYYY.
  return (
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s) ||
    /^\d{4}-\d{2}-\d{2}/.test(s) ||
    /^\d{1,2}\s+[A-Za-z]{3,}\s+\d{2,4}$/.test(s)
  );
}

function looksLikeNumber(s) {
  if (!s) return false;
  // Indian formatting allows commas inside numbers (1,23,456.78).
  const cleaned = s.replace(/[,₹\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned);
}
