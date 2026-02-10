/* global google */

let tokenClient = null;
let accessToken = null;

export function getAccessToken() {
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        accessToken = response.access_token;
      },
    });
  }

  return new Promise((resolve) => {
    if (accessToken) {
      resolve(accessToken);
    } else {
      tokenClient.callback = (response) => {
        accessToken = response.access_token;
        resolve(accessToken);
      };

      // 👇 silent if already granted, popup only first time
      tokenClient.requestAccessToken({ prompt: "" });
    }
  });
}

export async function createOrFetchFile(fileName, initialData) {
  const token = await getAccessToken();

  const query = encodeURIComponent(`name='${fileName}' and trashed=false`);

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const { files } = await searchRes.json();

  // ───────────── FILE DOES NOT EXIST ─────────────
  if (!files || files.length === 0) {
    const metadata = {
      name: fileName,
      mimeType: "application/json",
    };

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], {
        type: "application/json",
      })
    );
    form.append(
      "file",
      new Blob([JSON.stringify(initialData, null, 2)], {
        type: "application/json",
      })
    );

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }
    );

    const created = await uploadRes.json();

    return {
      fileId: created.id,
      data: initialData,
      created: true,
    };
  }

  // ───────────── FILE EXISTS ─────────────
  const fileId = files[0].id;

  const downloadRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await downloadRes.json();

  return {
    fileId,
    data,
    created: false,
  };
}

export async function updateFile(fileId, updatedData) {
  const token = await getAccessToken();

  await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updatedData, null, 2),
    }
  );
}
