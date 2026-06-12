// ── Statement import orchestrator ──────────────────────
//
// Two entry points:
//   • parseStatementText(text, ctx) — Phase A's pasted / CSV path.
//   • parseStatementFile(file, ctx, opts) — Phase B's file path. Sniffs
//     the format from the filename + MIME, then dispatches to the right
//     decoder (CSV / PDF / xlsx). Password-protected PDFs throw a
//     PasswordRequiredError so the caller can prompt and retry without
//     losing the file in hand.
//
// All paths produce the same downstream shape: rawRows[][] of strings →
// detectColumns → ParsedTransaction[] → classify → markDuplicates →
// review UI. That uniformity is the whole point — any future parser
// (OCR, screenshot, LLM fallback) plugs in by producing rawRows.

import { parseCSV } from "./csvParser";
import { detectColumns } from "./columnSniffer";
import { parseDate, parseAmount } from "./dateParser";
import { classify } from "./classifier";
import { markDuplicates } from "./dedupe";
import { parsePDF, PasswordRequiredError, PasswordIncorrectError } from "./pdfParser";
import { parseXLSX } from "./xlsxParser";
import { detectBank } from "./bankPresets";
import { buildLearnedIndex } from "./learnedIndex";

export { PasswordRequiredError, PasswordIncorrectError };

// Format detection by extension first (cheap, deterministic), falling
// back to MIME if the filename gives no hint. Anything unrecognised
// throws — UI surfaces the error to the user.
export function detectFormat(file) {
  if (!file) return null;
  const name = (file.name ?? "").toLowerCase();
  const mime = file.type ?? "";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (name.endsWith(".xlsx") || name.endsWith(".xls"))    return "xlsx";
  if (
    mime === "application/vnd.ms-excel" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  if (name.endsWith(".csv") || mime === "text/csv") return "csv";
  if (name.endsWith(".txt") || mime.startsWith("text/")) return "csv";
  return null;
}

// Direct text entry point (paste mode or already-decoded CSV). Kept
// separate so the modal's paste flow doesn't go through a fake File.
export function parseStatementText(text, ctx = {}) {
  return finalise(parseCSV(text), ctx);
}

// File entry point. Returns the same shape as parseStatementText().
// For PDFs the caller may pass `{ password }`. If a password is required
// and missing (or wrong), this throws PasswordRequiredError /
// PasswordIncorrectError; the UI prompts the user and retries.
export async function parseStatementFile(file, ctx = {}, opts = {}) {
  const format = detectFormat(file);
  if (!format) {
    return {
      rows: [],
      meta: null,
      errors: [
        `Unrecognised file type "${file.name}". Try CSV, PDF, or Excel.`,
      ],
    };
  }

  let rawRows;
  try {
    if (format === "pdf") {
      const buf = await file.arrayBuffer();
      rawRows = await parsePDF(buf, opts.password);
    } else if (format === "xlsx") {
      const buf = await file.arrayBuffer();
      rawRows = parseXLSX(buf);
    } else {
      const text = await file.text();
      rawRows = parseCSV(text);
    }
  } catch (e) {
    if (e instanceof PasswordRequiredError || e instanceof PasswordIncorrectError) {
      throw e; // bubble to the modal so it can prompt
    }
    return {
      rows: [],
      meta: null,
      errors: [`Couldn't read this file: ${e.message ?? "unknown error"}`],
    };
  }

  return finalise(rawRows, ctx);
}

// Shared back end: rawRows → ParsedTransaction[] (classified + deduped).
// Both paths funnel through here so the downstream behaviour is identical
// regardless of source format.
function finalise(rawRows, ctx) {
  if (!rawRows || rawRows.length === 0) {
    return { rows: [], meta: null, errors: ["No rows found"] };
  }

  const detectedBank = detectBank(rawRows);
  const detected = detectColumns(rawRows);
  if (!detected) {
    return {
      rows: [],
      meta: { detectedBank },
      errors: [
        "Couldn't figure out which columns hold the date and amount. Make sure your file has a header row, or try a different export format.",
      ],
    };
  }

  const dataRows =
    detected.headerRowIdx === -1
      ? rawRows
      : rawRows.slice(detected.headerRowIdx + 1);

  const { columns } = detected;
  const parsed = [];
  const skipped = [];

  for (const r of dataRows) {
    const result = rowToTransaction(r, columns);
    if (result.tx) parsed.push(result.tx);
    else if (result.reason) skipped.push(result.reason);
  }

  if (parsed.length === 0) {
    return {
      rows: [],
      meta: { detected, detectedBank, skipped },
      errors: [
        skipped[0]
          ? `Found a table but couldn't extract transactions. Sample issue: ${skipped[0]}`
          : "No transactions extracted from the file.",
      ],
    };
  }

  // Build the learned classifier index once for the whole batch.
  // Cheap to rebuild — a few hundred ledger entries max — and avoids
  // stale-state issues that would come from caching it on the slice.
  const learnedIndex = buildLearnedIndex(
    ctx.existingTransactions ?? [],
    ctx.merchantAliases ?? [],
  );

  const classified = parsed.map((p) => ({
    ...p,
    ...classify(p, { ...ctx, learnedIndex }),
  }));
  const final = markDuplicates(classified, ctx.existingTransactions ?? []);

  return {
    rows: final,
    meta: {
      detected,
      detectedBank,
      skipped,
      total: parsed.length,
    },
    errors: [],
  };
}

function rowToTransaction(r, cols) {
  const dateCell = r[cols.date];
  const occurredAt = parseDate(dateCell);
  if (!occurredAt) return { tx: null, reason: `Bad date: "${dateCell}"` };

  const description = (r[cols.description] ?? "").trim();
  if (!description) return { tx: null, reason: "Missing description" };

  let amount = null;
  let direction = null;

  if (cols.amount !== undefined) {
    const parsed = parseAmount(r[cols.amount]);
    if (parsed) {
      amount = parsed.abs;
      direction = parsed.signed < 0 ? "debit" : "credit";
    }
  } else {
    const debit = parseAmount(r[cols.debit] ?? "");
    const credit = parseAmount(r[cols.credit] ?? "");
    if (debit && debit.abs > 0) {
      amount = debit.abs;
      direction = "debit";
    } else if (credit && credit.abs > 0) {
      amount = credit.abs;
      direction = "credit";
    }
  }

  if (amount == null || amount === 0) {
    return { tx: null, reason: `No amount on row "${description.slice(0, 40)}"` };
  }

  return {
    tx: {
      id: `imp-${crypto.randomUUID().slice(0, 8)}`,
      occurredAt,
      description,
      amount,
      direction,
    },
    reason: null,
  };
}
