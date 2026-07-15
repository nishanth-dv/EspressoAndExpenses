import * as drive from "../googleDrive";
import { dbEnabled, currentEmail } from "./allowlist";
import { gql } from "../graphql";

const CORE_DATA = `query CoreData { coreData }`;
const SYNC_ALL = `mutation SyncAll($data: JSON!) { syncAll(data: $data) { id updatedAt } }`;
const UPSERT_ALL = `mutation UpsertAll($data: JSON!) { upsertAll(data: $data) { id updatedAt } }`;

function dbActive() {
  return dbEnabled(currentEmail());
}

export async function createOrFetchFile(fileName, initialData) {
  if (!dbActive()) return drive.createOrFetchFile(fileName, initialData);

  const res = await gql(CORE_DATA);
  const data = res.coreData;
  if (data && data.preferences != null) {
    return {
      fileId: "db",
      data: { transactions: [], investments: [], ...data },
    };
  }

  const seed = await drive.createOrFetchFile(fileName, initialData);
  await gql(SYNC_ALL, { data: seed.data });
  return { fileId: "db", data: seed.data };
}

export async function updateFile(fileId, data) {
  if (!dbActive()) return drive.updateFile(fileId, data);
  await gql(UPSERT_ALL, { data });
}
