/* global google */

// Identity + Drive + read-only Gmail (for auto-capture of bank/UPI alert
// mails) in one scope set so the user only ever sees one Google popup.
const SCOPES =
  "openid profile email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly";

const LS_TOKEN = "gapi_access_token";
const LS_EXPIRY = "gapi_token_expiry";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

// Restore token from localStorage so the app survives tab close / reopen.
{
  const stored = localStorage.getItem(LS_TOKEN);
  const expiry = Number(localStorage.getItem(LS_EXPIRY) || 0);
  if (stored && expiry > Date.now()) {
    accessToken = stored;
    tokenExpiry = expiry;
  }
}

function saveToken(token, expiresIn) {
  accessToken = token;
  tokenExpiry = Date.now() + (expiresIn ?? 3600) * 1000;
  localStorage.setItem(LS_TOKEN, accessToken);
  localStorage.setItem(LS_EXPIRY, String(tokenExpiry));
}

function getUserEmail() {
  try {
    return JSON.parse(localStorage.getItem("user"))?.email || "";
  } catch {
    return "";
  }
}

function waitForGoogle() {
  if (window.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("needs-reconnect"));
    const timer = setTimeout(fail, 10_000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const script = document.querySelector(
      'script[src*="accounts.google.com/gsi"]',
    );
    if (script) {
      script.addEventListener("load", done, { once: true });
      script.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          fail();
        },
        { once: true },
      );
    } else {
      const id = setInterval(() => {
        if (window.google) {
          clearInterval(id);
          done();
        }
      }, 50);
    }
  });
}

function initClient() {
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: () => {},
    });
  }
}

export function clearAccessToken() {
  accessToken = null;
  tokenExpiry = 0;
  tokenClient = null;
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_EXPIRY);
}

function isTokenValid() {
  return !!(accessToken && Date.now() < tokenExpiry - 60_000);
}

// Called by the login button. Shows account picker, returns user info.
export async function loginWithGoogle() {
  await waitForGoogle();
  initClient();
  return new Promise((resolve, reject) => {
    tokenClient.callback = async (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      saveToken(response.access_token, response.expires_in);
      try {
        const res = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        const info = await res.json();
        resolve({
          name: info.name,
          email: info.email,
          picture: info.picture,
          sub: info.id,
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

// Called by the reconnect button — must be triggered by a direct user tap
// so iOS WebKit permits the OAuth popup.
export async function reconnectDrive() {
  await waitForGoogle();
  initClient();
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error));
        return;
      }
      saveToken(response.access_token, response.expires_in);
      resolve();
    };
    tokenClient.requestAccessToken({
      prompt: "select_account",
      hint: getUserEmail(),
    });
  });
}

// Used internally by Drive calls. Attempts silent refresh; throws "needs-reconnect"
// when the browser (e.g. iOS WebKit) blocks the silent iframe so callers can
// show a reconnect prompt instead of a full logout.
export async function getAccessToken() {
  await waitForGoogle();
  initClient();
  return new Promise((resolve, reject) => {
    if (isTokenValid()) {
      resolve(accessToken);
      return;
    }

    // Brave (and iOS WebKit) silently drop the hidden-iframe used for prompt:""
    // silent refresh, leaving the callback unfired and the Promise hanging forever.
    // Treat no response within 6 s as a reconnect signal.
    const timeout = setTimeout(() => {
      const err = new Error("needs-reconnect");
      err.code = "needs-reconnect";
      reject(err);
    }, 6000);

    tokenClient.callback = (response) => {
      clearTimeout(timeout);
      if (response.error) {
        const err = new Error("needs-reconnect");
        err.code = "needs-reconnect";
        reject(err);
        return;
      }
      saveToken(response.access_token, response.expires_in);
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: "", hint: getUserEmail() });
  });
}

async function driveRequest(url, options = {}, _retry = true) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && _retry) {
    clearAccessToken();
    return driveRequest(url, options, false);
  }
  return res;
}

export async function createOrFetchFile(fileName, initialData) {
  const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const searchRes = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
  );
  const { files } = await searchRes.json();

  if (!files || files.length === 0) {
    const metadata = { name: fileName, mimeType: "application/json" };
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    );
    form.append(
      "file",
      new Blob([JSON.stringify(initialData, null, 2)], {
        type: "application/json",
      }),
    );
    const uploadRes = await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", body: form },
    );
    const created = await uploadRes.json();
    return { fileId: created.id, data: initialData, created: true };
  }

  const fileId = files[0].id;
  const downloadRes = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
  );
  const data = await downloadRes.json();
  return { fileId, data, created: false };
}

const SAVE_ATTEMPTS = 3;

export async function updateFile(fileId, updatedData) {
  let lastErr;
  for (let i = 0; i < SAVE_ATTEMPTS; i += 1) {
    try {
      const res = await driveRequest(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedData, null, 2),
        },
      );
      if (!res.ok) throw new Error(`Drive save failed (${res.status})`);
      return;
    } catch (e) {
      lastErr = e;
      if (i < SAVE_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** i));
      }
    }
  }
  throw lastErr;
}
