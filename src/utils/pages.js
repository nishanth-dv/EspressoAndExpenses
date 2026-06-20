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
    label: "Dashboard",
    route: "/Dashboard",
    icon: "fa-chart-pie",
    mandatory: true,
    blurb: "Your money at a glance — trends, insights, charts.",
  },
  {
    key: "transactions",
    label: "Transactions",
    route: "/Transactions",
    icon: "fa-receipt",
    mandatory: true,
    blurb: "The ledger — income, expenses, transfers.",
  },
  {
    key: "investments",
    label: "Investments",
    route: "/Invest",
    icon: "fa-seedling",
    mandatory: false,
    blurb: "Portfolio, SIPs, returns and allocation.",
  },
  {
    key: "subscriptions",
    label: "Subscriptions",
    route: "/Subscriptions",
    icon: "fa-rotate",
    mandatory: false,
    blurb: "Recurring charges, renewals and yearly cost.",
  },
  {
    key: "solvency",
    label: "Solvency",
    route: "/Solvency",
    icon: "fa-scale-balanced",
    mandatory: false,
    blurb: "Cards, EMIs, dues and obligations.",
  },
];

export function getPage(key) {
  return APP_PAGES.find((p) => p.key === key) ?? null;
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
  const enabled = preferences?.enabledPages;
  if (!Array.isArray(enabled)) return true;
  return enabled.includes(pageKey);
}

// The pages to show in navigation, in registry order, filtered by enablement.
export function getEnabledPages(preferences) {
  return APP_PAGES.filter((p) => isPageEnabled(p.key, preferences));
}
