/* global google */

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0; // ms timestamp

export function clearAccessToken() {
  accessToken = null;
  tokenExpiry = 0;
  tokenClient = null;
}

function isTokenValid() {
  return !!(accessToken && Date.now() < tokenExpiry - 60_000); // 60s safety buffer
}

export function getAccessToken() {
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: () => {},
    });
  }

  return new Promise((resolve, reject) => {
    if (isTokenValid()) {
      resolve(accessToken);
      return;
    }

    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      accessToken = response.access_token;
      tokenExpiry = Date.now() + (response.expires_in ?? 3600) * 1000;
      resolve(accessToken);
    };

    tokenClient.requestAccessToken({ prompt: "" });
  });
}

// Wraps a Drive fetch: injects the Bearer token and retries once on 401.
async function driveRequest(url, options = {}, _retry = true) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && _retry) {
    // Token was rejected server-side — clear and get a fresh one.
    accessToken = null;
    tokenExpiry = 0;
    return driveRequest(url, options, false);
  }

  return res;
}

export async function createOrFetchFile(fileName, initialData) {
  const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const searchRes = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`
  );
  const { files } = await searchRes.json();

  if (!files || files.length === 0) {
    const metadata = { name: fileName, mimeType: "application/json" };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([JSON.stringify(initialData, null, 2)], { type: "application/json" }));

    const uploadRes = await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", body: form }
    );
    const created = await uploadRes.json();
    return { fileId: created.id, data: initialData, created: true };
  }

  const fileId = files[0].id;
  const downloadRes = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  const data = await downloadRes.json();
  return { fileId, data, created: false };
}

export async function updateFile(fileId, updatedData) {
  await driveRequest(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedData, null, 2),
    }
  );
}
