import { APP_PAGES, getPage, isPageAccessible, isPageEnabled } from "./pages.js";

export const SHORTCUT_LIMIT = 6;

export function shortcutKey(entry) {
  return `${entry?.page ?? ""}:${entry?.tab || "page"}`;
}

function findTab(page, tabKey) {
  if (!tabKey) return null;
  return (page.tabs ?? []).find((t) => t.key === tabKey) ?? null;
}

export function shortcutPath(page, tab) {
  if (!tab) return page.route;
  return tab.route ?? `${page.route}?tab=${tab.key}`;
}

export function listShortcutTargets({ preferences, accessPages }) {
  return APP_PAGES.filter(
    (page) =>
      isPageAccessible(page.key, accessPages) &&
      isPageEnabled(page.key, preferences),
  ).map((page) => ({
    key: page.key,
    label: page.label,
    icon: page.icon,
    blurb: page.blurb,
    tabs: page.tabs ?? [],
  }));
}

export function describeShortcut(entry, { preferences, accessPages } = {}) {
  const page = getPage(entry?.page);
  if (!page) return null;
  const tab = findTab(page, entry.tab);
  if (entry.tab && !tab) return null;
  const granted = isPageAccessible(page.key, accessPages);
  const enabled = isPageEnabled(page.key, preferences);
  return {
    key: shortcutKey(entry),
    page: page.key,
    tab: tab?.key ?? "",
    label: tab ? `${page.label} · ${tab.label}` : page.label,
    sub: page.blurb,
    icon: tab?.icon ?? page.icon,
    path: shortcutPath(page, tab),
    available: granted && enabled,
    unavailableReason: !granted
      ? "No access"
      : !enabled
        ? "Page turned off"
        : "",
  };
}

export function resolveShortcuts(stored, ctx = {}) {
  if (!Array.isArray(stored)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of stored) {
    const info = describeShortcut(entry, ctx);
    if (!info || !info.available) continue;
    if (seen.has(info.key)) continue;
    seen.add(info.key);
    out.push(info);
    if (out.length === SHORTCUT_LIMIT) break;
  }
  return out;
}
