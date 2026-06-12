// Maps a recognised payment mode to common spoken aliases. Brave/Safari often
// transcribe "UPI" as "u p i" or "you pee eye" etc. — these are best-effort.
const PAYMENT_ALIASES = {
  Cash: ["cash"],
  UPI: ["upi", "u p i", "gpay", "google pay", "phonepe", "phone pe", "paytm", "bhim"],
  "Debit Card": ["debit card", "debit"],
  "Credit Card": ["credit card", "credit"],
  Other: ["other"],
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchAndStrip(workingRef, candidates) {
  // candidates: array of strings to match as whole words (case-insensitive).
  // Returns the first match (in candidates' original case) and strips it.
  for (const cand of candidates) {
    if (!cand) continue;
    const re = new RegExp(`\\b${escapeRegex(cand)}\\b`, "i");
    if (re.test(workingRef.value)) {
      workingRef.value = workingRef.value.replace(
        new RegExp(`\\b${escapeRegex(cand)}\\b`, "gi"),
        " ",
      );
      return cand;
    }
  }
  return null;
}

function pad(n) {
  return n.toString().padStart(2, "0");
}

function toDateTimeLocal(date) {
  // datetime-local input wants "YYYY-MM-DDTHH:mm" in local time
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Parses a free-form transcript into structured transaction fields.
// `categories` and `paymentModes` are the user's current valid options;
// the parser matches case-insensitively, falling back to known aliases for
// payment modes only. Date/time defaults to now if nothing is mentioned.
export function parseVoiceTranscript(text, options = {}) {
  const { categories = [], paymentModes = [] } = options;
  const result = {
    transcript: text ?? "",
    name: "",
    amount: "",
    category: "",
    paymentMode: "",
    occurredAt: toDateTimeLocal(new Date()),
  };
  if (!text) return result;

  // Use a ref-shaped object so helpers can mutate `working` in place.
  const working = { value: text.replace(/[,]/g, " ").trim() };

  // 1. Amount — first standalone number.
  const numMatch = working.value.match(/\b(\d+(?:\.\d+)?)\b/);
  if (numMatch) {
    result.amount = numMatch[1];
    working.value = working.value.replace(numMatch[0], " ");
  }

  // 2. Date — relative day keywords.
  const now = new Date();
  let dayOffset = 0;
  let dayMatched = false;
  const dayPatterns = [
    { re: /\bday\s+before\s+yesterday\b/i, days: -2 },
    { re: /\byesterday\b/i, days: -1 },
    { re: /\btoday\b/i, days: 0 },
    { re: /\btomorrow\b/i, days: 1 },
  ];
  for (const { re, days } of dayPatterns) {
    if (re.test(working.value)) {
      dayOffset = days;
      dayMatched = true;
      working.value = working.value.replace(re, " ");
      break;
    }
  }
  if (!dayMatched) {
    const daysAgo = working.value.match(/\b(\d+)\s+days?\s+ago\b/i);
    if (daysAgo) {
      dayOffset = -parseInt(daysAgo[1]);
      dayMatched = true;
      working.value = working.value.replace(daysAgo[0], " ");
    }
  }

  // 3. Time — "at 7pm", "at 7:30pm", "at 19:30", "7pm".
  let hours = now.getHours();
  let minutes = now.getMinutes();
  let timeMatched = false;
  const ampm = working.value.match(
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2] ? parseInt(ampm[2]) : 0;
    const meridiem = ampm[3].toLowerCase();
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    hours = h;
    minutes = m;
    timeMatched = true;
    working.value = working.value.replace(ampm[0], " ");
  } else {
    const t24 = working.value.match(/\bat\s+(\d{1,2}):(\d{2})\b/);
    if (t24) {
      hours = parseInt(t24[1]);
      minutes = parseInt(t24[2]);
      timeMatched = true;
      working.value = working.value.replace(t24[0], " ");
    }
  }

  if (dayMatched || timeMatched) {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, minutes, 0, 0);
    result.occurredAt = toDateTimeLocal(d);
  }

  // 4. Payment mode — exact mode names first, then known aliases.
  for (const mode of paymentModes) {
    const direct = matchAndStrip(working, [mode]);
    if (direct) {
      result.paymentMode = mode;
      break;
    }
    const aliases = PAYMENT_ALIASES[mode];
    if (aliases && matchAndStrip(working, aliases)) {
      result.paymentMode = mode;
      break;
    }
  }

  // 5. Category — explicit "under <category>" wins over substring match
  //    so phrases like "200 for groceries under household" work.
  const underMatch = working.value.match(/\bunder\s+([\w\s&]+?)(?:$|\s+(?:on|at|for|via|by|using|the)\b)/i);
  if (underMatch) {
    const candidate = underMatch[1].trim();
    const found = categories.find(
      (c) => c.toLowerCase() === candidate.toLowerCase(),
    );
    if (found) {
      result.category = found;
      working.value = working.value.replace(underMatch[0], " ");
    }
  }
  if (!result.category) {
    const cat = matchAndStrip(working, categories);
    if (cat) result.category = cat;
  }

  // 6. Whatever's left → name, after stripping connector words.
  //    Currency *symbols* (₹ $ € £ ¥) are non-word characters and don't
  //    play well with \b boundaries, so strip them as literals first;
  //    then strip the currency *words* with a normal word-boundary regex.
  result.name = working.value
    .replace(/[₹$€£¥]/g, " ")
    .replace(/\b(rs|rupees?|inr|usd|eur|gbp)\b/gi, " ")
    .replace(/\b(for|on|at|in|paid|spent|of|via|by|using|under|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If everything else was consumed and there's no name, fall back to the
  // category (e.g. "1000 salary today" → name "salary").
  if (!result.name && result.category) result.name = result.category;

  return result;
}
