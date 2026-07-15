const NUM_CHAR = /[0-9.,]/;

function caretAt(x, y) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) return { node: r.startContainer, offset: r.startOffset };
  }
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) return { node: p.offsetNode, offset: p.offset };
  }
  return null;
}

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function signHint(node) {
  let el = node.parentElement;
  for (let i = 0; el && i < 5; i += 1, el = el.parentElement) {
    const c = String(el.className || "").toLowerCase();
    if (c.includes("expense") || c.includes("amount-investment")) return -1;
    if (c.includes("income")) return 1;
  }
  return 1;
}

function nearestLabel(node, token) {
  let el = node.parentElement;
  for (let i = 0; el && i < 5; i += 1, el = el.parentElement) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return clean(aria).slice(0, 48);
    const name =
      el.querySelector &&
      el.querySelector(
        ".transaction-name, .sol-card-name, .bank-split-name, .pref-multibank-name, .insight-label, .cat-name",
      );
    if (name && name.textContent) return clean(name.textContent).slice(0, 48);
  }
  const parentText = clean(node.parentElement && node.parentElement.textContent);
  const withoutToken = clean(parentText.replace(token, ""));
  return (withoutToken || parentText).slice(0, 48);
}

// Reads the number the user tapped at (clientX, clientY) using the caret APIs,
// expands to the full number token, and returns its value, a context label and
// the on-screen rect (for the capture flash). Returns null when there's no
// number under the point.
export function captureNumberAt(x, y) {
  const pos = caretAt(x, y);
  if (!pos || !pos.node || pos.node.nodeType !== 3) return null;

  const text = pos.node.textContent || "";
  let start = pos.offset;
  let end = pos.offset;
  while (start > 0 && NUM_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && NUM_CHAR.test(text[end])) end += 1;

  let token = text.slice(start, end).replace(/^[.,]+|[.,]+$/g, "");
  if (!/\d/.test(token)) return null;

  const value = parseFloat(token.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  let rect = null;
  try {
    const r = document.createRange();
    r.setStart(pos.node, start);
    r.setEnd(pos.node, Math.min(end, text.length));
    rect = r.getBoundingClientRect();
  } catch {
    rect = null;
  }

  const sourceKey = rect
    ? `${value}|${Math.round(rect.left)}x${Math.round(rect.top)}`
    : `${value}|${start}|${text.slice(0, 16)}`;

  return {
    value,
    label: nearestLabel(pos.node, token),
    hint: signHint(pos.node),
    sourceKey,
    rect,
  };
}
