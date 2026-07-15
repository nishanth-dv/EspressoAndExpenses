export function dbEnabled(email) {
  const csv = import.meta.env.VITE_DB_USERS ?? "";
  if (!email) return false;
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export function currentEmail() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.email ?? "";
  } catch {
    return "";
  }
}
