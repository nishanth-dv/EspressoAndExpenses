// Central registry of the app's pages.
//
// This app grows page-by-page, so this list is the single source of truth:
// adding an entry here wires the page into the navbar, the mobile drawer, the
// enable/disable controls in Preferences, and the page-settings grouping.
//
// `mandatory` pages (Dashboard, Transactions) are the core of the tracker and
// can't be turned off. Everything else is optional and user-toggleable.

export const APP_PAGES = [
  {
    key: "dashboard",
    open: true,
    label: "Dashboard",
    route: "/Dashboard",
    icon: "fa-chart-pie",
    mandatory: true,
    blurb: "Your money at a glance — trends, insights, charts.",
  },
  {
    key: "transactions",
    open: true,
    label: "Transactions",
    route: "/Transactions",
    icon: "fa-receipt",
    mandatory: true,
    blurb: "The ledger — income, expenses, transfers.",
  },
  {
    key: "investments",
    open: true,
    label: "Investments",
    route: "/Invest",
    icon: "fa-seedling",
    mandatory: false,
    blurb: "Portfolio, SIPs, returns and allocation.",
    tabs: [
      { key: "overview", label: "Overview", icon: "fa-chart-simple" },
      { key: "portfolio", label: "Portfolio", icon: "fa-layer-group" },
    ],
  },
  {
    key: "subscriptions",
    open: true,
    label: "Subscriptions",
    route: "/Subscriptions",
    icon: "fa-rotate",
    mandatory: false,
    blurb: "Recurring charges, renewals and yearly cost.",
  },
  {
    key: "solvency",
    open: true,
    label: "Solvency",
    route: "/Solvency",
    icon: "fa-scale-balanced",
    mandatory: false,
    blurb: "Cards, EMIs, dues and obligations.",
    tabs: [
      { key: "overview", label: "Overview", icon: "fa-gauge-high" },
      { key: "cards", label: "Cards", icon: "fa-credit-card" },
      { key: "commitments", label: "Commitments", icon: "fa-building-columns" },
      { key: "lendings", label: "Lendings", icon: "fa-handshake" },
    ],
  },
  {
    key: "advisory",
    label: "Advisory",
    route: "/Advisory",
    icon: "fa-lightbulb",
    mandatory: false,
    hideFromNav: true,
    blurb: "Investment insights and recommendations.",
    tabs: [
      {
        key: "understand",
        label: "Understand",
        icon: "fa-compass",
        route: "/Advisory/understand",
      },
      {
        key: "review",
        label: "Review",
        icon: "fa-magnifying-glass-chart",
        route: "/Advisory/review",
      },
      {
        key: "actions",
        label: "Actions",
        icon: "fa-list-check",
        route: "/Advisory/actions",
      },
      {
        key: "ask",
        label: "Ask",
        icon: "fa-comments",
        route: "/Advisory/ask",
      },
      {
        key: "grow",
        label: "Grow",
        icon: "fa-arrow-trend-up",
        route: "/Advisory/grow",
      },
    ],
  },
];

export function getPage(key) {
  return APP_PAGES.find((p) => p.key === key) ?? null;
}

// Human label for a routed path (e.g. "/Solvency?highlight=x" → "Solvency"),
// matched on the first path segment against the page registry.
export function labelForPath(path) {
  const seg = "/" + (path || "").split("?")[0].split("/").filter(Boolean)[0];
  const page = APP_PAGES.find((p) => p.route.toLowerCase() === seg.toLowerCase());
  return page?.label ?? "where you were";
}

// Server-controlled access. Pages are GATED BY DEFAULT — a page is public only
// when explicitly marked `open: true`. Every other page (including any added in
// future) needs a per-user DB grant for its key.
export function isPageGated(pageKey) {
  const page = getPage(pageKey);
  return page ? !page.open : true;
}

export function isPageAccessible(pageKey, accessPages) {
  if (!isPageGated(pageKey)) return true;
  return Array.isArray(accessPages) && accessPages.includes(pageKey);
}

// Optional (toggleable) page keys, in registry order.
export const OPTIONAL_PAGE_KEYS = APP_PAGES.filter((p) => !p.mandatory).map(
  (p) => p.key,
);

// Whether a page is currently enabled. Mandatory pages are always on. For
// optional pages we read preferences.enabledPages; when that's absent (older
// data files, or before Drive has loaded) we default to ON so nothing
// disappears unexpectedly.
export function isPageEnabled(pageKey, preferences) {
  const page = getPage(pageKey);
  if (!page) return false;
  if (page.mandatory) return true;
  // Gated pages aren't user-toggleable — server access controls them, so they
  // never go through the enable/disable preference.
  if (!page.open) return true;
  const enabled = preferences?.enabledPages;
  if (!Array.isArray(enabled)) return true;
  return enabled.includes(pageKey);
}

// The pages to show in navigation, in registry order, filtered by enablement.
export function getEnabledPages(preferences) {
  return APP_PAGES.filter((p) => isPageEnabled(p.key, preferences));
}
