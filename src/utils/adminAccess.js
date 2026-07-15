import { getAccessToken } from "./googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

async function authed(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return res.json();
}

export async function listGrants() {
  const body = await authed("/admin/access");
  return Array.isArray(body.grants) ? body.grants : [];
}

export async function saveGrant(email, pages) {
  return authed("/admin/access", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pages }),
  });
}

export async function revokeGrant(email) {
  return authed(`/admin/access?email=${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}
