// Returns the first matching auto-category rule's category for a given
// transaction name + scope, or null if nothing matches.
// Rules are matched case-insensitively by substring; first rule wins.
export function matchAutoCategory(name, scope, rules) {
  if (!name || !rules?.length) return null;
  const needle = name.toLowerCase().trim();
  if (!needle) return null;
  for (const rule of rules) {
    if (rule.scope !== scope) continue;
    const pattern = (rule.pattern ?? "").toLowerCase().trim();
    if (!pattern) continue;
    if (needle.includes(pattern)) return rule.category;
  }
  return null;
}
