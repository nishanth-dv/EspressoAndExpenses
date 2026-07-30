// Runnable self-check for resolveShortcuts — the gating + de-dupe rules behind
// the Actions launcher's shortcut group. No test framework in this repo; run:
//   node src/utils/shortcuts.test.js
import assert from "node:assert/strict";
import { resolveShortcuts, shortcutPath, SHORTCUT_LIMIT } from "./shortcuts.js";
import { getPage } from "./pages.js";

const ALL_ACCESS = ["advisory"];
const ctx = (preferences = {}, accessPages = ALL_ACCESS) => ({
  preferences,
  accessPages,
});

// Page-level and tab-level entries resolve, in stored order.
const basic = resolveShortcuts(
  [{ page: "solvency", tab: "cards" }, { page: "dashboard" }],
  ctx(),
);
assert.equal(basic.length, 2, "both entries resolve");
assert.equal(basic[0].path, "/Solvency?tab=cards", "tab → ?tab= path");
assert.equal(basic[0].label, "Solvency · Cards", "tab label is page · tab");
assert.equal(basic[1].path, "/Dashboard", "page-level → bare route");

// Advisory lenses are real sub-routes, not ?tab=.
assert.equal(
  resolveShortcuts([{ page: "advisory", tab: "review" }], ctx())[0].path,
  "/Advisory/review",
  "explicit tab route wins over ?tab=",
);

// A gated page with no server grant is hidden...
assert.deepEqual(
  resolveShortcuts([{ page: "advisory", tab: "review" }], ctx({}, [])),
  [],
  "no grant → hidden",
);
// ...but the stored entry is never rewritten, so a re-grant restores it.
const stored = [{ page: "advisory", tab: "review" }];
resolveShortcuts(stored, ctx({}, []));
assert.equal(stored.length, 1, "resolve must not mutate stored config");
assert.equal(
  resolveShortcuts(stored, ctx()).length,
  1,
  "re-granting access restores the shortcut",
);

// A user-disabled optional page is hidden.
assert.deepEqual(
  resolveShortcuts(
    [{ page: "solvency", tab: "cards" }],
    ctx({ enabledPages: ["investments"] }),
  ),
  [],
  "page disabled in preferences → hidden",
);

// Unknown page, unknown tab, and duplicates are dropped.
assert.deepEqual(resolveShortcuts([{ page: "nope" }], ctx()), [], "unknown page");
assert.deepEqual(
  resolveShortcuts([{ page: "solvency", tab: "ghost" }], ctx()),
  [],
  "unknown tab",
);
assert.equal(
  resolveShortcuts(
    [{ page: "solvency", tab: "cards" }, { page: "solvency", tab: "cards" }],
    ctx(),
  ).length,
  1,
  "duplicates collapse",
);
// Page-level and tab-level on the same page are distinct entries.
assert.equal(
  resolveShortcuts(
    [{ page: "solvency" }, { page: "solvency", tab: "cards" }],
    ctx(),
  ).length,
  2,
  "page-level and tab-level don't collide",
);

// Cap enforced; junk input is inert.
assert.equal(
  resolveShortcuts(
    Array.from({ length: 10 }, (_, i) => ({
      page: "solvency",
      tab: ["overview", "cards", "commitments", "lendings"][i % 4],
    })),
    ctx(),
  ).length,
  4,
  "de-dupe then cap — 4 distinct solvency tabs",
);
assert.equal(
  resolveShortcuts(
    [
      { page: "solvency", tab: "overview" },
      { page: "solvency", tab: "cards" },
      { page: "solvency", tab: "commitments" },
      { page: "solvency", tab: "lendings" },
      { page: "advisory", tab: "review" },
      { page: "advisory", tab: "ask" },
      { page: "dashboard" },
    ],
    ctx(),
  ).length,
  SHORTCUT_LIMIT,
  "stops at the cap",
);
assert.deepEqual(resolveShortcuts(null, ctx()), [], "null → empty");
assert.deepEqual(resolveShortcuts("x", ctx()), [], "non-array → empty");
assert.deepEqual(resolveShortcuts([null, {}], ctx()), [], "junk entries skipped");

// shortcutPath is the single place a target becomes a URL.
assert.equal(shortcutPath(getPage("transactions"), null), "/Transactions");

console.log("shortcuts.test.js: all assertions passed");
