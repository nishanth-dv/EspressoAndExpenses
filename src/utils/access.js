import { getAccessToken } from "./googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

export async function fetchPageAccess() {
  const token = await getAccessToken();
  const res = await fetch(`${API}/access`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`access ${res.status}`);
  const body = await res.json();
  return {
    pages: Array.isArray(body.pages) ? body.pages : [],
    isAdmin: !!body.isAdmin,
  };
}
