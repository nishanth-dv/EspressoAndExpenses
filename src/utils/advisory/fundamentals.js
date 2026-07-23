import { getAccessToken } from "../googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

export async function fetchFundamentals(symbols) {
  const list = [...new Set((symbols ?? []).filter(Boolean))];
  if (!API || list.length === 0) return {};
  try {
    const token = await getAccessToken();
    if (!token) return {};
    const res = await fetch(`${API}/fundamentals?symbols=${encodeURIComponent(list.join(","))}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return {};
    const data = await res.json();
    return data.fundamentals ?? {};
  } catch {
    return {};
  }
}
