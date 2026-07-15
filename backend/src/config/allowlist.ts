export function isAllowed(
  email: string | undefined,
  csv: string | undefined,
): boolean {
  if (!email || !csv) return false;
  const set = new Set(
    csv
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(email.toLowerCase());
}
