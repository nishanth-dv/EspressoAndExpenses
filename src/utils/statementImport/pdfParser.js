// ── PDF parser ─────────────────────────────────────────
//
// Extracts text from PDF statements and reconstructs the implicit table
// layout into the same rows[][] shape parseCSV() produces — that way the
// downstream pipeline (columnSniffer → classifier → review) is agnostic
// about whether the source was a PDF, CSV, or pasted text.
//
// Reconstruction strategy:
//   1. Walk every page, pull every text item with its (x, y) baseline.
//   2. Cluster items by Y coordinate (with a small tolerance for
//      sub-pixel jitter). Each cluster is a visual row.
//   3. Identify the header row by content match — look for "date" plus
//      one of (amount, debit, credit, narration, description).
//   4. Use the header items' X-midpoints as column anchors. For every
//      data row, snap each item to the nearest column by X-mid. Items
//      sharing a column get joined with spaces (handles multi-word
//      narrations split across multiple text fragments).
//   5. Emit rows[][] in reading order so columnSniffer + the table
//      pipeline don't need to know about the PDF origin.
//
// Password-protected PDFs are the norm for Indian banks. We surface a
// dedicated PasswordRequiredError so the modal can prompt for it and
// retry without losing the file in hand.

import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class PasswordRequiredError extends Error {
  constructor(message = "Password required") {
    super(message);
    this.name = "PasswordRequiredError";
  }
}

export class PasswordIncorrectError extends Error {
  constructor() {
    super("Password incorrect");
    this.name = "PasswordIncorrectError";
  }
}

const Y_TOLERANCE = 2; // points; items on the same visual line cluster within this

export async function parsePDF(arrayBuffer, password) {
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: arrayBuffer,
      password,
      // Suppress the noisy console output pdf.js emits on load.
      verbosity: 0,
    }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") {
      // pdf.js reports "INCORRECT_PASSWORD" vs "NEED_PASSWORD" via .code
      if (e.code === 2 /* INCORRECT_PASSWORD */) throw new PasswordIncorrectError();
      throw new PasswordRequiredError();
    }
    throw e;
  }

  const allRows = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items = (content.items ?? []).filter(
      (it) => typeof it.str === "string" && it.str.trim() !== "",
    );
    if (items.length === 0) continue;

    // Group by Y. PDF coordinate origin is bottom-left, so larger Y is
    // higher on the page — we sort descending so reading order is
    // top-to-bottom.
    const groups = [];
    for (const it of items) {
      const y = Math.round(it.transform?.[5] ?? 0);
      let bucket = groups.find((g) => Math.abs(g.y - y) <= Y_TOLERANCE);
      if (!bucket) {
        bucket = { y, items: [] };
        groups.push(bucket);
      }
      bucket.items.push(it);
    }
    groups.sort((a, b) => b.y - a.y);

    // For each visual row, sort by X (left-to-right).
    const visualRows = groups.map((g) =>
      g.items.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0)),
    );

    // Try to find the header row on this page so we can use its column
    // anchors. Per-page detection lets the layout vary between pages
    // (some banks split summary + ledger across page breaks).
    const headerIdx = visualRows.findIndex((r) => looksLikeHeader(r));
    if (headerIdx === -1) {
      // No header on this page — fall back to flat join. Better than
      // dropping the page entirely; the sniffer might still recover
      // structure from the resulting CSV-ish output.
      for (const r of visualRows) {
        allRows.push([r.map((it) => it.str.trim()).join(" ")]);
      }
      continue;
    }

    const header = visualRows[headerIdx];
    const anchors = header.map((it) => ({
      x: (it.transform?.[4] ?? 0) + (it.width ?? 0) / 2,
      label: it.str.trim(),
    }));

    // Header itself as a row of strings.
    allRows.push(anchors.map((a) => a.label));

    // Data rows: snap each item to nearest anchor.
    for (let i = headerIdx + 1; i < visualRows.length; i++) {
      const row = visualRows[i];
      const cells = new Array(anchors.length).fill("");
      for (const it of row) {
        const x = (it.transform?.[4] ?? 0) + (it.width ?? 0) / 2;
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let k = 0; k < anchors.length; k++) {
          const d = Math.abs(x - anchors[k].x);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = k;
          }
        }
        cells[bestIdx] = cells[bestIdx]
          ? `${cells[bestIdx]} ${it.str.trim()}`
          : it.str.trim();
      }
      if (cells.some((c) => c !== "")) allRows.push(cells);
    }
  }

  return allRows;
}

function looksLikeHeader(rowItems) {
  const blob = rowItems
    .map((it) => it.str.toLowerCase())
    .join(" ");
  if (!/\b(date)\b/.test(blob)) return false;
  return /\b(amount|debit|credit|narration|description|particulars|withdrawal|deposit)\b/.test(
    blob,
  );
}
