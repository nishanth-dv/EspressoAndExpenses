import { getAccessToken } from "../googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

export async function fetchMarket() {
  const token = await getAccessToken();
  const res = await fetch(`${API}/advisory/market`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`market ${res.status}`);
  const body = await res.json();
  const rates = {};
  for (const r of body.rates ?? []) rates[r.key] = r;
  return { rates };
}
