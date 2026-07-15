import { getAccessToken } from "./googleDrive";

const API = import.meta.env.VITE_API_URL ?? "";

function operationName(query) {
  const m = /\b(?:query|mutation)\s+([A-Za-z0-9_]+)/.exec(query);
  return m ? m[1] : "graphql";
}

export async function gql(query, variables) {
  const token = await getAccessToken();
  const res = await fetch(`${API}/graphql?${operationName(query)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}
