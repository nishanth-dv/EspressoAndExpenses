// ── xlsx parser ────────────────────────────────────────
//
// Some banks export to .xls / .xlsx natively (or sometimes a CSV with a
// misleading .xls extension). SheetJS handles both with a single API,
// so this file is a thin wrapper that emits the same rows[][] shape
// every downstream consumer expects.
//
// If the workbook has multiple sheets, we pick the first sheet that
// has at least 3 rows. That's almost always the transaction sheet —
// summary / promo sheets tend to be tiny.

import * as XLSX from "xlsx";

export function parseXLSX(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  if (!wb.SheetNames?.length) return [];

  let chosenSheet = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const sample = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    if (sample.length >= 3) {
      chosenSheet = name;
      break;
    }
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[chosenSheet], {
    header: 1,
    // raw:false → SheetJS formats values as strings using each cell's own
    // number/date format. Keeps Indian date formatting (DD/MM/YYYY) intact
    // so the date parser doesn't have to guess.
    raw: false,
    defval: "",
  });

  // Trim and drop empty trailing rows.
  return rows
    .map((r) => r.map((c) => (c == null ? "" : String(c).trim())))
    .filter((r) => r.some((c) => c !== ""));
}
