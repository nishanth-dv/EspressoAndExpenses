// ── CSV parser (RFC 4180-ish) ──────────────────────────
//
// Handwritten because adding PapaParse for ~50 lines of work doesn't
// pay rent. Handles the common bank-export idioms:
//   • Comma-separated fields
//   • Double-quoted fields with embedded commas or newlines
//   • Escaped quotes inside quoted fields ("" → ")
//   • CRLF / LF line endings
//   • Skips blank lines (trailing newlines in exports are routine)
//
// Pasted text often uses tabs as separators. Auto-detect: if the first
// non-empty line has more tabs than commas, treat tabs as the delimiter.

export function parseCSV(text) {
  if (!text) return [];
  const delim = pickDelimiter(text);
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Treat \r\n as one newline by skipping a following \n after \r.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the last field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }

  // Trim each cell so trailing spaces in fixed-width-ish exports don't
  // throw off column detection or amount parsing.
  return rows.map((r) => r.map((c) => c.trim()));
}

function pickDelimiter(text) {
  // Look at the first non-empty line to pick. Some bank PDFs converted
  // to text via copy-paste come tab-separated, otherwise comma is the
  // sane default.
  const firstLine = text
    .split(/\r?\n/)
    .find((l) => l.trim() !== "");
  if (!firstLine) return ",";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs > semis) return "\t";
  if (semis > commas && semis > tabs) return ";";
  return ",";
}
