import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { createOrFetchFile, updateFile } from "../../utils/storage";
import {
  uploadFile as uploadDriveFile,
  deleteFile as deleteDriveFile,
  listFiles as listDriveFiles,
  downloadFile as downloadDriveFile,
} from "../../utils/googleDrive";
import { gql } from "../../utils/graphql";
import { dbEnabled, currentEmail } from "../../utils/storage/allowlist";

const ADD_TRANSACTION_MUTATION = `mutation AddTransaction($tx: JSON!) {
  addTransaction(transaction: $tx) { id updatedAt }
}`;
const UPDATE_TRANSACTION_MUTATION = `mutation UpdateTransaction($tx: JSON!) {
  updateTransaction(transaction: $tx) { id updatedAt }
}`;
const DELETE_TRANSACTION_MUTATION = `mutation DeleteTransaction($id: ID!) {
  deleteTransaction(id: $id) { id updatedAt }
}`;
const UPSERT_ENTITY_MUTATION = `mutation UpsertEntity($collection: String!, $entity: JSON!) {
  upsertEntity(collection: $collection, entity: $entity) { id updatedAt }
}`;
const DELETE_ENTITY_MUTATION = `mutation DeleteEntity($collection: String!, $id: ID!) {
  deleteEntity(collection: $collection, id: $id) { id updatedAt }
}`;
const UPDATE_SETTINGS_MUTATION = `mutation UpdateSettings($data: JSON!) {
  updateSettings(data: $data) { id updatedAt }
}`;

const SETTINGS_STRIP_KEYS = [
  "transactions",
  "investments",
  "accounts",
  "subscriptions",
  "cards",
  "commitments",
  "lendings",
  "goals",
  "notes",
];

export async function persistSettings(getState) {
  const { fileID, transactionData } = getState().transactions;
  if (!dbEnabled(currentEmail())) {
    await updateFile(fileID, transactionData);
    return;
  }
  const data = { ...transactionData };
  for (const k of SETTINGS_STRIP_KEYS) delete data[k];
  await gql(UPDATE_SETTINGS_MUTATION, { data });
}

const BULK_UPSERT_TRANSACTIONS_MUTATION = `mutation BulkUpsertTransactions($transactions: JSON!) {
  bulkUpsertTransactions(transactions: $transactions) { id updatedAt }
}`;

const DELTA_ENTITY_SPECS = [
  "investments",
  "accounts",
  "cards",
  "subscriptions",
  "commitments",
  "lendings",
  "goals",
  "notes",
];

function diffById(prevArr, nextArr) {
  const prev = new Map((prevArr ?? []).map((x) => [x.id, x]));
  const next = new Map((nextArr ?? []).map((x) => [x.id, x]));
  const upserts = [];
  const deletes = [];
  for (const [id, item] of next) {
    const old = prev.get(id);
    if (!old || old !== item) upserts.push(item);
  }
  for (const id of prev.keys()) if (!next.has(id)) deletes.push(id);
  return { upserts, deletes };
}

export async function persistDelta(getState, before) {
  const { fileID, transactionData: after } = getState().transactions;
  if (!dbEnabled(currentEmail())) {
    await updateFile(fileID, after);
    return;
  }

  const txUpserts = diffById(before?.transactions, after?.transactions).upserts;

  await persistSettings(getState);

  if (txUpserts.length) {
    await gql(BULK_UPSERT_TRANSACTIONS_MUTATION, { transactions: txUpserts });
  }
  for (const key of DELTA_ENTITY_SPECS) {
    const upserts = diffById(before?.[key], after?.[key]).upserts;
    for (const entity of upserts) {
      await gql(UPSERT_ENTITY_MUTATION, { collection: key, entity });
    }
  }
}

async function entityWrite(getState, mutationFn) {
  let saved = false;
  if (dbEnabled(currentEmail())) {
    try {
      await mutationFn();
      saved = true;
    } catch {
      saved = false;
    }
  }
  if (!saved) {
    const { fileID, transactionData } = getState().transactions;
    await updateFile(fileID, transactionData);
  }
}

export async function persistEntityUpsert(getState, collection, entity) {
  await entityWrite(getState, async () => {
    await gql(UPSERT_ENTITY_MUTATION, { collection, entity });
  });
}

export async function persistEntityDelete(getState, collection, id) {
  await entityWrite(getState, async () => {
    await gql(DELETE_ENTITY_MUTATION, { collection, id });
  });
}

// Persist a mixed batch of granular changes (entities + ledger transactions) in
// one pass for DB users, so a thunk that touches several rows doesn't fall back
// to a whole-blob syncAll. Falls back to a whole-blob write for Drive users, or
// if any granular op fails (entityWrite). Ops:
//   upserts:       [{ collection, entity }]
//   entityDeletes: [{ collection, id }]
//   txAdds/txUpdates: [tx]      txDeletes: [id]
export async function persistBatch(getState, ops = {}) {
  const {
    upserts = [],
    entityDeletes = [],
    txAdds = [],
    txUpdates = [],
    txDeletes = [],
  } = ops;
  await entityWrite(getState, async () => {
    for (const { collection, entity } of upserts) {
      await gql(UPSERT_ENTITY_MUTATION, { collection, entity });
    }
    for (const { collection, id } of entityDeletes) {
      await gql(DELETE_ENTITY_MUTATION, { collection, id });
    }
    for (const tx of txAdds) await gql(ADD_TRANSACTION_MUTATION, { tx });
    for (const tx of txUpdates) await gql(UPDATE_TRANSACTION_MUTATION, { tx });
    for (const id of txDeletes) await gql(DELETE_TRANSACTION_MUTATION, { id });
  });
}
import {
  findAutoDeductAmount,
  getInvestmentMathProfile,
} from "../../utils/investmentUtils";
import {
  BUILTIN_INVESTMENT_TYPES,
  getInvestmentTypeSchema,
} from "../../utils/investmentTypeSchemas";
import { DISCOVER_INVESTMENT_TYPES } from "../../data/investmentTypesDiscover";
import {
  parseAlertEmail,
  buildCaptureTransaction,
  DEFAULT_ALERT_SENDERS,
} from "../../utils/autoRead/emailParser";
import { listMessages, getMessage } from "../../utils/autoRead/gmailClient";
import {
  BANKS,
  CATEGORIES,
  DEFAULT_DATA,
  DEFAULT_DUE_WINDOWS,
  DEFAULT_HEALTH_SCORE,
  DEFAULT_LISTS,
  DEFAULT_PREFERENCES,
  INCOME_CATEGORIES,
  INVESTMENT_TYPES,
  PAYMENT_MODES,
} from "../../utils/constants";

function investedValue(inv) {
  const type = INVESTMENT_TYPES.find((t) => t.key === inv.type);
  if (type?.subtype === "unit") {
    return (parseFloat(inv.quantity) || 0) * (parseFloat(inv.buyPrice) || 0);
  }
  return parseFloat(inv.investedAmount) || 0;
}

// How a transaction shifts insights.balance.
// - Income adds, investment subtracts.
// - Expense usually subtracts — EXCEPT credit-card spends (cardId set), which
//   create debt against the card rather than a cash outflow. The cash leaves
//   only when the user logs the repayment, and that repayment transaction
//   deducts via this same function (no cardId on it).
// - Self transfers move money between the user's own accounts. Aggregate
//   balance is unchanged; per-account effects are handled separately.
function balanceDelta(tx) {
  const amount = parseFloat(tx.amount) || 0;
  if (tx.transactionType === "self_transfer") return 0;
  if (tx.transactionType === "income") {
    return tx.repaymentFor ? 0 : amount;
  }
  if (tx.transactionType === "investment") return -amount;
  if (tx.cardId) return 0;
  return -amount;
}

// How a transaction shifts insights.expenses (any non-income, non-investment,
// non-transfer counts — including credit-card spends, since the user did spend
// that money in real terms even if cash hasn't left the account yet).
function expenseDelta(tx) {
  if (
    tx.transactionType === "income" ||
    tx.transactionType === "investment" ||
    tx.transactionType === "self_transfer"
  )
    return 0;
  return parseFloat(tx.amount) || 0;
}

import { showToast } from "./toastSlice";
import { lendingOutstandingAfter } from "../../utils/lendingUtils";
import {
  computeAggregateBalance,
  computeAccountBalance,
  balanceAsOf,
  getReconciliationDelta,
} from "../../utils/accountUtils";

export const initializeDrive = createAsyncThunk(
  "transactions/initializeDrive",
  async () => {
    const { fileId, data } = await createOrFetchFile(
      "espresso-expenses.json",
      DEFAULT_DATA,
    );
    const preMigration = JSON.stringify(data);
    // Migrate older files that predate preferences/categories/lists
    let migrated = false;
    if (!data.preferences) {
      data.preferences = { ...DEFAULT_PREFERENCES };
      migrated = true;
    }
    // Backfill any new preference keys added after the file was created.
    for (const [k, v] of Object.entries(DEFAULT_PREFERENCES)) {
      if (data.preferences[k] === undefined) {
        data.preferences[k] =
          Array.isArray(v)
            ? [...v]
            : v && typeof v === "object"
              ? { ...v }
              : v;
        migrated = true;
      }
    }
    // For nested config objects, also backfill missing inner keys so we can
    // add new sub-settings without re-creating the whole block.
    function backfillNested(key, defaults) {
      const target = data.preferences[key];
      if (!target || typeof target !== "object") {
        data.preferences[key] = { ...defaults };
        migrated = true;
        return;
      }
      for (const [k, v] of Object.entries(defaults)) {
        if (target[k] === undefined) {
          target[k] = Array.isArray(v) ? [...v] : v;
          migrated = true;
        }
      }
    }
    backfillNested("healthScore", DEFAULT_HEALTH_SCORE);
    backfillNested("dueWindows", DEFAULT_DUE_WINDOWS);
    if (!data.categories) {
      data.categories = {
        expense: [...CATEGORIES],
        income: [...INCOME_CATEGORIES],
      };
      migrated = true;
    }
    if (
      Array.isArray(data.categories?.expense) &&
      !data.categories.expense.includes("Subscription")
    ) {
      const otherIdx = data.categories.expense.indexOf("Other");
      const at = otherIdx === -1 ? data.categories.expense.length : otherIdx;
      data.categories.expense.splice(at, 0, "Subscription");
      migrated = true;
    }
    if (!data.lists) {
      data.lists = {
        paymentModes: [...PAYMENT_MODES],
        banks: [...BANKS],
      };
      migrated = true;
    }
    for (const [k, v] of Object.entries(DEFAULT_LISTS)) {
      if (!Array.isArray(data.lists[k])) {
        data.lists[k] = [...v];
        migrated = true;
      }
    }
    // Multi-bank accounts list — initialised empty so existing data files
    // pre-dating the feature still load cleanly.
    if (!Array.isArray(data.accounts)) {
      data.accounts = [];
      migrated = true;
    }
    // Subscriptions list — empty backfill for files predating the feature.
    if (!Array.isArray(data.subscriptions)) {
      data.subscriptions = [];
      migrated = true;
    }
    // User-defined subscription types — empty backfill.
    if (!Array.isArray(data.subscriptionTypes)) {
      data.subscriptionTypes = [];
      migrated = true;
    }
    // Learned merchant aliases — populated by the statement importer.
    // Backfilled empty for files that predate the feature.
    if (!Array.isArray(data.merchantAliases)) {
      data.merchantAliases = [];
      migrated = true;
    }
    // APY schema cleanup — users who enabled APY before the
    // "Pension received" field was removed still have a copy of the
    // schema in their userTypes that includes the obsolete row. Strip
    // it on load so the form stops surfacing the field. Idempotent —
    // a no-op for users whose copy is already clean.
    const apy = data.investmentTypes?.find((t) => t.key === "apy");
    if (apy && Array.isArray(apy.rows)) {
      const cleanedRows = apy.rows
        .map((row) => {
          if (!Array.isArray(row?.fields)) return row;
          const filtered = row.fields.filter(
            (f) => f?.key !== "withdrawals",
          );
          if (filtered.length !== row.fields.length) {
            return { ...row, fields: filtered };
          }
          return row;
        })
        .filter((row) => (row.fields ?? []).length > 0);
      if (
        cleanedRows.length !== apy.rows.length ||
        cleanedRows.some((r, i) => r !== apy.rows[i])
      ) {
        apy.rows = cleanedRows;
        migrated = true;
      }
    }

    // Singleton flag backfill — types like PPF, NPS, APY, VPF, and
    // NPS Tier 2 can only be held once per individual. Users who
    // enabled the Discover variants before the flag was introduced
    // still have copies in their userTypes without it. Stamp it on
    // load so the type-picker block works without re-enabling.
    const SINGLETON_KEYS = ["apy", "vpf", "nps_tier2"];
    for (const key of SINGLETON_KEYS) {
      const t = data.investmentTypes?.find((x) => x.key === key);
      if (t && !t.singleton) {
        t.singleton = true;
        migrated = true;
      }
    }
    // User-extended investment type schemas — empty by default; the runtime
    // unions this with the built-in schemas held in code.
    if (!Array.isArray(data.investmentTypes)) {
      data.investmentTypes = [];
      migrated = true;
    }
    // Enabled investment type keys — defaults to all 16 built-ins so the
    // experience is unchanged for users predating this preference. Imported
    // dynamically so this file doesn't statically depend on the schema list.
    if (!Array.isArray(data.preferences?.enabledInvestmentTypes) ||
        data.preferences.enabledInvestmentTypes.length === 0) {
      data.preferences.enabledInvestmentTypes = BUILTIN_INVESTMENT_TYPES.map(
        (t) => t.key,
      );
      migrated = true;
    }
    // Investment type ordering — defaults to built-ins (natural) + Discover
    // (natural) so the Preferences list and Add Investment picker open with
    // a sensible sequence the first time. User-driven reorders persist here.
    if (!Array.isArray(data.preferences?.investmentTypeOrder) ||
        data.preferences.investmentTypeOrder.length === 0) {
      data.preferences.investmentTypeOrder = [
        ...BUILTIN_INVESTMENT_TYPES.map((t) => t.key),
        ...DISCOVER_INVESTMENT_TYPES.map((t) => t.key),
      ];
      migrated = true;
    }
    // Notification dismissals are a top-level map (not a preference). Ensure it
    // exists for files created before the notifications feature.
    if (!data.notificationDismissals || typeof data.notificationDismissals !== "object") {
      data.notificationDismissals = {};
      migrated = true;
    }
    // Auto-capture review inbox — parsed alerts awaiting the user's accept.
    if (!Array.isArray(data.autoReadInbox)) {
      data.autoReadInbox = [];
      migrated = true;
    } else {
      const clean = data.autoReadInbox.filter((i) => i && i.id && i.parsed);
      if (clean.length !== data.autoReadInbox.length) {
        data.autoReadInbox = clean;
        migrated = true;
      }
    }
    // Auto-capture (Gmail) settings.
    if (!data.autoRead || typeof data.autoRead !== "object") {
      data.autoRead = {
        enabled: false,
        source: "gmail",
        cursor: null,
        senders: [...DEFAULT_ALERT_SENDERS],
        processedIds: [],
      };
      migrated = true;
    }
    const dataChanged = JSON.stringify(data) !== preMigration;
    if (migrated && dataChanged) await updateFile(fileId, data);
    return { fileId, data };
  },
  {
    condition: (_arg, { getState }) => {
      if (getState().transactions.status === "loading") return false;
    },
  },
);

// Drop any dismissed-notification entry whose expiry has passed, so the map
// can never grow unbounded. A null expiry is a *permanent* acknowledgement
// (milestones) and is always kept. Returns a fresh object.
function pruneDismissals(map) {
  const now = Date.now();
  const out = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    if (v == null || new Date(v).getTime() > now) out[k] = v;
  }
  return out;
}

// Account ids a transaction touches (tagged account + either leg of a self
// transfer). Used to target which verified checkpoints to roll after a change.
function txnAccountIds(t) {
  const s = new Set();
  if (t?.accountId) s.add(t.accountId);
  if (t?.fromAccountId) s.add(t.fromAccountId);
  if (t?.toAccountId) s.add(t.toAccountId);
  return s;
}

// Auto-roll verified reconciliation checkpoints forward (Immer-mutating).
// For each affected verified account we recompute the checkpoint while KEEPING
// its exact drift: verifiedBalance := computedNow − driftAtCheckpoint, verifiedAt
// := now. When the account balance moved because of new (post-checkpoint)
// activity, this advances the checkpoint so recorded spending never shows as
// drift. When the change was backdated/edited BEFORE the checkpoint, computedNow
// and the drift move together so verifiedBalance lands back on its stored value
// — we then leave the checkpoint untouched, letting the genuine drift surface.
function rollVerifiedCheckpoints(state, ids) {
  const data = state.transactionData;
  const accounts = data?.accounts;
  if (!accounts?.length) return;
  const txns = data.transactions ?? [];
  const now = new Date().toISOString();
  for (const a of accounts) {
    if (ids && !ids.has(a.id)) continue;
    if (a.verifiedBalance == null || !a.verifiedAt) continue;
    const stored = parseFloat(a.verifiedBalance) || 0;
    const drift = balanceAsOf(a, txns, a.verifiedAt) - stored;
    const rolled = computeAccountBalance(a, txns) - drift;
    if (Math.abs(rolled - stored) < 0.005) continue; // backdated / no real move
    a.verifiedBalance = rolled;
    a.verifiedAt = now;
  }
}

// After a ledger mutation persists on the DB backend (granular mutations don't
// carry account rows), push any checkpoint the reducer rolled. The Drive path
// writes the whole blob, so it already covers this.
async function persistRolledAccounts(getState, before) {
  if (!dbEnabled(currentEmail())) return;
  const after = getState().transactions.transactionData.accounts ?? [];
  for (const a of after) {
    const b = before.find((x) => x.id === a.id);
    if (
      b &&
      (b.verifiedBalance !== a.verifiedBalance || b.verifiedAt !== a.verifiedAt)
    ) {
      await persistEntityUpsert(getState, "accounts", a);
    }
  }
}

const transactionSlice = createSlice({
  name: "transactions",
  initialState: {
    fileID: "",
    transactionData: {},
    status: "idle", // "idle" | "loading" | "ready" | "error"
  },
  reducers: {
    setDriveFile: (state, action) => {
      state.fileID = action.payload.fileID;
      state.transactionData = action.payload.data;
    },
    reset: () => ({ fileID: "", transactionData: {}, status: "idle" }),
    // Seed the ledger from the page-wise API (DB users) into the blob so every
    // consumer keeps reading one source; optimistic writes below then reflect
    // instantly with no cache refetch. Mirrors setInvestments.
    setTransactions: (state, action) => {
      state.transactionData.transactions = action.payload;
    },
    // Seed settings + small bounded collections from the coreData bootstrap.
    // Merges (Object.assign) so it never clobbers the lazily-loaded large
    // collections (transactions/investments) already in the blob.
    setCoreData: (state, action) => {
      if (!state.transactionData) state.transactionData = {};
      Object.assign(state.transactionData, action.payload);
    },
    addTransaction: (state, action) => {
      if (!state.transactionData.insights) return;
      const transaction = action.payload;
      state.transactionData.insights.balance += balanceDelta(transaction);
      state.transactionData.insights.expenses += expenseDelta(transaction);

      const updated = [...state.transactionData.transactions, transaction].sort(
        (a, b) => b.occurredAt.localeCompare(a.occurredAt),
      );
      state.transactionData.transactions = updated;
      rollVerifiedCheckpoints(state, txnAccountIds(transaction));
    },
    // Bulk insert — used by the statement importer. Same delta arithmetic
    // as addTransaction, but applied once for the whole batch so a single
    // re-sort settles everything. Atomic from the user's perspective —
    // either all imported rows land or none do.
    bulkAddTransactions: (state, action) => {
      if (!state.transactionData.insights) return;
      const incoming = action.payload ?? [];
      if (incoming.length === 0) return;
      let bal = 0;
      let exp = 0;
      for (const tx of incoming) {
        bal += balanceDelta(tx);
        exp += expenseDelta(tx);
      }
      state.transactionData.insights.balance += bal;
      state.transactionData.insights.expenses += exp;
      const merged = [
        ...state.transactionData.transactions,
        ...incoming,
      ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      state.transactionData.transactions = merged;
    },
    setInsightsBalance: (state, action) => {
      if (!state.transactionData.insights) return;
      state.transactionData.insights.balance = action.payload;
    },
    setBudget: (state, action) => {
      if (!state.transactionData.budgets) state.transactionData.budgets = {};
      const { category, amount } = action.payload;
      if (amount > 0) {
        state.transactionData.budgets[category] = amount;
      } else {
        delete state.transactionData.budgets[category];
      }
    },
    updateTransaction: (state, action) => {
      if (!state.transactionData.transactions) return;
      const { oldTx, newTx } = action.payload;
      const idx = state.transactionData.transactions.findIndex(
        (t) => t.id === newTx.id,
      );
      if (idx === -1) return;
      state.transactionData.insights.balance -= balanceDelta(oldTx);
      state.transactionData.insights.balance += balanceDelta(newTx);
      state.transactionData.insights.expenses -= expenseDelta(oldTx);
      state.transactionData.insights.expenses += expenseDelta(newTx);
      state.transactionData.transactions[idx] = newTx;
      state.transactionData.transactions.sort((a, b) =>
        b.occurredAt.localeCompare(a.occurredAt),
      );
      const ids = txnAccountIds(oldTx);
      for (const id of txnAccountIds(newTx)) ids.add(id);
      rollVerifiedCheckpoints(state, ids);
    },
    deleteTransaction: (state, action) => {
      if (!state.transactionData.transactions) return;
      const id = action.payload;
      const transaction = state.transactionData.transactions.find(
        (t) => t.id === id,
      );
      if (!transaction) return;

      state.transactionData.insights.balance -= balanceDelta(transaction);
      state.transactionData.insights.expenses -= expenseDelta(transaction);

      state.transactionData.transactions =
        state.transactionData.transactions.filter((t) => t.id !== id);
      rollVerifiedCheckpoints(state, txnAccountIds(transaction));
    },
    // ── Investments ──────────────────────────────────────
    // Seed the holdings from the page-wise API (DB users) into the blob so the
    // rest of the app keeps reading one source. Optimistic writes below then
    // reflect instantly — no cache refetch, no write-on-read loop.
    setInvestments: (state, action) => {
      state.transactionData.investments = action.payload;
    },
    addInvestment: (state, action) => {
      if (!state.transactionData.investments)
        state.transactionData.investments = [];
      state.transactionData.investments.push(action.payload);
    },
    updateInvestment: (state, action) => {
      if (!state.transactionData.investments) return;
      const idx = state.transactionData.investments.findIndex(
        (i) => i.id === action.payload.id,
      );
      if (idx !== -1) state.transactionData.investments[idx] = action.payload;
    },
    deleteInvestment: (state, action) => {
      if (!state.transactionData.investments) return;
      state.transactionData.investments =
        state.transactionData.investments.filter(
          (i) => i.id !== action.payload,
        );
    },
    // ── Solvency — Cards ─────────────────────────────────
    addCard: (state, { payload }) => {
      if (!state.transactionData.cards) state.transactionData.cards = [];
      state.transactionData.cards.push(payload);
    },
    updateCard: (state, { payload }) => {
      if (!state.transactionData.cards) return;
      const idx = state.transactionData.cards.findIndex((c) => c.id === payload.id);
      if (idx !== -1) state.transactionData.cards[idx] = payload;
    },
    deleteCard: (state, { payload }) => {
      if (!state.transactionData.cards) return;
      state.transactionData.cards = state.transactionData.cards.filter((c) => c.id !== payload);
    },
    // ── Solvency — Commitments ────────────────────────────
    addCommitment: (state, { payload }) => {
      if (!state.transactionData.commitments) state.transactionData.commitments = [];
      state.transactionData.commitments.push(payload);
    },
    updateCommitment: (state, { payload }) => {
      if (!state.transactionData.commitments) return;
      const idx = state.transactionData.commitments.findIndex((c) => c.id === payload.id);
      if (idx !== -1) state.transactionData.commitments[idx] = payload;
    },
    deleteCommitment: (state, { payload }) => {
      if (!state.transactionData.commitments) return;
      state.transactionData.commitments = state.transactionData.commitments.filter((c) => c.id !== payload);
    },
    // ── Solvency — Lendings ───────────────────────────────
    addLending: (state, { payload }) => {
      if (!state.transactionData.lendings) state.transactionData.lendings = [];
      state.transactionData.lendings.push(payload);
    },
    updateLending: (state, { payload }) => {
      if (!state.transactionData.lendings) return;
      const idx = state.transactionData.lendings.findIndex((l) => l.id === payload.id);
      if (idx !== -1) state.transactionData.lendings[idx] = payload;
    },
    deleteLending: (state, { payload }) => {
      if (!state.transactionData.lendings) return;
      state.transactionData.lendings = state.transactionData.lendings.filter((l) => l.id !== payload);
    },
    // ── Subscriptions ─────────────────────────────────────
    addSubscription: (state, { payload }) => {
      if (!state.transactionData.subscriptions)
        state.transactionData.subscriptions = [];
      state.transactionData.subscriptions.push(payload);
    },
    updateSubscription: (state, { payload }) => {
      if (!state.transactionData.subscriptions) return;
      const idx = state.transactionData.subscriptions.findIndex(
        (s) => s.id === payload.id,
      );
      if (idx !== -1) state.transactionData.subscriptions[idx] = payload;
    },
    deleteSubscription: (state, { payload }) => {
      if (!state.transactionData.subscriptions) return;
      state.transactionData.subscriptions =
        state.transactionData.subscriptions.filter((s) => s.id !== payload);
    },
    // ── Subscription types (user-defined brands/services) ─
    addSubscriptionType: (state, { payload }) => {
      if (!state.transactionData.subscriptionTypes)
        state.transactionData.subscriptionTypes = [];
      const idx = state.transactionData.subscriptionTypes.findIndex(
        (t) => t.key === payload.key,
      );
      if (idx !== -1) state.transactionData.subscriptionTypes[idx] = payload;
      else state.transactionData.subscriptionTypes.push(payload);
    },
    deleteSubscriptionType: (state, { payload: key }) => {
      if (!state.transactionData.subscriptionTypes) return;
      state.transactionData.subscriptionTypes =
        state.transactionData.subscriptionTypes.filter((t) => t.key !== key);
    },
    // ── Auto-capture inbox ────────────────────────────────
    addInboxItem: (state, { payload }) => {
      if (!Array.isArray(state.transactionData.autoReadInbox)) {
        state.transactionData.autoReadInbox = [];
      }
      state.transactionData.autoReadInbox.unshift(payload);
    },
    removeInboxItem: (state, { payload }) => {
      if (!Array.isArray(state.transactionData.autoReadInbox)) return;
      state.transactionData.autoReadInbox =
        state.transactionData.autoReadInbox.filter(
          (i) => i && i.id !== payload,
        );
    },
    setAutoRead: (state, { payload }) => {
      state.transactionData.autoRead = {
        ...(state.transactionData.autoRead ?? {}),
        ...payload,
      };
    },
    // ── Bank Accounts (multi-bank tracking) ───────────────
    addAccount: (state, { payload }) => {
      if (!state.transactionData.accounts) state.transactionData.accounts = [];
      state.transactionData.accounts.push(payload);
    },
    updateAccount: (state, { payload }) => {
      if (!state.transactionData.accounts) return;
      const idx = state.transactionData.accounts.findIndex((a) => a.id === payload.id);
      if (idx !== -1) state.transactionData.accounts[idx] = payload;
    },
    deleteAccount: (state, { payload }) => {
      if (!state.transactionData.accounts) return;
      state.transactionData.accounts = state.transactionData.accounts.filter(
        (a) => a.id !== payload,
      );
      const txns = state.transactionData.transactions;
      if (txns) {
        for (let i = txns.length - 1; i >= 0; i--) {
          if (txns[i].openingForAccount === payload) {
            if (state.transactionData.insights) {
              state.transactionData.insights.balance -= balanceDelta(txns[i]);
              state.transactionData.insights.expenses -= expenseDelta(txns[i]);
            }
            txns.splice(i, 1);
          }
        }
        // Untag any transactions that referenced this account so they don't
        // dangle. They fall back into the aggregate "All" view.
        txns.forEach((t) => {
          if (t.accountId === payload) delete t.accountId;
          if (t.fromAccountId === payload) delete t.fromAccountId;
          if (t.toAccountId === payload) delete t.toAccountId;
        });
      }
    },
    // Bulk re-tag past untagged transactions, used by the migration modal.
    // Payload: { matches: [{ predicate, accountId }] } evaluated in order.
    // For ergonomics the predicate is constructed in the thunk and the
    // reducer just walks pre-resolved tx-id → accountId pairs.
    bulkTagAccounts: (state, { payload }) => {
      const map = new Map(payload?.assignments ?? []);
      state.transactionData.transactions?.forEach((t) => {
        if (t.accountId) return;
        const aid = map.get(t.id);
        if (aid) t.accountId = aid;
      });
    },
    // ── Investment type schemas (user-defined + overrides) ──
    // Adds a brand-new custom type OR an override of a built-in. Caller
    // sets `key` ("custom-xxx" for new, or "stock"/"sip"/etc. for builtin
    // override). For built-in overrides the runtime merges this entry on
    // top of the in-code schema; for custom types this entry IS the schema.
    addInvestmentType: (state, { payload }) => {
      if (!state.transactionData.investmentTypes)
        state.transactionData.investmentTypes = [];
      // Replace if an entry with the same key already exists (lets the user
      // re-add a Discover entry idempotently, or upsert via the designer).
      const idx = state.transactionData.investmentTypes.findIndex(
        (t) => t.key === payload.key,
      );
      if (idx !== -1) state.transactionData.investmentTypes[idx] = payload;
      else state.transactionData.investmentTypes.push(payload);
    },
    updateInvestmentType: (state, { payload }) => {
      if (!state.transactionData.investmentTypes) return;
      const idx = state.transactionData.investmentTypes.findIndex(
        (t) => t.key === payload.key,
      );
      if (idx !== -1) state.transactionData.investmentTypes[idx] = payload;
    },
    // Removes a user-added type entirely. For a built-in override, this
    // reverts the type to its in-code defaults. The reducer doesn't touch
    // existing investments that referenced the key — the runtime will
    // either find the built-in fallback or render a graceful "Unknown type"
    // when both are gone.
    deleteInvestmentType: (state, { payload: key }) => {
      if (!state.transactionData.investmentTypes) return;
      state.transactionData.investmentTypes =
        state.transactionData.investmentTypes.filter((t) => t.key !== key);
    },
    // ── Preferences ───────────────────────────────────────
    setPreference: (state, { payload: { key, value } }) => {
      if (!state.transactionData.preferences) {
        state.transactionData.preferences = { ...DEFAULT_PREFERENCES };
      }
      state.transactionData.preferences[key] = value;
    },
    // ── Notification dismissals ───────────────────────────
    // Derived notifications are never stored — we persist only the user's
    // explicit early dismissals as { eventKey: expiryISO }. Every write prunes
    // expired entries first, so the map self-cleans and a dismissed reminder
    // re-appears next cycle (a new cycle = a new eventKey).
    dismissNotification: (state, { payload: { key, expiresAt } }) => {
      const map = pruneDismissals(state.transactionData.notificationDismissals);
      map[key] = expiresAt;
      state.transactionData.notificationDismissals = map;
    },
    clearNotifications: (state, { payload }) => {
      const map = pruneDismissals(state.transactionData.notificationDismissals);
      for (const { key, expiresAt } of payload ?? []) map[key] = expiresAt;
      state.transactionData.notificationDismissals = map;
    },
    // ── Lists (paymentModes etc.) ─────────────────────────
    setList: (state, { payload: { key, value } }) => {
      if (!state.transactionData.lists) state.transactionData.lists = {};
      state.transactionData.lists[key] = value;
    },
    // ── Auto-category rules ───────────────────────────────
    addAutoCategoryRule: (state, { payload }) => {
      if (!state.transactionData.preferences)
        state.transactionData.preferences = { ...DEFAULT_PREFERENCES };
      const rules = state.transactionData.preferences.autoCategoryRules ?? [];
      rules.push(payload);
      state.transactionData.preferences.autoCategoryRules = rules;
    },
    updateAutoCategoryRule: (state, { payload }) => {
      const rules =
        state.transactionData.preferences?.autoCategoryRules ?? [];
      const idx = rules.findIndex((r) => r.id === payload.id);
      if (idx !== -1) rules[idx] = payload;
    },
    removeAutoCategoryRule: (state, { payload: id }) => {
      const rules =
        state.transactionData.preferences?.autoCategoryRules ?? [];
      state.transactionData.preferences.autoCategoryRules = rules.filter(
        (r) => r.id !== id,
      );
    },
    // ── Merchant aliases (learned from statement imports) ──
    upsertMerchantAlias: (state, { payload }) => {
      // payload: { pattern, transactionType, category, paymentMode }
      // The pattern key is treated case-insensitively. If an entry with
      // the same canonical pattern already exists, bump its hits + the
      // category/type fields (the user's most recent confirmation is
      // the most up-to-date intent).
      if (!state.transactionData.merchantAliases)
        state.transactionData.merchantAliases = [];
      const aliases = state.transactionData.merchantAliases;
      const pattern = String(payload.pattern ?? "").trim().toUpperCase();
      if (!pattern) return;
      const now = new Date().toISOString();
      const idx = aliases.findIndex(
        (a) => (a.pattern ?? "").toUpperCase().trim() === pattern,
      );
      if (idx !== -1) {
        aliases[idx] = {
          ...aliases[idx],
          transactionType: payload.transactionType,
          category: payload.category,
          paymentMode: payload.paymentMode,
          hits: (aliases[idx].hits ?? 0) + 1,
          lastSeen: now,
        };
      } else {
        aliases.push({
          key: crypto.randomUUID(),
          pattern,
          transactionType: payload.transactionType,
          category: payload.category,
          paymentMode: payload.paymentMode,
          hits: 1,
          lastSeen: now,
          createdAt: now,
        });
      }
    },
    // Bulk version used by the importer on commit — applies the same
    // upsert logic for each entry in one pass so we don't write the
    // Drive file once per row.
    bulkUpsertMerchantAliases: (state, { payload }) => {
      if (!state.transactionData.merchantAliases)
        state.transactionData.merchantAliases = [];
      const aliases = state.transactionData.merchantAliases;
      const now = new Date().toISOString();
      for (const entry of payload ?? []) {
        const pattern = String(entry.pattern ?? "").trim().toUpperCase();
        if (!pattern || !entry.transactionType || !entry.category) continue;
        const idx = aliases.findIndex(
          (a) => (a.pattern ?? "").toUpperCase().trim() === pattern,
        );
        if (idx !== -1) {
          aliases[idx] = {
            ...aliases[idx],
            transactionType: entry.transactionType,
            category: entry.category,
            paymentMode: entry.paymentMode,
            hits: (aliases[idx].hits ?? 0) + 1,
            lastSeen: now,
          };
        } else {
          aliases.push({
            key: crypto.randomUUID(),
            pattern,
            transactionType: entry.transactionType,
            category: entry.category,
            paymentMode: entry.paymentMode,
            hits: 1,
            lastSeen: now,
            createdAt: now,
          });
        }
      }
    },
    updateMerchantAlias: (state, { payload }) => {
      const aliases = state.transactionData.merchantAliases ?? [];
      const idx = aliases.findIndex((a) => a.key === payload.key);
      if (idx !== -1) aliases[idx] = { ...aliases[idx], ...payload };
    },
    removeMerchantAlias: (state, { payload: key }) => {
      const aliases = state.transactionData.merchantAliases ?? [];
      state.transactionData.merchantAliases = aliases.filter(
        (a) => a.key !== key,
      );
    },
    // ── Categories ────────────────────────────────────────
    addCategory: (state, { payload: { scope, name } }) => {
      if (!state.transactionData.categories) {
        state.transactionData.categories = { expense: [], income: [] };
      }
      const list = state.transactionData.categories[scope] ?? [];
      if (!list.includes(name)) list.push(name);
      state.transactionData.categories[scope] = list;
    },
    renameCategory: (state, { payload: { scope, oldName, newName } }) => {
      const list = state.transactionData.categories?.[scope];
      if (!list) return;
      const idx = list.indexOf(oldName);
      if (idx === -1) return;
      list[idx] = newName;
      const txType = scope === "expense" ? "expense" : "income";
      state.transactionData.transactions?.forEach((t) => {
        if (t.transactionType === txType && t.category === oldName) {
          t.category = newName;
        }
      });
    },
    removeCategory: (state, { payload: { scope, name } }) => {
      const list = state.transactionData.categories?.[scope];
      if (!list) return;
      state.transactionData.categories[scope] = list.filter((c) => c !== name);
    },
    moveCategory: (state, { payload: { scope, name, direction } }) => {
      const list = state.transactionData.categories?.[scope];
      if (!list) return;
      const idx = list.indexOf(name);
      if (idx === -1) return;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= list.length) return;
      [list[idx], list[target]] = [list[target], list[idx]];
    },
    reorderCategory: (state, { payload: { scope, fromIndex, toIndex } }) => {
      const list = state.transactionData.categories?.[scope];
      if (!list) return;
      if (fromIndex < 0 || fromIndex >= list.length) return;
      if (toIndex < 0 || toIndex >= list.length) return;
      if (fromIndex === toIndex) return;
      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);
    },
    // ── Goals ────────────────────────────────────────────
    addGoal: (state, action) => {
      if (!state.transactionData.goals) state.transactionData.goals = [];
      state.transactionData.goals.push(action.payload);
    },
    updateGoal: (state, action) => {
      if (!state.transactionData.goals) return;
      const idx = state.transactionData.goals.findIndex(
        (g) => g.id === action.payload.id,
      );
      if (idx !== -1) state.transactionData.goals[idx] = action.payload;
    },
    deleteGoal: (state, action) => {
      if (!state.transactionData.goals) return;
      state.transactionData.goals = state.transactionData.goals.filter(
        (g) => g.id !== action.payload,
      );
    },
    addTally: (state, action) => {
      if (!state.transactionData.tallies) state.transactionData.tallies = [];
      state.transactionData.tallies.push(action.payload);
    },
    updateTally: (state, action) => {
      if (!state.transactionData.tallies) return;
      const idx = state.transactionData.tallies.findIndex(
        (t) => t.id === action.payload.id,
      );
      if (idx !== -1) state.transactionData.tallies[idx] = action.payload;
    },
    deleteTally: (state, action) => {
      if (!state.transactionData.tallies) return;
      state.transactionData.tallies = state.transactionData.tallies.filter(
        (t) => t.id !== action.payload,
      );
    },
    // ── Notes ────────────────────────────────────────────
    addNote: (state, action) => {
      if (!state.transactionData.notes) state.transactionData.notes = [];
      state.transactionData.notes.push(action.payload);
    },
    updateNote: (state, action) => {
      if (!state.transactionData.notes) return;
      const idx = state.transactionData.notes.findIndex(
        (n) => n.id === action.payload.id,
      );
      if (idx !== -1) state.transactionData.notes[idx] = action.payload;
    },
    deleteNote: (state, action) => {
      if (!state.transactionData.notes) return;
      state.transactionData.notes = state.transactionData.notes.filter(
        (n) => n.id !== action.payload,
      );
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeDrive.pending, (state) => {
        state.status = "loading";
      })
      .addCase(initializeDrive.fulfilled, (state, action) => {
        state.fileID = action.payload.fileId;
        const incoming = action.payload.data;
        const prev = state.transactionData || {};
        state.transactionData = {
          ...incoming,
          transactions: incoming.transactions?.length
            ? incoming.transactions
            : prev.transactions ?? incoming.transactions ?? [],
          investments: incoming.investments?.length
            ? incoming.investments
            : prev.investments ?? incoming.investments ?? [],
        };
        state.status = "ready";
      })
      .addCase(initializeDrive.rejected, (state, action) => {
        state.status =
          action.error.message === "needs-reconnect"
            ? "needs-reconnect"
            : "error";
      });
  },
});

export const {
  setDriveFile,
  reset,
  addTransaction,
  bulkAddTransactions,
  updateTransaction,
  deleteTransaction,
  setInsightsBalance,
  setBudget,
  addInboxItem,
  removeInboxItem,
  setAutoRead,
  setTransactions,
  setCoreData,
  setInvestments,
  addInvestment,
  updateInvestment,
  deleteInvestment,
  addGoal,
  updateGoal,
  deleteGoal,
  addTally,
  updateTally,
  deleteTally,
  addNote,
  updateNote,
  deleteNote,
  addCard,
  updateCard,
  deleteCard,
  addCommitment,
  updateCommitment,
  deleteCommitment,
  addLending,
  updateLending,
  deleteLending,
  addSubscription,
  updateSubscription,
  deleteSubscription,
  addSubscriptionType,
  deleteSubscriptionType,
  addAccount,
  updateAccount,
  deleteAccount,
  bulkTagAccounts,
  addInvestmentType,
  updateInvestmentType,
  deleteInvestmentType,
  setPreference,
  dismissNotification,
  clearNotifications,
  addCategory,
  renameCategory,
  removeCategory,
  moveCategory,
  reorderCategory,
  setList,
  addAutoCategoryRule,
  updateAutoCategoryRule,
  removeAutoCategoryRule,
  upsertMerchantAlias,
  bulkUpsertMerchantAliases,
  updateMerchantAlias,
  removeMerchantAlias,
} = transactionSlice.actions;

// ── Thunks ───────────────────────────────────────────

export const persistTransaction =
  (transaction) => async (dispatch, getState) => {
    const before = getState().transactions.transactionData.accounts ?? [];
    dispatch(addTransaction(transaction));
    const toast = () =>
      dispatch(
        showToast({
          message:
            transaction.transactionType === "income"
              ? "Income added"
              : "Expense added",
          action: {
            label: "View",
            href: `/Transactions?highlight=${transaction.id}`,
          },
        }),
      );

    if (dbEnabled(currentEmail())) {
      try {
        await gql(ADD_TRANSACTION_MUTATION, { tx: transaction });
        await persistRolledAccounts(getState, before);
        toast();
        return;
      } catch {
        const { fileID, transactionData } = getState().transactions;
        await updateFile(fileID, transactionData);
        toast();
        return;
      }
    }

    const { fileID, transactionData } = getState().transactions;
    await updateFile(fileID, transactionData);
    toast();
  };

// ── Auto-capture (review-inbox) thunks ───────────────

export const persistQueueAlert =
  (text, receivedAt) =>
  async (dispatch, getState) => {
  const parsed = parseAlertEmail(text);
  if (!parsed) {
    dispatch(
      showToast({ message: "Couldn't read that alert", type: "error" }),
    );
    return { ok: false };
  }
  const data = getState().transactions.transactionData;
  if (parsed.reference) {
    const dupTx = (data.transactions ?? []).some(
      (t) => t.reference === parsed.reference,
    );
    const dupQ = (data.autoReadInbox ?? []).some(
      (i) => i.parsed?.reference === parsed.reference,
    );
    if (dupTx || dupQ) {
      dispatch(showToast({ message: "Already captured this transaction" }));
      return { ok: false, duplicate: true };
    }
  }
  const at =
    receivedAt && !Number.isNaN(new Date(receivedAt).getTime())
      ? new Date(receivedAt).toISOString()
      : new Date().toISOString();
  dispatch(
    addInboxItem({
      id: crypto.randomUUID(),
      parsed,
      confidence: parsed.confidence,
      capturedAt: at,
    }),
  );
  await persistSettings(getState);
  return { ok: true };
};

export const persistAcceptInboxItem =
  (id, edits = {}) =>
  async (dispatch, getState) => {
    const data = getState().transactions.transactionData;
    const item = (data.autoReadInbox ?? []).find((i) => i.id === id);
    if (!item) return;
    const tx = {
      ...buildCaptureTransaction(item.parsed, {
        transactions: data.transactions ?? [],
        accounts: data.accounts ?? [],
        receivedAt: item.capturedAt,
      }),
      ...edits,
    };
    if (tx.cardId || !tx.accountId) delete tx.accountId;

    dispatch(addTransaction(tx));
    dispatch(removeInboxItem(id));
    await persistDelta(getState, data);
    dispatch(showToast({ message: "Captured transaction added" }));
  };

export const persistRejectInboxItem = (id) => async (dispatch, getState) => {
  dispatch(removeInboxItem(id));
  await persistSettings(getState);
};

// Pulls recent bank/UPI alert mails from Gmail and queues new ones into the
// review inbox. Dedupes by UPI reference + processed message ids, and stamps
// each item's capture time with the email's received time (accurate clock).
export const persistSyncGmail = () => async (dispatch, getState) => {
  const cfg = getState().transactions.transactionData.autoRead ?? {};
  const senders =
    cfg.senders && cfg.senders.length ? cfg.senders : DEFAULT_ALERT_SENDERS;
  const afterSec = cfg.cursor
    ? Math.floor(cfg.cursor / 1000)
    : Math.floor((Date.now() - 7 * 86_400_000) / 1000);
  const query = `(${senders.map((s) => `from:${s}`).join(" OR ")}) after:${afterSec}`;

  let msgs;
  try {
    msgs = await listMessages(query, 25);
  } catch (e) {
    if (e.code === "gmail-scope") {
      return { ok: false, error: "gmail-scope" };
    }
    dispatch(showToast({ message: "Gmail sync failed", type: "error" }));
    return { ok: false, error: "fetch" };
  }

  const processed = new Set(cfg.processedIds ?? []);
  let added = 0;
  let maxDate = cfg.cursor ?? 0;

  for (const { id } of msgs) {
    if (processed.has(id)) continue;
    let msg;
    try {
      msg = await getMessage(id);
    } catch {
      continue;
    }
    processed.add(id);
    if (msg.internalDate > maxDate) maxDate = msg.internalDate;

    const parsed = parseAlertEmail(msg.text);
    if (!parsed) continue;

    const cur = getState().transactions.transactionData;
    if (parsed.reference) {
      const dup =
        (cur.transactions ?? []).some(
          (t) => t.reference === parsed.reference,
        ) ||
        (cur.autoReadInbox ?? []).some(
          (i) => i.parsed?.reference === parsed.reference,
        );
      if (dup) continue;
    }

    dispatch(
      addInboxItem({
        id: crypto.randomUUID(),
        parsed,
        confidence: parsed.confidence,
        capturedAt: new Date(msg.internalDate).toISOString(),
        sourceMsgId: id,
      }),
    );
    added += 1;
  }

  if (added === 0 && maxDate === (cfg.cursor ?? 0)) {
    return { ok: true, added: 0 };
  }
  dispatch(
    setAutoRead({
      source: "gmail",
      cursor: maxDate || cfg.cursor || null,
      processedIds: Array.from(processed).slice(-300),
    }),
  );
  await persistSettings(getState);
  return { ok: true, added };
};

export const persistAutoReadEnabled =
  (enabled) => async (dispatch, getState) => {
    dispatch(setAutoRead({ enabled }));
    await persistSettings(getState);
  };

export const persistBudget =
  (category, amount) => async (dispatch, getState) => {
    dispatch(setBudget({ category, amount }));
    await persistSettings(getState);
  };

// Bulk import — used by the statement importer. Dispatches a single
// reducer (insights are recomputed once for the whole batch) and writes
// the file once at the end. Caller is responsible for normalising the
// payload to the ledger's transaction shape; see StatementImportModal.
export const persistBulkImport =
  (transactions) => async (dispatch, getState) => {
    if (!transactions?.length) return 0;
    const before = getState().transactions.transactionData;
    dispatch(bulkAddTransactions(transactions));
    await persistDelta(getState, before);
    dispatch(
      showToast({
        message: `Imported ${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`,
      }),
    );
    return transactions.length;
  };

// Bulk update — used by the reconciliation step to retag many
// transactions at once (e.g., "mark these 8 rows as SIP instalments").
// Each pair updates one tx; we dispatch them all then write Drive once.
export const persistBulkUpdateTransactions =
  (pairs) => async (dispatch, getState) => {
    if (!pairs?.length) return 0;
    const before = getState().transactions.transactionData;
    for (const { oldTx, newTx } of pairs) {
      dispatch(updateTransaction({ oldTx, newTx }));
    }
    await persistDelta(getState, before);
    return pairs.length;
  };

// Replace N existing transactions with one new transaction in a single
// Drive write. Used by the self-transfer reconciliation: drop the
// debit + credit pair, post one self_transfer row in their place.
export const persistMergeAsSelfTransfer =
  ({ removeIds, transfer }) => async (dispatch, getState) => {
    if (!removeIds?.length || !transfer) return;
    const before = getState().transactions.transactionData;
    for (const id of removeIds) dispatch(deleteTransaction(id));
    dispatch(addTransaction(transfer));
    await persistDelta(getState, before);
    if (dbEnabled(currentEmail())) {
      for (const id of removeIds) {
        try {
          await gql(DELETE_TRANSACTION_MUTATION, { id });
        } catch {}
      }
    }
  };

// Persist learned merchant aliases. The importer batches its learnings
// into one call here so we touch Drive once per import, not once per
// row. Caller passes an array of { pattern, transactionType, category,
// paymentMode }; the reducer upserts and bumps hits.
export const persistMerchantAliases =
  (aliases) => async (dispatch, getState) => {
    if (!aliases?.length) return;
    dispatch(bulkUpsertMerchantAliases(aliases));
    await persistSettings(getState);
  };

// Single-alias upsert (Preferences UI). Same flow, one entry.
export const persistUpsertMerchantAlias =
  (alias) => async (dispatch, getState) => {
    dispatch(upsertMerchantAlias(alias));
    await persistSettings(getState);
  };

export const persistUpdateMerchantAlias =
  (alias) => async (dispatch, getState) => {
    dispatch(updateMerchantAlias(alias));
    await persistSettings(getState);
  };

export const persistRemoveMerchantAlias =
  (key) => async (dispatch, getState) => {
    dispatch(removeMerchantAlias(key));
    await persistSettings(getState);
  };

// Draw-down reversal for borrowed lendings. A repayment tagged `lendingId`
// reduces that lending's STORED outstanding (unlike cards/commitments, whose
// dues are recomputed live from their repayment txns). So when such a repayment
// is removed, restored, or re-amounted, the stored figure has to move with it.
// `delta` is added to outstanding (+ gives the debt back on delete, − takes it
// on restore); the result is clamped to [0, original borrowed amount].
// Dispatches the store update and returns the entity to persist (DB users), or
// null when there's nothing tagged.
function reconcileLending(dispatch, getState, lendingId, delta) {
  if (!lendingId || !delta) return null;
  const lendings = getState().transactions.transactionData?.lendings ?? [];
  const lending = lendings.find((l) => l.id === lendingId);
  if (!lending) return null;
  const updated = { ...lending, outstanding: lendingOutstandingAfter(lending, delta) };
  dispatch(updateLending(updated));
  return updated;
}

async function persistLendingUpserts(upserts) {
  for (const entity of upserts) {
    await gql(UPSERT_ENTITY_MUTATION, { collection: "lendings", entity });
  }
}

export const persistUpdateTransaction =
  (oldTx, newTx) => async (dispatch, getState) => {
    // Stamp the edit time so the ledger can show "Last updated". Lives on the
    // transaction JSON (round-trips via `raw`), so no backend/schema change.
    const stamped = { ...newTx, updatedAt: new Date().toISOString() };
    const before = getState().transactions.transactionData.accounts ?? [];
    dispatch(updateTransaction({ oldTx, newTx: stamped }));

    // Reverse the old draw-down, then apply the new one. When both point at the
    // same lending the second call sees the first's update, so the net is
    // outstanding + oldAmount − newAmount. Dedupe so only the latest entity is
    // persisted per lending.
    const lendingUpserts = [];
    const restored = reconcileLending(
      dispatch,
      getState,
      oldTx?.lendingId,
      parseFloat(oldTx?.amount) || 0,
    );
    if (restored) lendingUpserts.push(restored);
    const applied = reconcileLending(
      dispatch,
      getState,
      stamped?.lendingId,
      -(parseFloat(stamped?.amount) || 0),
    );
    if (applied) {
      const i = lendingUpserts.findIndex((u) => u.id === applied.id);
      if (i >= 0) lendingUpserts[i] = applied;
      else lendingUpserts.push(applied);
    }

    const done = () => dispatch(showToast({ message: "Transaction updated" }));
    if (dbEnabled(currentEmail())) {
      try {
        await gql(UPDATE_TRANSACTION_MUTATION, { tx: stamped });
        await persistLendingUpserts(lendingUpserts);
        await persistRolledAccounts(getState, before);
        done();
        return;
      } catch {
        const { fileID, transactionData } = getState().transactions;
        await updateFile(fileID, transactionData);
        done();
        return;
      }
    }
    const { fileID, transactionData } = getState().transactions;
    await updateFile(fileID, transactionData);
    done();
  };

export const persistDeleteTransaction = (id) => async (dispatch, getState) => {
  const { transactionData } = getState().transactions;
  const tx = transactionData.transactions?.find((t) => t.id === id);
  const before = transactionData.accounts ?? [];
  dispatch(deleteTransaction(id));
  if (
    tx?.transactionType === "investment" &&
    !tx.sipInvestmentId &&
    !tx.licPolicyId
  ) {
    dispatch(deleteInvestment(id));
  }
  // Removing a borrowed-lending repayment gives its draw-down back.
  const lendingUpsert = reconcileLending(
    dispatch,
    getState,
    tx?.lendingId,
    parseFloat(tx?.amount) || 0,
  );
  const lendingUpserts = lendingUpsert ? [lendingUpsert] : [];
  // Undo is offered for plain transactions — restoring the row fully reverses
  // the delete. Investment-type rows have cascades (linked investment), so they
  // skip Undo.
  const canUndo = !!tx && tx.transactionType !== "investment";
  const done = () =>
    dispatch(
      showToast({
        message: "Transaction deleted",
        duration: canUndo ? 6000 : 3500,
        action: canUndo ? { label: "Undo", restoreTx: tx } : null,
      }),
    );
  if (dbEnabled(currentEmail())) {
    try {
      await gql(DELETE_TRANSACTION_MUTATION, { id });
      await persistLendingUpserts(lendingUpserts);
      await persistRolledAccounts(getState, before);
      done();
      return;
    } catch {
      const { fileID, transactionData: updated } = getState().transactions;
      await updateFile(fileID, updated);
      done();
      return;
    }
  }
  const { fileID, transactionData: updated } = getState().transactions;
  await updateFile(fileID, updated);
  done();
};

export const persistRestoreTransaction =
  (tx) => async (dispatch, getState) => {
    if (!tx) return;
    const before = getState().transactions.transactionData.accounts ?? [];
    dispatch(addTransaction(tx));
    // Restoring a borrowed-lending repayment re-applies its draw-down.
    const lendingUpsert = reconcileLending(
      dispatch,
      getState,
      tx?.lendingId,
      -(parseFloat(tx?.amount) || 0),
    );
    const lendingUpserts = lendingUpsert ? [lendingUpsert] : [];
    const done = () =>
      dispatch(showToast({ message: "Transaction restored" }));
    if (dbEnabled(currentEmail())) {
      try {
        await gql(ADD_TRANSACTION_MUTATION, { tx });
        await persistLendingUpserts(lendingUpserts);
        await persistRolledAccounts(getState, before);
        done();
        return;
      } catch {
        const { fileID, transactionData } = getState().transactions;
        await updateFile(fileID, transactionData);
        done();
        return;
      }
    }
    const { fileID, transactionData } = getState().transactions;
    await updateFile(fileID, transactionData);
    done();
  };

// Past premium months for an LIC policy, exclusive of the current month.
function pastPremiumDates(startDate, premiumMonths) {
  const out = [];
  if (!startDate || !premiumMonths?.length) return out;
  const start = new Date(startDate);
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor < cutoff) {
    if (premiumMonths.includes(cursor.getMonth() + 1)) {
      out.push(new Date(cursor));
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

// Builds a fresh LIC premium-payment transaction for a given month.
function buildLicPaymentTx(policy, occurredAt) {
  return {
    id: crypto.randomUUID(),
    transactionType: "investment",
    name: policy.name,
    amount: String(parseFloat(policy.premiumAmount) || 0),
    category: "LIC",
    occurredAt: occurredAt.toISOString(),
    createdAt: new Date().toISOString(),
    licPolicyId: policy.id,
    accountId: policy.accountId || undefined,
  };
}

// Resolves whether an investment's "Deduct from balance" toggle is on.
// Two layers of fallback:
//   1. If the schema declares a deduct-from-balance field, read the
//      value at THAT field's key. User-added fields via the Investment
//      Type Designer have a random key (e.g. f_a1b2c3d4); the old
//      hardcoded `affectsBalance` check missed those entirely and
//      always defaulted to "post a lump-sum tx".
//   2. Legacy fallback for built-in InvestmentForm types (stock, ETF,
//      FD, RD, etc.) that set `investment.affectsBalance` directly.
//      Treat undefined as true to preserve the historical default.
async function shouldDeductFromBalance(investment, userTypes) {
  const schema = getInvestmentTypeSchema(investment.type, userTypes);
  const deductField = schema?.rows
    ?.flatMap((r) => r.fields ?? [])
    .find((f) => f.type === "deduct-from-balance");
  if (deductField) return !!investment[deductField.key];
  // Type-level affectsBalance (set in Investment Type Designer) overrides the
  // per-investment default so new investments inherit the type's intent.
  if (schema?.affectsBalance === false) return false;
  return investment.affectsBalance !== false;
}

// Cash-flow profile types (APY, chit fund, anything user-marked as
// cashflow) never carry a lump-sum linked transaction. The recurring
// per-period contributions are the ledger entries — either auto-posted
// by the scheduler, manually logged via the "Log this payment" CTA, or
// reconciled from a statement import. A lump-sum on top would double-
// count against those.
function isCashflowType(investment, userTypes) {
  return getInvestmentMathProfile(investment.type, userTypes) === "cashflow";
}

export const persistAddInvestment =
  (investment) => async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    dispatch(addInvestment(investment));
    // LIC: skip the standard "single linked transaction" path. Instead,
    // generate one payment-ledger entry per past premium month plus
    // (optionally) one for the current month if the form's checkbox was set.
    // This mirrors the SIP audit-trail pattern.
    if (investment.type === "lic") {
      if (investment.affectsBalance !== false) {
        const past = pastPremiumDates(
          investment.startDate,
          investment.premiumMonths,
        );
        for (const date of past) {
          dispatch(addTransaction(buildLicPaymentTx(investment, date)));
        }
        if (investment.currentInstallmentPaid?.paid) {
          const now = new Date();
          if (investment.premiumMonths?.includes(now.getMonth() + 1)) {
            dispatch(
              addTransaction(
                buildLicPaymentTx(
                  investment,
                  new Date(now.getFullYear(), now.getMonth(), 1),
                ),
              ),
            );
          }
        }
      }
      try {
        await persistDelta(getState, before);
        dispatch(showToast({ message: "Policy added" }));
      } catch {
        dispatch(
          showToast({
            message: "Couldn't save to Drive — check your connection and try again.",
            type: "error",
          }),
        );
      }
      return;
    }
    // SIP: balance comes from monthly instalments only.
    // Cash-flow types (APY, chit fund, etc): no lump-sum tx ever —
    //   contributions are the ledger entries.
    // Others: post a linked transaction only if the schema's
    //   deduct-from-balance toggle is on (or legacy affectsBalance).
    if (investment.type !== "sip") {
      const userTypes =
        getState().transactions.transactionData?.investmentTypes ?? [];
      const isCashflow = isCashflowType(investment, userTypes);
      const wantsBalance =
        !isCashflow && (await shouldDeductFromBalance(investment, userTypes));
      if (wantsBalance) {
        const typeLabel =
          INVESTMENT_TYPES.find((t) => t.key === investment.type)?.label ??
          "Investment";
        dispatch(
          addTransaction({
            id: investment.id,
            transactionType: "investment",
            name: investment.name,
            amount: String(investedValue(investment)),
            category: typeLabel,
            occurredAt: investment.startDate || investment.createdAt,
            createdAt: investment.createdAt,
            accountId: investment.accountId || undefined,
          }),
        );
      }
    }
    try {
      await persistDelta(getState, before);
      dispatch(showToast({ message: "Investment added" }));
    } catch {
      dispatch(
        showToast({
          message: "Couldn't save to Drive — check your connection and try again.",
          type: "error",
        }),
      );
    }
  };

export const persistUpdateInvestment =
  (investment) => async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    const oldInv = before.investments?.find((i) => i.id === investment.id);
    const linkedTx = before.transactions?.find(
      (t) => t.id === investment.id && t.transactionType === "investment",
    );
    dispatch(updateInvestment(investment));
    const txDeletes = [];

    if (investment.type === "lic") {
      // Remove any stale lump-sum transaction created by old code (id ===
      // investment.id, no licPolicyId). LIC uses a per-premium ledger instead.
      if (linkedTx && !linkedTx.licPolicyId) {
        dispatch(deleteTransaction(linkedTx.id));
        txDeletes.push(linkedTx.id);
      }

      const wantsBalance = investment.affectsBalance !== false;

      if (wantsBalance) {
        // Sync the current calendar month's premium payment based on the
        // form's checkbox. Past months stay untouched.
        const now = new Date();
        const currentMonthTx = before.transactions?.find((t) => {
          if (t.licPolicyId !== investment.id) return false;
          const d = new Date(t.occurredAt);
          return (
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth()
          );
        });
        const isPremiumMonth = investment.premiumMonths?.includes(
          now.getMonth() + 1,
        );
        const wantsPaid =
          isPremiumMonth && investment.currentInstallmentPaid?.paid;
        if (wantsPaid && !currentMonthTx) {
          dispatch(
            addTransaction(
              buildLicPaymentTx(
                investment,
                new Date(now.getFullYear(), now.getMonth(), 1),
              ),
            ),
          );
        } else if (!wantsPaid && currentMonthTx) {
          dispatch(deleteTransaction(currentMonthTx.id));
          txDeletes.push(currentMonthTx.id);
        }
      } else {
        // affectsBalance toggled off — delete all per-premium transactions.
        const allLicTxs = (before.transactions ?? []).filter(
          (t) => t.licPolicyId === investment.id,
        );
        allLicTxs.forEach((t) => {
          dispatch(deleteTransaction(t.id));
          txDeletes.push(t.id);
        });
      }

      await persistDelta(getState, before);
      if (dbEnabled(currentEmail())) {
        for (const tid of txDeletes) {
          try {
            await gql(DELETE_TRANSACTION_MUTATION, { id: tid });
          } catch {}
        }
      }
      return;
    }

    if (investment.type === "sip") {
      // SIP: remove legacy lump-sum linked tx if present; balance comes from monthly instalments only.
      if (linkedTx) {
        dispatch(deleteTransaction(investment.id));
        txDeletes.push(investment.id);
      }
    } else {
      const userTypes =
        getState().transactions.transactionData?.investmentTypes ?? [];
      const isCashflow = isCashflowType(investment, userTypes);
      const wantsBalance =
        !isCashflow && (await shouldDeductFromBalance(investment, userTypes));
      const typeLabel =
        INVESTMENT_TYPES.find((t) => t.key === investment.type)?.label ??
        "Investment";
      if (linkedTx && !wantsBalance) {
        // User turned off balance impact — remove the linked transaction.
        dispatch(deleteTransaction(investment.id));
        txDeletes.push(investment.id);
      } else if (!linkedTx && wantsBalance && oldInv) {
        // User turned on balance impact — create a new linked transaction.
        dispatch(
          addTransaction({
            id: investment.id,
            transactionType: "investment",
            name: investment.name,
            amount: String(investedValue(investment)),
            category: typeLabel,
            occurredAt: investment.startDate || investment.createdAt || oldInv.createdAt,
            createdAt: investment.createdAt || oldInv.createdAt,
            accountId: investment.accountId || undefined,
          }),
        );
      } else if (linkedTx && wantsBalance && oldInv) {
        // Normal update — keep the linked transaction in sync.
        dispatch(
          updateTransaction({
            oldTx: { ...linkedTx, amount: String(investedValue(oldInv)) },
            newTx: {
              ...linkedTx,
              name: investment.name,
              amount: String(investedValue(investment)),
              category: typeLabel,
              occurredAt: investment.startDate || linkedTx.occurredAt,
              accountId: investment.accountId || undefined,
            },
          }),
        );
      }
    }
    await persistDelta(getState, before);
    if (dbEnabled(currentEmail())) {
      for (const tid of txDeletes) {
        try {
          await gql(DELETE_TRANSACTION_MUTATION, { id: tid });
        } catch {}
      }
    }
  };

export const persistPayLicArrears =
  ({ investmentId, periods, withPenalty }) =>
  async (dispatch, getState) => {
    const data = getState().transactions.transactionData;
    const inv = data.investments?.find((i) => i.id === investmentId);
    if (!inv || !Array.isArray(periods) || periods.length === 0) return;
    const premium = parseFloat(inv.premiumAmount) || 0;

    const txs = periods.map((iso) => buildLicPaymentTx(inv, new Date(iso)));

    if (withPenalty && inv.latePenalty?.enabled) {
      const per =
        inv.latePenalty.mode === "percent"
          ? (premium * (parseFloat(inv.latePenalty.amount) || 0)) / 100
          : parseFloat(inv.latePenalty.amount) || 0;
      if (per > 0) {
        for (const iso of periods) {
          txs.push({
            id: crypto.randomUUID(),
            transactionType: "expense",
            name: `${inv.name} late penalty`,
            amount: String(per),
            category: "Late penalty",
            occurredAt: new Date(iso).toISOString(),
            createdAt: new Date().toISOString(),
            licPolicyId: inv.id,
            accountId: inv.accountId || undefined,
          });
        }
      }
    }

    dispatch(bulkAddTransactions(txs));

    const after = getState().transactions.transactionData;
    const paidCount = (after.transactions ?? []).filter(
      (t) => t.licPolicyId === inv.id && t.transactionType === "investment",
    ).length;
    dispatch(
      updateInvestment({
        ...inv,
        investedAmount: paidCount * premium,
        installmentsPaid: paidCount,
      }),
    );

    await persistDelta(getState, data);
    dispatch(
      showToast({
        message: `Recorded ${periods.length} overdue premium${periods.length === 1 ? "" : "s"}`,
      }),
    );
  };

export const persistDeleteInvestment =
  (id, { returnToBalance = false, accountId } = {}) =>
  async (dispatch, getState) => {
    // SIP and LIC soft-delete (move to History). Past payment transactions
    // stay because they reflect real money that already moved.
    const { transactionData } = getState().transactions;
    const inv = transactionData.investments?.find((i) => i.id === id);
    if (inv?.type === "sip") {
      dispatch(updateInvestment({ ...inv, inHistory: true, paused: true }));
    } else if (inv?.type === "lic") {
      dispatch(updateInvestment({ ...inv, inHistory: true }));
    } else {
      dispatch(deleteInvestment(id));
      // The original purchase transaction is intentionally KEPT so deleting an
      // investment no longer silently reverses the bank balance (money stays
      // spent by default). If the user chose to recover the funds, post an
      // explicit, visible credit to the chosen bank instead.
      if (returnToBalance && inv) {
        const amount = investedValue(inv);
        if (amount > 0) {
          const now = new Date().toISOString();
          dispatch(
            addTransaction({
              id: crypto.randomUUID(),
              createdAt: now,
              occurredAt: now,
              transactionType: "income",
              amount: String(Math.round(amount * 100) / 100),
              name: `Closed: ${inv.name}`,
              category: "Investment",
              accountId: accountId || inv.accountId || undefined,
            }),
          );
        }
      }
    }
    await persistDelta(getState, transactionData);
    if (dbEnabled(currentEmail()) && inv && inv.type !== "sip" && inv.type !== "lic") {
      try {
        await gql(DELETE_ENTITY_MUTATION, { collection: "investments", id });
      } catch {}
    }
  };

// Permanently deletes a soft-deleted investment from History (and its
// linked tx / SIP / LIC payment ledger). Used by the History tab's
// hard-delete button.
export const persistHardDeleteInvestment =
  (id) => async (dispatch, getState) => {
    const { transactionData } = getState().transactions;
    dispatch(deleteInvestment(id));
    const linked = (transactionData.transactions ?? []).filter(
      (t) =>
        t.id === id || t.sipInvestmentId === id || t.licPolicyId === id,
    );
    linked.forEach((t) => dispatch(deleteTransaction(t.id)));
    await persistDelta(getState, transactionData);
    if (dbEnabled(currentEmail())) {
      try {
        await gql(DELETE_ENTITY_MUTATION, { collection: "investments", id });
      } catch {}
      for (const t of linked) {
        try {
          await gql(DELETE_TRANSACTION_MUTATION, { id: t.id });
        } catch {}
      }
    }
  };

// Surrender (early exit) an LIC policy. Records the surrender proceeds as
// an income transaction when `addToBalance` is true, then moves the policy
// to History. The premium-payment ledger entries stay intact for audit.
export const persistSurrenderLicPolicy =
  ({ id, amount, addToBalance, accountId }) => async (dispatch, getState) => {
    const { transactionData } = getState().transactions;
    const inv = transactionData.investments?.find((i) => i.id === id);
    if (!inv) return;
    dispatch(
      updateInvestment({
        ...inv,
        inHistory: true,
        surrendered: true,
        surrenderAmount: amount,
        surrenderedAt: new Date().toISOString(),
      }),
    );
    if (addToBalance && amount > 0) {
      const now = new Date().toISOString();
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          transactionType: "income",
          name: `Surrendered: ${inv.name}`,
          amount: String(amount),
          category: "Investment",
          occurredAt: now,
          createdAt: now,
          accountId: accountId || undefined,
        }),
      );
    }
    await persistDelta(getState, transactionData);
    dispatch(showToast({ message: `${inv.name} surrendered` }));
  };

// Mark an LIC policy as matured (reached tenure end). Records the maturity
// payout as income if `addToBalance`, then moves to History.
export const persistMatureLicPolicy =
  ({ id, amount, addToBalance, accountId }) => async (dispatch, getState) => {
    const { transactionData } = getState().transactions;
    const inv = transactionData.investments?.find((i) => i.id === id);
    if (!inv) return;
    dispatch(
      updateInvestment({
        ...inv,
        inHistory: true,
        matured: true,
        actualMaturityAmount: amount,
        maturedAt: new Date().toISOString(),
      }),
    );
    if (addToBalance && amount > 0) {
      const now = new Date().toISOString();
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          transactionType: "income",
          name: `Matured: ${inv.name}`,
          amount: String(amount),
          category: "Investment",
          occurredAt: now,
          createdAt: now,
          accountId: accountId || undefined,
        }),
      );
    }
    await persistDelta(getState, transactionData);
    dispatch(showToast({ message: `${inv.name} matured 🎉` }));
  };

export const persistPauseInvestment = (id) => async (dispatch, getState) => {
  const { transactionData } = getState().transactions;
  const inv = transactionData.investments?.find((i) => i.id === id);
  if (!inv) return;
  dispatch(
    updateInvestment({
      ...inv,
      paused: true,
      pausedAt: new Date().toISOString(),
    }),
  );
  await persistDelta(getState, transactionData);
  dispatch(showToast({ message: `${inv.name} paused — auto-deductions stopped` }));
};

// Resume a paused SIP. The user confirms a resumption date and optionally
// requests an immediate instalment for that date. We DO NOT overwrite the
// original startDate (that's a historical fact — touching it makes
// fetchSIPData under-count units and breaks the audit trail's untracked-month
// iteration). We only update sipDay so future auto-instalments fall on the
// chosen day-of-month, and record the resumption in `resumedAt`.
export const persistResumeInvestment =
  ({ id, startDate, deductOnStart }) =>
  async (dispatch, getState) => {
    const { transactionData } = getState().transactions;
    const inv = transactionData.investments?.find((i) => i.id === id);
    if (!inv) return;
    const sipDay = startDate ? new Date(startDate).getDate() : inv.sipDay;
    dispatch(
      updateInvestment({
        ...inv,
        paused: false,
        sipDay,
        resumedAt: startDate || new Date().toISOString(),
      }),
    );

    if (deductOnStart && startDate && inv.monthlyAmount) {
      const now = new Date().toISOString();
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          createdAt: now,
          occurredAt: new Date(startDate).toISOString(),
          transactionType: "investment",
          amount: String(parseFloat(inv.monthlyAmount) || 0),
          name: inv.name,
          category: "SIP",
          sipInvestmentId: inv.id,
        }),
      );
    }

    await persistDelta(getState, transactionData);
    dispatch(showToast({ message: `${inv.name} resumed` }));
  };

// Handles a sell: reduces/removes lots, optionally logs sale proceeds as income.
// Uses direct reducers (not the update/delete thunks) so there is a single Drive write
// and the original cost-basis linked transaction is NOT disturbed.
export const persistSellInvestment =
  ({ lots, qtyToSell, sellPrice, addToBalance, accountId, invName }) =>
  async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    let remaining = qtyToSell;
    for (const lot of lots) {
      if (remaining <= 0) break;
      if (lot.quantity <= remaining + 0.00001) {
        // Keep the lot at quantity 0 (instead of deleting) so it shows up
        // in the History tab with its sale record intact.
        dispatch(updateInvestment({ ...lot, quantity: 0 }));
        remaining -= lot.quantity;
      } else {
        dispatch(
          updateInvestment({
            ...lot,
            quantity: +(lot.quantity - remaining).toFixed(6),
          }),
        );
        remaining = 0;
      }
    }

    if (addToBalance && sellPrice > 0) {
      const now = new Date().toISOString();
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          createdAt: now,
          occurredAt: now,
          transactionType: "income",
          amount: String(Math.round(qtyToSell * sellPrice * 100) / 100),
          name: `Sold: ${invName}`,
          category: "Investment",
          accountId: accountId || undefined,
        }),
      );
    }

    await persistDelta(getState, before);
  };

// Logs the current month's SIP instalment as an investment transaction that
// reduces the balance. Idempotent — skips if already logged this month.
// Also skips if the SIP is paused or has been moved to history.
export const persistSIPInstalment = (inv) => async (dispatch, getState) => {
  if (inv.paused || inv.inHistory) return;
  if (!inv.monthlyAmount || !inv.startDate) return;
  const { transactionData } = getState().transactions;
  const allTx = transactionData.transactions ?? [];
  const now = new Date();
  const yr = now.getFullYear();
  const mo = now.getMonth();

  const alreadyLogged = allTx.some((t) => {
    if (t.sipInvestmentId !== inv.id) return false;
    const d = new Date(t.occurredAt);
    return d.getFullYear() === yr && d.getMonth() === mo;
  });
  if (alreadyLogged) return;

  const sipDay = parseInt(inv.sipDay) || new Date(inv.startDate).getDate();
  const occurredAt = new Date(yr, mo, sipDay).toISOString();

  const inheritedAccount =
    inv.accountId ||
    allTx
      .filter((t) => t.sipInvestmentId === inv.id && t.accountId)
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0]
      ?.accountId ||
    undefined;

  dispatch(
    addTransaction({
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      occurredAt,
      transactionType: "investment",
      amount: String(parseFloat(inv.monthlyAmount) || 0),
      name: inv.name,
      category: "SIP",
      sipInvestmentId: inv.id,
      accountId: inheritedAccount,
    }),
  );

  await persistDelta(getState, transactionData);
};

// Retroactively tag a SIP's already-posted, untagged instalments to the
// account now linked on the investment. Called when a SIP is saved with a
// bank, so instalments that were auto-logged before the link existed start
// debiting the right account too — including the current month's row, which
// persistSIPInstalment's monthly idempotency would otherwise leave untagged.
// Only untagged rows are touched (bulkTagAccounts skips tagged ones). Returns
// the number of instalments tagged.
export const persistBackfillSipAccount =
  (inv) => async (dispatch, getState) => {
    if (!inv?.id || !inv.accountId) return 0;
    const before = getState().transactions.transactionData;
    const allTx = before.transactions ?? [];
    const assignments = allTx
      .filter((t) => t.sipInvestmentId === inv.id && !t.accountId)
      .map((t) => [t.id, inv.accountId]);
    if (!assignments.length) return 0;

    dispatch(bulkTagAccounts({ assignments }));
    await persistDelta(getState, before);
    dispatch(
      showToast({
        message: `Tagged ${assignments.length} past SIP instalment${
          assignments.length === 1 ? "" : "s"
        } to this account`,
      }),
    );
    return assignments.length;
  };

// ── Generic auto-deduct scheduler ─────────────────────────────
//
// Counterpart to persistSIPInstalment, but for user-added investment types
// that ship with an "auto-deduct" field on their schema (e.g. chit fund,
// APY, ULIP, or anything a user designs). Posts the current period's
// instalment to the ledger if it hasn't been posted yet.
//
// Period idempotency is keyed off `autoDeductInvestmentId === inv.id` and
// the frequency stored on the investment (monthly / quarterly / yearly).
// The amount is resolved by findAutoDeductAmount() in investmentUtils so
// the scheduler and the per-holding ledger agree on what gets debited.

function autoDeductPeriodMatcher(frequency, now) {
  const yr = now.getFullYear();
  const mo = now.getMonth();
  if (frequency === "yearly") return (d) => d.getFullYear() === yr;
  if (frequency === "halfyearly") {
    const h = Math.floor(mo / 6);
    return (d) => d.getFullYear() === yr && Math.floor(d.getMonth() / 6) === h;
  }
  if (frequency === "quarterly") {
    const q = Math.floor(mo / 3);
    return (d) => d.getFullYear() === yr && Math.floor(d.getMonth() / 3) === q;
  }
  return (d) => d.getFullYear() === yr && d.getMonth() === mo;
}

// The date this period's instalment falls due. For quarterly/yearly the month
// is anchored to the investment's startDate (the debit recurs from there at the
// frequency interval); monthly / no-startDate falls back to the current month.
function autoDeductDueDate(inv, now) {
  const ad = inv.autoDeduct || {};
  const freq = ad.frequency || "monthly";
  const start = inv.startDate ? new Date(inv.startDate) : null;
  const dayPref = parseInt(ad.dayOfMonth) || (start ? start.getDate() : 1);
  const y = now.getFullYear();
  const at = (m) => new Date(y, m, Math.min(dayPref, new Date(y, m + 1, 0).getDate()));

  if (freq === "monthly" || !start) return at(now.getMonth());
  if (freq === "yearly") return at(start.getMonth());

  const anchor = start.getMonth();
  const interval = freq === "halfyearly" ? 6 : 3;
  const pStart = Math.floor(now.getMonth() / interval) * interval;
  for (let m = pStart; m < pStart + interval; m++) {
    if ((((m - anchor) % interval) + interval) % interval === 0) return at(m);
  }
  return at(now.getMonth());
}

// User-confirmed manual log of an auto-deduct payment. Unlike
// persistAutoDeductInstalment which writes the configured day (used by
// the scheduler / importer paths), this one takes the date the user
// actually saw the debit happen — typically today. The caller derives
// the amount from the schema's configured per-period figure, but a
// different value can be passed for the occasional bank fee / pro-rated
// month. Returns true if a tx was posted, false if blocked (already
// logged for the period, no amount, etc).
export const persistLogAutoDeductPayment =
  (inv, { occurredAt, amount, accountId } = {}) =>
  async (dispatch, getState) => {
    if (!inv?.id || !occurredAt) return false;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return false;

    const state = getState().transactions;
    const userTypes = state.transactionData?.investmentTypes ?? [];
    const schema = getInvestmentTypeSchema(inv.type, userTypes);

    const frequency = inv.autoDeduct?.frequency || "monthly";
    const matchesPeriod = autoDeductPeriodMatcher(frequency, new Date(occurredAt));

    // Period-level idempotency — only one logged tx per period per
    // investment. If the user taps the button twice, the second click
    // is a no-op rather than a duplicate row.
    const allTx = state.transactionData?.transactions ?? [];
    const exists = allTx.some(
      (t) =>
        t.autoDeductInvestmentId === inv.id &&
        matchesPeriod(new Date(t.occurredAt)),
    );
    if (exists) return false;

    dispatch(
      addTransaction({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        occurredAt,
        transactionType: "investment",
        amount: String(amt),
        name: inv.name,
        category: schema?.label || inv.type,
        autoDeductInvestmentId: inv.id,
        accountId: accountId || inv.autoDeduct?.accountId || undefined,
      }),
    );

    await persistDelta(getState, state.transactionData);
    return true;
  };

export const persistAutoDeductInstalment =
  (inv) => async (dispatch, getState) => {
    if (inv.paused || inv.inHistory) return;
    if (!inv.autoDeduct?.enabled) return;
    if (inv.startDate && new Date(inv.startDate) > new Date()) return;

    const state = getState().transactions;
    const userTypes = state.transactionData?.investmentTypes ?? [];
    const schema = getInvestmentTypeSchema(inv.type, userTypes);
    if (!schema) return;

    const amount = findAutoDeductAmount(inv, schema);
    if (amount <= 0) return;

    const frequency = inv.autoDeduct.frequency || "monthly";
    const now = new Date();
    const due = autoDeductDueDate(inv, now);
    if (due > now) return; // this period's debit day hasn't arrived yet
    const matchesPeriod = autoDeductPeriodMatcher(frequency, now);

    const allTx = state.transactionData?.transactions ?? [];
    const alreadyLogged = allTx.some(
      (t) =>
        t.autoDeductInvestmentId === inv.id &&
        matchesPeriod(new Date(t.occurredAt)),
    );
    if (alreadyLogged) return;

    const occurredAt = due.toISOString();

    dispatch(
      addTransaction({
        id: crypto.randomUUID(),
        createdAt: now.toISOString(),
        occurredAt,
        transactionType: "investment",
        amount: String(amount),
        name: inv.name,
        category: schema.label,
        autoDeductInvestmentId: inv.id,
        accountId: inv.autoDeduct.accountId || undefined,
      }),
    );

    await persistDelta(getState, state.transactionData);
  };

export const persistAddGoal = (goal) => async (dispatch, getState) => {
  dispatch(addGoal(goal));
  await persistEntityUpsert(getState, "goals", goal);
};

export const persistSaveTally = (tally) => async (dispatch, getState) => {
  dispatch(addTally(tally));
  await persistSettings(getState);
};

export const persistUpdateTally = (tally) => async (dispatch, getState) => {
  dispatch(updateTally(tally));
  await persistSettings(getState);
};

export const persistDeleteTally = (id) => async (dispatch, getState) => {
  dispatch(deleteTally(id));
  await persistSettings(getState);
};

export const persistUpdateGoal = (goal) => async (dispatch, getState) => {
  dispatch(updateGoal(goal));
  await persistEntityUpsert(getState, "goals", goal);
};

export const persistDeleteGoal = (id) => async (dispatch, getState) => {
  dispatch(deleteGoal(id));
  await persistEntityDelete(getState, "goals", id);
};

// ── Notes ─────────────────────────────────────────────
// Notes are a first-class collection (transactionData.notes), so they ride
// the generic entity-persist rails: DB users get a granular upsertEntity /
// deleteEntity mutation, Drive users fall back to a whole-blob write. Both
// paths are handled inside persistEntityUpsert / persistEntityDelete.
export const persistAddNote = (note) => async (dispatch, getState) => {
  dispatch(addNote(note));
  await persistEntityUpsert(getState, "notes", note);
};

export const persistUpdateNote = (note) => async (dispatch, getState) => {
  dispatch(updateNote(note));
  await persistEntityUpsert(getState, "notes", note);
};

export const persistDeleteNote = (id) => async (dispatch, getState) => {
  dispatch(deleteNote(id));
  await persistEntityDelete(getState, "notes", id);
};

// Recomputes insights.balance from scratch by walking every transaction:
//   balance = sum(income) - sum(expense) - sum(investment)
// Used to repair drift introduced by past bugs in the incremental balance
// reducers. Returns the diff so callers can show before/after to the user.
export const persistSetPreference =
  (key, value) => async (dispatch, getState) => {
    dispatch(setPreference({ key, value }));
    await persistSettings(getState);
  };

// Dismiss a single notification early. `expiresAt` is the event's own expiry
// (its cycle end), so the dismissal lapses on its own without ever needing a
// cleanup pass.
export const persistDismissNotification =
  ({ key, expiresAt }) => async (dispatch, getState) => {
    dispatch(dismissNotification({ key, expiresAt }));
    await persistSettings(getState);
  };

// Clear-all: dismiss every currently-visible notification in one write.
// `entries` is [{ key, expiresAt }, …].
export const persistClearNotifications =
  (entries) => async (dispatch, getState) => {
    dispatch(clearNotifications(entries));
    await persistSettings(getState);
  };

export const persistAddCategory =
  (scope, name) => async (dispatch, getState) => {
    dispatch(addCategory({ scope, name }));
    await persistSettings(getState);
  };

export const persistRenameCategory =
  (scope, oldName, newName) => async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    dispatch(renameCategory({ scope, oldName, newName }));
    await persistDelta(getState, before);
  };

export const persistRemoveCategory =
  (scope, name) => async (dispatch, getState) => {
    dispatch(removeCategory({ scope, name }));
    await persistSettings(getState);
  };

export const persistMoveCategory =
  (scope, name, direction) => async (dispatch, getState) => {
    dispatch(moveCategory({ scope, name, direction }));
    await persistSettings(getState);
  };

export const persistReorderCategory =
  (scope, fromIndex, toIndex) => async (dispatch, getState) => {
    dispatch(reorderCategory({ scope, fromIndex, toIndex }));
    await persistSettings(getState);
  };

export const persistSetList = (key, value) => async (dispatch, getState) => {
  dispatch(setList({ key, value }));
  await persistSettings(getState);
};

export const persistAddAutoCategoryRule =
  (rule) => async (dispatch, getState) => {
    dispatch(addAutoCategoryRule(rule));
    await persistSettings(getState);
  };

export const persistUpdateAutoCategoryRule =
  (rule) => async (dispatch, getState) => {
    dispatch(updateAutoCategoryRule(rule));
    await persistSettings(getState);
  };

export const persistRemoveAutoCategoryRule =
  (id) => async (dispatch, getState) => {
    dispatch(removeAutoCategoryRule(id));
    await persistSettings(getState);
  };

// Walks every existing transaction, applies the first matching auto-category
// rule whose scope matches, and writes the changes. Returns the number of
// transactions modified so the caller can toast a meaningful summary.
export const persistApplyRulesToPast =
  () => async (dispatch, getState) => {
    const state = getState();
    const data = state.transactions.transactionData;
    const rules = data.preferences?.autoCategoryRules ?? [];
    const cats = data.categories ?? { expense: [], income: [] };
    if (!rules.length || !data.transactions?.length) {
      dispatch(showToast({ message: "No rules to apply" }));
      return 0;
    }
    let updated = 0;
    for (const tx of data.transactions) {
      const scope =
        tx.transactionType === "income"
          ? "income"
          : tx.transactionType === "expense"
            ? "expense"
            : null;
      if (!scope) continue;
      const name = (tx.name ?? "").toLowerCase().trim();
      if (!name) continue;
      for (const rule of rules) {
        if (rule.scope !== scope) continue;
        const pat = (rule.pattern ?? "").toLowerCase().trim();
        if (!pat) continue;
        if (!name.includes(pat)) continue;
        if (tx.category === rule.category) break;
        if (!cats[scope]?.includes(rule.category)) break;
        dispatch(
          updateTransaction({
            oldTx: tx,
            newTx: { ...tx, category: rule.category },
          }),
        );
        updated += 1;
        break;
      }
    }
    if (updated > 0) {
      await persistDelta(getState, data);
    }
    dispatch(
      showToast({
        message:
          updated > 0
            ? `Re-categorised ${updated} transaction${updated === 1 ? "" : "s"}`
            : "No transactions matched any rule",
      }),
    );
    return updated;
  };

export const persistRecomputeBalance = () => async (dispatch, getState) => {
  const { transactionData, fileID } = getState().transactions;
  const txns = transactionData.transactions ?? [];
  const accounts = transactionData.accounts ?? [];
  const multiBankEnabled =
    transactionData.preferences?.multiBankEnabled ?? false;

  // In multi-bank mode use computeAggregateBalance so the stored value stays
  // in sync with exactly what the carousel shows (excludes orphaned txns).
  // In single-bank mode fall back to the simpler balanceDelta sum.
  const computed =
    multiBankEnabled && accounts.length > 0
      ? computeAggregateBalance(accounts, txns)
      : txns.reduce((sum, t) => sum + balanceDelta(t), 0);

  const stored = transactionData.insights?.balance ?? 0;
  const diff = stored - computed;
  if (Math.abs(diff) > 0.005) {
    dispatch(setInsightsBalance(computed));
    await persistSettings(getState);
  }
  dispatch(
    showToast({
      message:
        Math.abs(diff) < 0.005
          ? "Balance already matches transactions"
          : `Balance recomputed — adjusted by ₹${(-diff).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
    }),
  );
  return { stored, computed, diff };
};

// ── Bank Accounts (multi-bank tracking) thunks ───────

export const persistAddAccount =
  (account) => async (dispatch, getState) => {
    dispatch(addAccount(account));
    await persistEntityUpsert(getState, "accounts", account);
    dispatch(showToast({ message: `${account.bank} added` }));
  };

export const persistUpdateAccount =
  (account) => async (dispatch, getState) => {
    dispatch(updateAccount(account));
    await persistEntityUpsert(getState, "accounts", account);
  };

export const persistSetOpeningBalance =
  ({ accountId, amount }) =>
  async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    const acc = before.accounts?.find((a) => a.id === accountId);
    if (!acc) return;
    const value = parseFloat(amount) || 0;
    dispatch(updateAccount({ ...acc, openingBalance: value }));

    const existing = before.transactions?.find(
      (t) => t.openingForAccount === accountId,
    );
    let deletedOpeningId = null;
    if (existing) {
      if (value > 0) {
        dispatch(
          updateTransaction({
            oldTx: existing,
            newTx: { ...existing, amount: String(value) },
          }),
        );
      } else {
        dispatch(deleteTransaction(existing.id));
        deletedOpeningId = existing.id;
      }
    } else if (value > 0) {
      const now = new Date().toISOString();
      dispatch(
        addTransaction({
          id: crypto.randomUUID(),
          transactionType: "income",
          name: "Current Balance",
          category: "Current Balance",
          amount: String(value),
          accountId,
          openingForAccount: accountId,
          occurredAt: acc.createdAt ?? now,
          createdAt: now,
        }),
      );
    }

    await persistDelta(getState, before);
    if (deletedOpeningId && dbEnabled(currentEmail())) {
      try {
        await gql(DELETE_TRANSACTION_MUTATION, { id: deletedOpeningId });
      } catch {}
    }
  };

// Repair a corrupted opening ("Current Balance") entry: shift it by the current
// reconciliation drift so the computed balance lines up with the last verified
// balance, clearing the drift. Only the opening entry is touched — real
// transactions are untouched. (The auto-roll then re-anchors the checkpoint to
// the now-correct balance.) No-op when the account isn't verified / has no drift.
export const persistResetOpeningBalance =
  (accountId) => async (dispatch, getState) => {
    const data = getState().transactions.transactionData;
    const acc = data.accounts?.find((a) => a.id === accountId);
    if (!acc) return;
    const txns = data.transactions ?? [];
    const recon = getReconciliationDelta(acc, txns);
    const drift = recon ? recon.delta : 0;
    if (Math.abs(drift) < 0.5) return;
    const openingTx = txns.find((t) => t.openingForAccount === accountId);
    const currentOpening = openingTx
      ? parseFloat(openingTx.amount) || 0
      : parseFloat(acc.openingBalance) || 0;
    const corrected = Math.max(0, currentOpening - drift);
    await dispatch(persistSetOpeningBalance({ accountId, amount: corrected }));
    dispatch(showToast({ message: `${acc.bank} balance corrected` }));
  };

export const persistDeleteAccount =
  (id) => async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    const acc = before.accounts?.find((a) => a.id === id);
    const openingTxIds = (before.transactions ?? [])
      .filter((t) => t.openingForAccount === id)
      .map((t) => t.id);
    dispatch(deleteAccount(id));
    await persistDelta(getState, before);
    if (dbEnabled(currentEmail())) {
      try {
        await gql(DELETE_ENTITY_MUTATION, { collection: "accounts", id });
      } catch {}
      for (const tid of openingTxIds) {
        try {
          await gql(DELETE_TRANSACTION_MUTATION, { id: tid });
        } catch {}
      }
    }
    if (acc) dispatch(showToast({ message: `${acc.bank} removed` }));
  };

// Records a user-verified balance for an account + the date it reflects.
// Lets the Reconciliation chip compute drift vs the calculated balance.
export const persistVerifyAccountBalance =
  ({ id, balance, asOf }) =>
  async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    const acc = before.accounts?.find((a) => a.id === id);
    if (!acc) return;
    dispatch(
      updateAccount({
        ...acc,
        verifiedBalance: balance,
        verifiedAt: asOf ?? new Date().toISOString(),
      }),
    );
    await persistDelta(getState, before);
    dispatch(showToast({ message: `${acc.bank} balance verified` }));
  };

// Self transfer between two of the user's own bank accounts. Persisted as a
// single transaction with transactionType: "self_transfer" carrying both
// fromAccountId and toAccountId so per-bank balances net out cleanly while
// the aggregate `insights.balance` stays unchanged (balanceDelta returns 0).
export const persistSelfTransfer =
  ({ fromAccountId, toAccountId, amount, occurredAt, description }) =>
  async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    const now = new Date().toISOString();
    const tx = {
      id: crypto.randomUUID(),
      transactionType: "self_transfer",
      name: "Self Transfer",
      amount: String(parseFloat(amount) || 0),
      fromAccountId,
      toAccountId,
      occurredAt: occurredAt ?? now,
      createdAt: now,
      ...(description ? { description } : {}),
    };
    dispatch(addTransaction(tx));
    await persistDelta(getState, before);
    dispatch(showToast({ message: "Transfer recorded" }));
  };

// Bulk-tag past untagged transactions with account ids derived by the
// migration UI. `assignments` is an array of [txId, accountId] pairs.
export const persistBulkTagAccounts =
  (assignments) => async (dispatch, getState) => {
    if (!assignments?.length) return;
    const before = getState().transactions.transactionData;
    dispatch(bulkTagAccounts({ assignments }));
    await persistDelta(getState, before);
    dispatch(
      showToast({
        message: `Tagged ${assignments.length} transaction${assignments.length === 1 ? "" : "s"}`,
      }),
    );
  };

// ── Investment type schema thunks ────────────────────

export const persistAddInvestmentType =
  (type) => async (dispatch, getState) => {
    dispatch(addInvestmentType(type));
    await persistSettings(getState);
    dispatch(showToast({ message: `${type.label} added` }));
  };

export const persistUpdateInvestmentType =
  (type) => async (dispatch, getState) => {
    const before = getState().transactions.transactionData;
    const oldType = before?.investmentTypes?.find((t) => t.key === type.key);
    const balanceToggled =
      oldType != null &&
      (oldType.affectsBalance ?? true) !== (type.affectsBalance ?? true);

    dispatch(updateInvestmentType(type));
    const txDeletes = [];

    if (balanceToggled) {
      const investments = before.investments ?? [];
      const transactions = before.transactions ?? [];
      const typeLabel = type.label ?? "Investment";
      const wantsBalance = type.affectsBalance !== false;

      for (const inv of investments) {
        if (inv.type !== type.key || inv.inHistory) continue;
        // LIC and SIP manage their own per-payment ledgers — skip.
        if (inv.type === "lic" || inv.type === "sip") continue;
        const linkedTx = transactions.find(
          (t) => t.id === inv.id && t.transactionType === "investment",
        );
        if (!wantsBalance && linkedTx) {
          dispatch(deleteTransaction(inv.id));
          txDeletes.push(inv.id);
        } else if (wantsBalance && !linkedTx) {
          dispatch(
            addTransaction({
              id: inv.id,
              transactionType: "investment",
              name: inv.name,
              amount: String(investedValue(inv)),
              category: typeLabel,
              occurredAt: inv.startDate || inv.createdAt,
              createdAt: inv.createdAt,
            }),
          );
        }
      }

      // Warn if balance would go negative after applying the change.
      const updatedTxns = getState().transactions.transactionData?.transactions ?? [];
      let newBalance = 0;
      for (const t of updatedTxns) newBalance += balanceDelta(t);
      if (newBalance < 0) {
        dispatch(
          showToast({
            message: `Heads up: balance is now ₹${Math.abs(newBalance).toLocaleString("en-IN", { maximumFractionDigits: 2 })} negative after this change.`,
          }),
        );
      }
    }

    await persistDelta(getState, before);
    if (dbEnabled(currentEmail())) {
      for (const tid of txDeletes) {
        try {
          await gql(DELETE_TRANSACTION_MUTATION, { id: tid });
        } catch {}
      }
    }
  };

export const persistDeleteInvestmentType =
  (key) => async (dispatch, getState) => {
    dispatch(deleteInvestmentType(key));
    await persistSettings(getState);
  };

const LOAD_ALL_QUERY = `query LoadAll { loadAll }`;
const UPSERT_ALL_MUTATION = `mutation UpsertAll($data: JSON!) { upsertAll(data: $data) { id updatedAt } }`;
const BACKUP_QUERY = "name contains 'espresso-expenses-backup'";

export const persistDailyBackup =
  ({ force = false } = {}) =>
  async (dispatch, getState) => {
    if (!dbEnabled(currentEmail())) return false;

    const prefs = getState().transactions.transactionData?.preferences ?? {};
    const last = prefs.driveBackup;
    const now = new Date();
    if (!force && last?.at) {
      const prev = new Date(last.at);
      if (
        prev.getFullYear() === now.getFullYear() &&
        prev.getMonth() === now.getMonth() &&
        prev.getDate() === now.getDate()
      ) {
        return false;
      }
    }

    let snapshot;
    try {
      const res = await gql(LOAD_ALL_QUERY);
      snapshot = res.loadAll;
    } catch {
      return false;
    }
    if (!snapshot || snapshot.preferences == null) return false;

    const payload = {
      _backup: {
        app: "espresso-and-expenses",
        exportedAt: now.toISOString(),
        email: currentEmail(),
        version: 1,
      },
      data: snapshot,
    };
    const name = `espresso-expenses-backup-${now.toISOString().slice(0, 10)}.json`;

    let newId;
    try {
      newId = await uploadDriveFile(name, payload);
    } catch {
      return false;
    }

    try {
      const existing = await listDriveFiles(BACKUP_QUERY);
      for (const f of existing) {
        if (f.id !== newId) {
          try {
            await deleteDriveFile(f.id);
          } catch {}
        }
      }
    } catch {
      if (last?.fileId && last.fileId !== newId) {
        try {
          await deleteDriveFile(last.fileId);
        } catch {}
      }
    }

    dispatch(
      setPreference({
        key: "driveBackup",
        value: { at: now.toISOString(), fileId: newId },
      }),
    );
    await persistSettings(getState);
    return true;
  };

export async function listBackups() {
  if (!dbEnabled(currentEmail())) return [];
  const files = await listDriveFiles(BACKUP_QUERY);
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    size: f.size ? Number(f.size) : null,
  }));
}

export const persistRestoreFromBackup = (fileId) => async () => {
  if (!dbEnabled(currentEmail())) throw new Error("not a database account");
  const file = await downloadDriveFile(fileId);
  const data = file?.data ?? file;
  if (!data || typeof data !== "object" || data.preferences == null) {
    throw new Error("not a valid backup file");
  }
  await gql(UPSERT_ALL_MUTATION, { data });
  window.location.reload();
};

export default transactionSlice.reducer;
