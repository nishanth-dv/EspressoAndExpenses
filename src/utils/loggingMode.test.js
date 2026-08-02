import assert from "node:assert/strict";
import { suggestedLogMode, resolveLogMode } from "./loggingMode.js";

// The bug: a schedule saved with `enabled` but no `mode` resolved to "manual",
// so the InvestmentPage scheduler skipped it no matter what the form showed.
assert.equal(resolveLogMode({ type: "rd", autoDeduct: { enabled: true } }), "manual");
assert.equal(
  resolveLogMode({ type: "rd", autoDeduct: { enabled: true, mode: "auto" } }),
  "auto",
);

// suggestedLogMode is what the form paints as selected — and now stores.
assert.equal(suggestedLogMode("rd"), "auto");
assert.equal(suggestedLogMode("apy"), "manual");
assert.equal(suggestedLogMode("ppf"), "manual", "off collapses to manual");
assert.equal(suggestedLogMode("chit_fund", { defaultMode: "auto" }), "auto");
assert.equal(suggestedLogMode("unknown_custom_type"), "manual");

// An explicit choice must outrank the suggestion, in both directions.
assert.equal(
  resolveLogMode({ type: "rd", autoDeduct: { enabled: true, mode: "off" } }),
  "off",
);
assert.equal(resolveLogMode({ type: "sip" }), "auto");
assert.equal(resolveLogMode({ type: "fd" }), "off");

// The backfill's derivation, applied to the shape it repairs.
const backfill = (inv, config) => ({
  ...inv,
  autoDeduct: { ...inv.autoDeduct, mode: suggestedLogMode(inv.type, config) },
});
const stale = { autoDeduct: { enabled: true, frequency: "monthly" } };

assert.equal(resolveLogMode(backfill({ ...stale, type: "apy" })), "manual");
assert.equal(resolveLogMode(backfill({ ...stale, type: "rd" })), "auto");
assert.equal(
  resolveLogMode(backfill({ ...stale, type: "custom" }, { defaultMode: "auto" })),
  "auto",
  "a designer default of auto must survive the round trip",
);

console.log("loggingMode: all assertions passed");
