import { serviceClient } from "./db/client";
import type { Env } from "./types";

type Row = Record<string, unknown>;
type Blob = Record<string, unknown>;

function num(v: unknown): number | null {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapTransaction(userId: string, t: Row): Row {
  return {
    id: t.id,
    user_id: userId,
    transaction_type: t.transactionType ?? null,
    amount: num(t.amount),
    category: t.category ?? null,
    name: t.name ?? t.source ?? null,
    payment_mode: t.paymentMode ?? null,
    occurred_at: iso(t.occurredAt ?? t.createdAt),
    created_at: iso(t.createdAt),
    account_id: t.accountId ?? null,
    from_account_id: t.fromAccountId ?? null,
    to_account_id: t.toAccountId ?? null,
    card_id: t.cardId ?? null,
    subscription_id: t.subscriptionId ?? null,
    sip_investment_id: t.sipInvestmentId ?? null,
    lic_policy_id: t.licPolicyId ?? null,
    auto_deduct_investment_id: t.autoDeductInvestmentId ?? null,
    repayment_for: t.repaymentFor ?? null,
    reference: t.reference ?? null,
    raw: t,
  };
}

function mapInvestment(userId: string, i: Row): Row {
  return {
    id: i.id,
    user_id: userId,
    type: i.type ?? null,
    name: i.name ?? null,
    ticker: i.ticker ?? null,
    invested_amount: num(i.investedAmount),
    current_value: num(i.currentValue),
    quantity: num(i.quantity),
    buy_price: num(i.buyPrice),
    current_price: num(i.currentPrice),
    start_date: iso(i.startDate),
    raw: i,
  };
}

function mapSimple(userId: string, x: Row, extra: Row = {}): Row {
  return { id: x.id, user_id: userId, name: x.name ?? null, ...extra, raw: x };
}

function mapNote(userId: string, x: Row): Row {
  const ref = (x.entityRef ?? {}) as Row;
  return {
    id: x.id,
    user_id: userId,
    scope: x.scope ?? null,
    page_key: x.pageKey ?? null,
    entity_type: ref.type ?? null,
    entity_id: ref.id ?? null,
    pinned: x.pinned === true,
    remind_at: iso(x.remindAt),
    updated_at: iso(x.updatedAt),
    raw: x,
  };
}

export const COLLECTION_MAP: Record<
  string,
  { table: string; map: (userId: string, x: Row) => Row }
> = {
  investments: { table: "investments", map: mapInvestment },
  accounts: {
    table: "accounts",
    map: (u, x) => mapSimple(u, x, { bank: x.bank ?? null }),
  },
  subscriptions: {
    table: "subscriptions",
    map: (u, x) =>
      mapSimple(u, x, {
        amount: num(x.amount),
        cycle: x.cycle ?? null,
        status: x.status ?? null,
      }),
  },
  cards: { table: "cards", map: mapSimple },
  commitments: {
    table: "commitments",
    map: (u, x) => mapSimple(u, x, { type: x.type ?? null }),
  },
  lendings: { table: "lendings", map: mapSimple },
  goals: { table: "goals", map: mapSimple },
  notes: { table: "notes", map: mapNote },
};

export const COLLECTION_KEYS = new Set([
  "transactions",
  ...Object.keys(COLLECTION_MAP),
]);

// Collections the client seeds lazily/partially (page-wise API) → a whole-blob
// sync may carry a truncated copy, so they must never be diff-deleted. See the
// long note inside syncTable.
const UPSERT_ONLY_TABLES = new Set(["transactions", "investments"]);

async function syncTable(
  env: Env,
  table: string,
  userId: string,
  items: Row[],
  map: (userId: string, x: Row) => Row,
  destructive = true,
) {
  const db = serviceClient(env);

  // Backfill a UUID for any id-less row instead of DROPPING it (the old
  // `.filter(x => x.id)` silently lost such rows). Clone so we never mutate the
  // caller's blob.
  const seen = new Set<string>();
  const rows = (items ?? [])
    .filter((x) => x && typeof x === "object")
    .map((x) => (x.id ? x : { ...x, id: crypto.randomUUID() }))
    .filter((x) => {
      const id = String(x.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((x) => map(userId, x));

  if (rows.length) {
    const { error } = await db.from(table).upsert(rows);
    if (error) throw new Error(`projection failed for ${table}: ${error.message}`);
  }

  // The large collections are seeded LAZILY/partially into the client blob via
  // the page-wise API. A whole-blob sync can therefore carry a TRUNCATED copy of
  // them, and the diff-delete below would wipe every stored row absent from that
  // partial blob — this destroyed weeks of real data twice. So they are never
  // destructively cleaned from a blob sync: adds/updates still project (upsert
  // above), and deletions go through the granular delete mutations instead. The
  // small bounded collections are always fully present in the blob, so their
  // cleanup below is safe and stays.
  // ponytail: per-table upsert-only guard. The real fix is moving ALL deletes to
  // granular mutations and dropping this whole-blob cleanup entirely.
  if (UPSERT_ONLY_TABLES.has(table)) return;
  if (!destructive) return;

  // SAFETY GUARD (added after a data-loss incident): the cleanup below deletes
  // every stored row NOT in this sync. A truncated in-memory blob would then
  // wipe real data. So refuse to destructively delete when the incoming set is
  // empty, or is suspiciously smaller than what's already stored — that pattern
  // means "bad/partial blob", not "user deleted almost everything".
  if (seen.size === 0) return;

  const { count } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const stored = count ?? 0;
  if (stored > 5 && seen.size < stored * 0.5) {
    console.warn(
      `syncTable(${table}): incoming ${seen.size} << stored ${stored} — skipping destructive cleanup to protect data`,
    );
    return;
  }

  const list = [...seen].map((id) => `"${id}"`).join(",");
  const { error } = await db
    .from(table)
    .delete()
    .eq("user_id", userId)
    .not("id", "in", `(${list})`);
  if (error) {
    throw new Error(`projection cleanup failed for ${table}: ${error.message}`);
  }
}

export async function syncSettings(env: Env, userId: string, data: Blob) {
  const settings: Row = {};
  for (const [k, v] of Object.entries(data)) {
    if (!COLLECTION_KEYS.has(k)) settings[k] = v;
  }
  const db = serviceClient(env);
  const { error } = await db
    .from("user_settings")
    .upsert({ user_id: userId, settings, updated_at: new Date().toISOString() });
  if (error) {
    throw new Error(`projection failed for user_settings: ${error.message}`);
  }
}

export async function projectToTables(
  env: Env,
  userId: string,
  data: Blob,
  destructive = true,
) {
  const tasks: Promise<void>[] = [
    syncTable(
      env,
      "transactions",
      userId,
      (data.transactions as Row[]) ?? [],
      mapTransaction,
      destructive,
    ),
    syncSettings(env, userId, data),
  ];
  for (const [key, meta] of Object.entries(COLLECTION_MAP)) {
    tasks.push(
      syncTable(
        env,
        meta.table,
        userId,
        (data[key] as Row[]) ?? [],
        meta.map,
        destructive,
      ),
    );
  }
  await Promise.all(tasks);
}
