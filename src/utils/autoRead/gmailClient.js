// Minimal Gmail REST reader. Reuses the Drive OAuth access token (same Google
// session) — needs the gmail.readonly scope granted. Throws a tagged
// "gmail-scope" error on 403 so callers can prompt a re-grant.
import { getAccessToken } from "../googleDrive";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmailRequest(path) {
  const token = await getAccessToken();
  const res = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 403) {
    const err = new Error("gmail-scope");
    err.code = "gmail-scope";
    throw err;
  }
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  return res.json();
}

export async function listMessages(query, max = 25) {
  const data = await gmailRequest(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
  );
  return data.messages ?? [];
}

function decodeB64Url(s) {
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(norm);
    return decodeURIComponent(
      bin
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeB64Url(payload.body.data);
  }
  if (payload.parts?.length) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeB64Url(plain.body.data);
    for (const part of payload.parts) {
      const t = extractText(part);
      if (t) return t;
    }
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) return stripHtml(decodeB64Url(html.body.data));
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return stripHtml(decodeB64Url(payload.body.data));
  }
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  return "";
}

export async function getMessage(id) {
  const m = await gmailRequest(`/messages/${id}?format=full`);
  const headers = m.payload?.headers ?? [];
  const header = (name) =>
    headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  return {
    id,
    from: header("from"),
    subject: header("subject"),
    text: extractText(m.payload) || m.snippet || "",
    internalDate: m.internalDate ? Number(m.internalDate) : Date.now(),
  };
}
