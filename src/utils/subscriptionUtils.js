// Subscription domain logic: billing cycles, renewal math, annualized cost,
// auto-detection from ledger history, and anomaly (ghost / price-hike) flags.
//
// A subscription is a recurring fixed charge. Its charges land in the ledger
// as ordinary expense transactions tagged `subscriptionId`, so balance and
// insights math is untouched — this module only reasons ABOUT those charges
// and the renewal schedule; it never mutates state.

// ── Billing cycles ───────────────────────────────────────
// `perYear` lets us normalise everything to a comparable annual figure, the
// single most behaviour-changing number a subscription tracker can show.
export const BILLING_CYCLES = [
  { key: "weekly", label: "Weekly", perYear: 52 },
  { key: "monthly", label: "Monthly", perYear: 12 },
  { key: "quarterly", label: "Quarterly", perYear: 4 },
  { key: "half_yearly", label: "Half-yearly", perYear: 2 },
  { key: "yearly", label: "Yearly", perYear: 1 },
];

export function getCycleInfo(key) {
  return BILLING_CYCLES.find((c) => c.key === key) ?? BILLING_CYCLES[1];
}

export const SUBSCRIPTION_STATUSES = ["active", "trial", "paused", "cancelled"];

// ── Known brands ─────────────────────────────────────────
// A tiny curated map so common services auto-fill an icon + accent colour and
// give the auto-detector something to match merchant names against. Anything
// not here falls back to a generic icon — the feature works fully without it.
//
// `iconStyle` matters: brand glyphs (Spotify, YouTube, Amazon, Apple) only
// exist in FontAwesome's `fa-brands` family. Rendering them with `fa-solid`
// shows an empty box, so each entry declares the style its glyph lives in.
export const KNOWN_BRANDS = [
  { key: "netflix", label: "Netflix", color: "#e50914", icon: "fa-film", iconStyle: "fa-solid", match: ["netflix"] },
  { key: "spotify", label: "Spotify", color: "#1db954", icon: "fa-spotify", iconStyle: "fa-brands", match: ["spotify"] },
  { key: "youtube", label: "YouTube Premium", color: "#ff0000", icon: "fa-youtube", iconStyle: "fa-brands", match: ["youtube", "google youtube", "ytb"] },
  { key: "prime", label: "Amazon Prime", color: "#00a8e1", icon: "fa-amazon", iconStyle: "fa-brands", match: ["prime", "amazon prime", "amznprime"] },
  { key: "hotstar", label: "Disney+ Hotstar", color: "#1f80e0", icon: "fa-star", iconStyle: "fa-solid", match: ["hotstar", "disney"] },
  { key: "apple", label: "Apple", color: "#a2aaad", icon: "fa-apple", iconStyle: "fa-brands", match: ["apple.com", "itunes", "icloud", "apple music"] },
  { key: "jio", label: "JioCinema / JioSaavn", color: "#0a2885", icon: "fa-music", iconStyle: "fa-solid", match: ["jio"] },
  { key: "gym", label: "Gym / Fitness", color: "#ff6b35", icon: "fa-dumbbell", iconStyle: "fa-solid", match: ["cult", "gym", "fitness", "gold's"] },
  { key: "chatgpt", label: "ChatGPT / OpenAI", color: "#10a37f", icon: "fa-robot", iconStyle: "fa-solid", match: ["openai", "chatgpt"] },
  { key: "claude", label: "Claude", color: "#d97757", icon: "fa-feather", iconStyle: "fa-solid", match: ["anthropic", "claude"] },
  { key: "icloud", label: "Cloud Storage", color: "#3693f3", icon: "fa-cloud", iconStyle: "fa-solid", match: ["dropbox", "onedrive", "google one", "icloud+"] },
  { key: "news", label: "News / Reading", color: "#888", icon: "fa-newspaper", iconStyle: "fa-solid", match: ["times", "hindu", "medium", "kindle"] },
];

// The generic identity for a user-defined subscription with no recognised
// brand. Picking this explicitly (or leaving the brand blank) gives a neutral
// "recurring" icon rather than a brand glyph.
export const CUSTOM_BRAND = {
  key: "custom",
  label: "Custom",
  color: "#5b8dee",
  icon: "fa-rotate",
  iconStyle: "fa-solid",
};

export function getBrandInfo(brandKey) {
  if (brandKey === "custom") return CUSTOM_BRAND;
  return KNOWN_BRANDS.find((b) => b.key === brandKey) ?? null;
}

// Curated icon set offered when the user creates their own subscription type.
// All solid glyphs so they render without the brands font.
export const SUBSCRIPTION_ICON_CHOICES = [
  "fa-rotate", "fa-film", "fa-music", "fa-tv", "fa-gamepad", "fa-dumbbell",
  "fa-book-open", "fa-newspaper", "fa-cloud", "fa-robot", "fa-graduation-cap",
  "fa-mug-hot", "fa-utensils", "fa-car", "fa-heart-pulse", "fa-bolt",
  "fa-wifi", "fa-shield-halved", "fa-briefcase", "fa-palette",
];

// Apply a user-defined key order to a list of types. Keys present in `order`
// come first (in that order); anything not listed keeps its natural order at
// the end. Same model as the investment-type ordering.
export function applyTypeOrder(types, order) {
  if (!Array.isArray(order) || order.length === 0) return types;
  const byKey = new Map(types.map((t) => [t.key, t]));
  const seen = new Set();
  const out = [];
  for (const key of order) {
    if (byKey.has(key) && !seen.has(key)) {
      out.push(byKey.get(key));
      seen.add(key);
    }
  }
  for (const t of types) if (!seen.has(t.key)) out.push(t);
  return out;
}

// Resolve a brandKey to its visual definition, checking user-defined
// subscription types first, then the built-in brands / custom sentinel.
export function resolveBrand(brandKey, userTypes = []) {
  if (!brandKey) return null;
  const user = userTypes.find((t) => t.key === brandKey);
  if (user) return user;
  return getBrandInfo(brandKey);
}

// Best-effort brand match from a free-text name (used by the form's auto-fill
// and the detector). Returns the brand key or null.
export function matchBrand(name) {
  const n = String(name ?? "").toLowerCase();
  if (!n) return null;
  for (const b of KNOWN_BRANDS) {
    if (b.match.some((m) => n.includes(m))) return b.key;
  }
  return null;
}

// Visual identity for a subscription — brand colour/icon if known, else a
// stable generic fallback so every card still looks intentional. Always
// returns the correct FontAwesome style family for the chosen glyph.
export function subscriptionVisual(sub, userTypes = []) {
  const brand =
    resolveBrand(sub.brandKey, userTypes) ?? getBrandInfo(matchBrand(sub.name));
  return {
    color: brand?.color ?? CUSTOM_BRAND.color,
    icon: brand?.icon ?? CUSTOM_BRAND.icon,
    iconStyle: brand?.iconStyle ?? CUSTOM_BRAND.iconStyle,
  };
}

// ── Renewal math ─────────────────────────────────────────
function addCycle(date, cycle, n = 1) {
  const d = new Date(date);
  switch (cycle) {
    case "weekly": d.setDate(d.getDate() + 7 * n); break;
    case "quarterly": d.setMonth(d.getMonth() + 3 * n); break;
    case "half_yearly": d.setMonth(d.getMonth() + 6 * n); break;
    case "yearly": d.setFullYear(d.getFullYear() + n); break;
    case "monthly":
    default: d.setMonth(d.getMonth() + n); break;
  }
  return d;
}

// A subscription recurs unless explicitly flagged one-time. Legacy records
// (no `recurring` field) are treated as recurring.
export function isRecurring(sub) {
  return sub?.recurring !== false;
}

// The next charge date on/after `now`, walking forward from the anchor date.
// Returns null if there's no usable anchor. One-time charges never recur, so
// their "next" is simply the anchor date when it's still in the future, else
// null (the single charge has already passed).
export function nextRenewal(sub, now = new Date()) {
  if (!sub?.anchorDate) return null;
  let d = new Date(sub.anchorDate);
  if (Number.isNaN(d.getTime())) return null;
  if (!isRecurring(sub)) return d >= now ? d : null;
  // Walk forward in whole cycles until we're at/after `now`. Capped so a very
  // old anchor with a weekly cycle can't loop unreasonably.
  let guard = 0;
  while (d < now && guard < 5000) {
    d = addCycle(d, sub.cycle, 1);
    guard += 1;
  }
  return d;
}

// The charge date immediately BEFORE `now` (the most recent billing). Used to
// decide whether this cycle's charge has been posted yet, and for ghost/hike
// comparison against the matching ledger entry.
export function previousRenewal(sub, now = new Date()) {
  // One-time: the single charge moment, once its date is reached.
  if (!isRecurring(sub)) {
    if (!sub?.anchorDate) return null;
    const d = new Date(sub.anchorDate);
    if (Number.isNaN(d.getTime())) return null;
    return d <= now ? d : null;
  }
  const next = nextRenewal(sub, now);
  if (!next) return null;
  return addCycle(next, sub.cycle, -1);
}

export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  return Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) /
      86_400_000,
  );
}

// ── Cost normalisation ───────────────────────────────────
// One-time charges carry no ongoing/annualised cost, so they normalise to 0
// and never inflate the recurring monthly/yearly commitment totals.
export function monthlyEquivalent(sub) {
  if (!isRecurring(sub)) return 0;
  const amt = parseFloat(sub?.amount) || 0;
  return (amt * getCycleInfo(sub?.cycle).perYear) / 12;
}

export function annualCost(sub) {
  if (!isRecurring(sub)) return 0;
  const amt = parseFloat(sub?.amount) || 0;
  return amt * getCycleInfo(sub?.cycle).perYear;
}

export function isBilling(sub) {
  return sub?.status === "active" || sub?.status === "trial";
}

// Aggregate spend across the active set, normalised to month + year.
export function subscriptionTotals(subs = []) {
  const billing = subs.filter((x) => isBilling(x) && isRecurring(x));
  const monthly = billing.reduce((s, x) => s + monthlyEquivalent(x), 0);
  return {
    count: billing.length,
    monthly,
    yearly: monthly * 12,
  };
}

// ── Ledger linkage ───────────────────────────────────────
// The posted charges for a subscription, newest first.
export function chargesFor(subId, transactions = []) {
  return transactions
    .filter((t) => t.subscriptionId === subId)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

// Has the current cycle's charge already been posted? Idempotency anchor for
// both the auto-poster and the "Log this charge" CTA.
export function isCurrentCyclePosted(sub, transactions = [], now = new Date()) {
  // One-time: posted the moment any charge exists for it — there's only ever
  // one, so this also stops the auto-poster from re-charging it.
  if (!isRecurring(sub)) return chargesFor(sub.id, transactions).length > 0;
  const prev = previousRenewal(sub, now);
  if (!prev) return false;
  const start = prev.getTime();
  const next = nextRenewal(sub, now);
  const end = next ? next.getTime() : Infinity;
  return chargesFor(sub.id, transactions).some((t) => {
    const ts = new Date(t.occurredAt).getTime();
    return ts >= start && ts < end;
  });
}

// ── Anomaly detection (the "surprise" insight layer) ─────
// Two flags worth a user's attention:
//   • hike  — the latest posted charge is higher than the previous one
//             (silent price increase) OR higher than the tracked amount.
//   • ghost — a charge was expected within the lookback window but none was
//             posted (cancelled-but-still-tracked, failed payment, or simply
//             un-logged). Only meaningful once a subscription has a history.
export function detectAnomaly(sub, transactions = [], now = new Date()) {
  const charges = chargesFor(sub.id, transactions);
  const flags = [];

  if (charges.length >= 2) {
    const latest = parseFloat(charges[0].amount) || 0;
    const prior = parseFloat(charges[1].amount) || 0;
    if (latest > prior + 0.5) {
      flags.push({
        kind: "hike",
        from: prior,
        to: latest,
        message: `Charge rose from ₹${Math.round(prior)} to ₹${Math.round(latest)}`,
      });
    }
  } else if (charges.length === 1) {
    const latest = parseFloat(charges[0].amount) || 0;
    const tracked = parseFloat(sub.amount) || 0;
    if (tracked > 0 && latest > tracked + 0.5) {
      flags.push({
        kind: "hike",
        from: tracked,
        to: latest,
        message: `Charged ₹${Math.round(latest)} vs tracked ₹${Math.round(tracked)}`,
      });
    }
  }

  // Ghost: billing subscription whose previous expected charge is in the past
  // by more than a small grace window, with no posted charge for that cycle.
  if (isBilling(sub) && charges.length > 0) {
    const prev = previousRenewal(sub, now);
    const grace = 3; // days
    if (prev && daysUntil(prev, now) < -grace && !isCurrentCyclePosted(sub, transactions, now)) {
      flags.push({
        kind: "ghost",
        expectedOn: prev,
        message: "Expected a charge but none was logged",
      });
    }
  }

  return flags;
}

// ── Trial guard ──────────────────────────────────────────
export function trialStatus(sub, now = new Date()) {
  if (sub?.status !== "trial" || !sub?.trialEndsOn) return null;
  const days = daysUntil(sub.trialEndsOn, now);
  return {
    days,
    endsOn: new Date(sub.trialEndsOn),
    firstCharge: parseFloat(sub.amount) || 0,
    soon: days != null && days <= 3,
  };
}

// ── Auto-detection from ledger history ───────────────────
// Clusters past expense transactions by normalised name and surfaces those
// that look recurring (>= MIN_HITS occurrences at a roughly stable amount,
// across distinct months) and aren't already tracked. Pre-fills amount, a
// best-guess cycle, brand, and an anchor date for one-tap conversion.
const MIN_HITS = 2;

function normaliseName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function detectCandidates(transactions = [], existingSubs = []) {
  const trackedNames = new Set(
    existingSubs.map((s) => normaliseName(s.name)),
  );

  const groups = new Map();
  transactions
    .filter(
      (t) =>
        t.transactionType === "expense" &&
        !t.subscriptionId &&
        String(t.category ?? "").toLowerCase() !== "food",
    )
    .forEach((t) => {
      const key = normaliseName(t.name);
      if (!key || trackedNames.has(key)) return;
      if (!groups.has(key)) groups.set(key, { name: t.name, items: [] });
      groups.get(key).items.push(t);
    });

  const candidates = [];
  for (const { name, items } of groups.values()) {
    if (items.length < MIN_HITS) continue;

    // Distinct year-month buckets — a real subscription recurs across months,
    // not 5 charges in one week (that's a coffee habit, not Netflix).
    const months = new Set(
      items.map((t) => {
        const d = new Date(t.occurredAt);
        return `${d.getFullYear()}-${d.getMonth()}`;
      }),
    );
    if (months.size < MIN_HITS) continue;

    const amounts = items.map((t) => parseFloat(t.amount) || 0);
    const typical = median(amounts);
    // Reject clusters with wildly varying amounts (likely not a fixed fee).
    const spread = typical > 0 ? mad(amounts, typical) / typical : 1;
    if (spread > 0.25) continue;

    const sorted = [...items].sort(
      (a, b) => new Date(a.occurredAt) - new Date(b.occurredAt),
    );
    const cycle = inferCycle(sorted.map((t) => new Date(t.occurredAt)));
    const last = sorted[sorted.length - 1];

    candidates.push({
      name,
      amount: Math.round(typical),
      cycle,
      brandKey: matchBrand(name),
      category: last.category || "Entertainment",
      anchorDate: new Date(last.occurredAt).toISOString().slice(0, 10),
      hits: items.length,
      months: months.size,
    });
  }

  return candidates.sort((a, b) => b.months - a.months || b.hits - a.hits);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mad(nums, center) {
  if (!nums.length) return 0;
  return median(nums.map((n) => Math.abs(n - center)));
}

// Infer a billing cycle from the median gap between consecutive charges.
function inferCycle(dates) {
  if (dates.length < 2) return "monthly";
  const gaps = [];
  for (let i = 1; i < dates.length; i += 1) {
    gaps.push((dates[i] - dates[i - 1]) / 86_400_000);
  }
  const g = median(gaps);
  if (g <= 10) return "weekly";
  if (g <= 45) return "monthly";
  if (g <= 135) return "quarterly";
  if (g <= 250) return "half_yearly";
  return "yearly";
}
