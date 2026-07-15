import { createSchema } from "graphql-yoga";
import { GraphQLScalarType, Kind } from "graphql";
import type { ValueNode } from "graphql";
import { serviceClient } from "../db/client";
import {
  mapTransaction,
  COLLECTION_MAP,
  projectToTables,
  syncSettings,
} from "../projection";
import type { Env } from "../types";

export interface GqlContext {
  env: Env;
  userId: string;
}

type Row = Record<string, unknown>;

function parseLiteral(ast: ValueNode): unknown {
  switch (ast.kind) {
    case Kind.STRING:
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return ast.values.map(parseLiteral);
    case Kind.OBJECT: {
      const obj: Record<string, unknown> = {};
      for (const f of ast.fields) obj[f.name.value] = parseLiteral(f.value);
      return obj;
    }
    default:
      return null;
  }
}

const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  description: "Arbitrary JSON value",
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral,
});

// Fetch EVERY row's `raw` for a user, paging past PostgREST's max-rows cap. A
// plain `.select()` or `.limit(n)` is silently truncated by that server cap, so
// we range through and — crucially — advance the cursor by the number of rows
// ACTUALLY returned (the server may hand back fewer than requested when its cap
// is below our page size), stopping only on an empty page. Works for any cap.
async function fetchRawRows(
  db: ReturnType<typeof serviceClient>,
  table: string,
  userId: string,
  orderCol?: string,
) {
  const PAGE = 1000;
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    let q = db.from(table).select("raw").eq("user_id", userId);
    if (orderCol) q = q.order(orderCol, { ascending: false });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Row[];
    if (batch.length === 0) break;
    rows.push(...batch);
    from += batch.length;
  }
  return rows;
}

async function loadRaw(
  db: ReturnType<typeof serviceClient>,
  table: string,
  userId: string,
) {
  const rows = await fetchRawRows(db, table, userId);
  return rows
    .map((r) => r.raw as Row)
    .sort((a, b) =>
      String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")),
    );
}

async function listSimple(ctx: GqlContext, table: string, map: (r: Row) => Row) {
  const db = serviceClient(ctx.env);
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map(map);
}

export const schema = createSchema<GqlContext>({
  typeDefs: /* GraphQL */ `
    scalar JSON
    type Account {
      id: ID!
      name: String
      bank: String
    }
    type Subscription {
      id: ID!
      name: String
      amount: Float
      cycle: String
      status: String
    }
    type Card {
      id: ID!
      name: String
    }
    type Commitment {
      id: ID!
      name: String
      type: String
    }
    type Lending {
      id: ID!
      name: String
    }
    type Goal {
      id: ID!
      name: String
    }
    type CategorySpend {
      category: String
      total: Float
    }
    type TypeAllocation {
      type: String
      invested: Float
      currentValue: Float
    }
    type TransactionResult {
      items: JSON
      total: Int!
      hasMore: Boolean!
    }
    type InvestmentResult {
      items: JSON
      total: Int!
      hasMore: Boolean!
    }
    type ConcentrationSlice {
      label: String
      type: String
      value: Float
      pct: Float
    }
    type Concentration {
      totalValue: Float
      topHolding: ConcentrationSlice
      topType: ConcentrationSlice
    }
    type Query {
      transactions: TransactionResult!
      investments: InvestmentResult!
      accounts: [Account!]!
      subscriptions: [Subscription!]!
      cards: [Card!]!
      commitments: [Commitment!]!
      lendings: [Lending!]!
      goals: [Goal!]!
      spendingByCategory(since: String): [CategorySpend!]!
      allocationByType: [TypeAllocation!]!
      concentration: Concentration
      loadAll: JSON
      coreData: JSON
      notificationFeed: JSON
    }
    type MutationResult {
      id: ID!
      updatedAt: String!
    }
    type Mutation {
      addTransaction(transaction: JSON!): MutationResult!
      updateTransaction(transaction: JSON!): MutationResult!
      deleteTransaction(id: ID!): MutationResult!
      upsertEntity(collection: String!, entity: JSON!): MutationResult!
      deleteEntity(collection: String!, id: ID!): MutationResult!
      bulkUpsertTransactions(transactions: JSON!): MutationResult!
      updateSettings(data: JSON!): MutationResult!
      upsertAll(data: JSON!): MutationResult!
      syncAll(data: JSON!): MutationResult!
    }
  `,
  resolvers: {
    JSON: JSONScalar,
    Query: {
      transactions: async (_p, _args, ctx) => {
        // Full ledger, not paginated — every raw transaction (batched past the
        // row cap), newest first. The client filters/renders it off the blob.
        const db = serviceClient(ctx.env);
        const rows = await fetchRawRows(db, "transactions", ctx.userId, "occurred_at");
        const items = rows.map((r) => r.raw);
        return { items, total: items.length, hasMore: false };
      },
      investments: async (_p, _args, ctx) => {
        // Full holdings list, not paginated — every raw investment (batched past
        // the row cap), newest first. Client computes performance off the blob.
        const db = serviceClient(ctx.env);
        const rows = await fetchRawRows(db, "investments", ctx.userId, "start_date");
        const items = rows.map((r) => r.raw);
        return { items, total: items.length, hasMore: false };
      },
      accounts: (_p, _a, ctx) =>
        listSimple(ctx, "accounts", (r) => ({
          id: r.id,
          name: r.name,
          bank: r.bank,
        })),
      subscriptions: (_p, _a, ctx) =>
        listSimple(ctx, "subscriptions", (r) => ({
          id: r.id,
          name: r.name,
          amount: r.amount,
          cycle: r.cycle,
          status: r.status,
        })),
      cards: (_p, _a, ctx) =>
        listSimple(ctx, "cards", (r) => ({ id: r.id, name: r.name })),
      commitments: (_p, _a, ctx) =>
        listSimple(ctx, "commitments", (r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
        })),
      lendings: (_p, _a, ctx) =>
        listSimple(ctx, "lendings", (r) => ({ id: r.id, name: r.name })),
      goals: (_p, _a, ctx) =>
        listSimple(ctx, "goals", (r) => ({ id: r.id, name: r.name })),
      spendingByCategory: async (_p, args, ctx) => {
        const db = serviceClient(ctx.env);
        const { data, error } = await db.rpc("spending_by_category", {
          p_user_id: ctx.userId,
          p_since: args.since ?? null,
        });
        if (error) throw new Error(error.message);
        return data ?? [];
      },
      allocationByType: async (_p, _a, ctx) => {
        const db = serviceClient(ctx.env);
        const { data, error } = await db.rpc("allocation_by_type", {
          p_user_id: ctx.userId,
        });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r: Row) => ({
          type: r.type,
          invested: r.invested,
          currentValue: r.current_value,
        }));
      },
      concentration: async (_p, _a, ctx) => {
        const db = serviceClient(ctx.env);
        const { data, error } = await db
          .from("investments")
          .select("name, type, invested_amount, current_value, quantity, current_price")
          .eq("user_id", ctx.userId);
        if (error) throw new Error(error.message);

        const items = (data ?? []).map((r: Row) => {
          const cv = r.current_value;
          const qty = r.quantity;
          const px = r.current_price;
          const inv = r.invested_amount;
          let value = 0;
          if (cv != null) value = Number(cv);
          else if (qty != null && px != null) value = Number(qty) * Number(px);
          else if (inv != null) value = Number(inv);
          return { label: String(r.name ?? ""), type: String(r.type ?? ""), value };
        });

        const total = items.reduce((s, i) => s + (i.value || 0), 0);
        if (total <= 0) {
          return { totalValue: 0, topHolding: null, topType: null };
        }

        const topHolding = items.reduce(
          (a, b) => (b.value > a.value ? b : a),
          items[0],
        );

        const byType = new Map<string, number>();
        for (const i of items) {
          byType.set(i.type, (byType.get(i.type) ?? 0) + i.value);
        }
        let topTypeKey = "";
        let topTypeVal = -1;
        for (const [k, v] of byType) {
          if (v > topTypeVal) {
            topTypeKey = k;
            topTypeVal = v;
          }
        }

        return {
          totalValue: total,
          topHolding: {
            label: topHolding.label,
            type: topHolding.type,
            value: topHolding.value,
            pct: topHolding.value / total,
          },
          topType: {
            label: topTypeKey,
            type: topTypeKey,
            value: topTypeVal,
            pct: topTypeVal / total,
          },
        };
      },
      loadAll: async (_p, _a, ctx) => {
        const db = serviceClient(ctx.env);
        const result: Row = {};

        const { data: settingsRow, error } = await db
          .from("user_settings")
          .select("settings")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        Object.assign(result, (settingsRow?.settings as Row) ?? {});

        result.transactions = await loadRaw(db, "transactions", ctx.userId);
        for (const [key, meta] of Object.entries(COLLECTION_MAP)) {
          result[key] = await loadRaw(db, meta.table, ctx.userId);
        }
        return result;
      },
      // Lightweight bootstrap: settings/preferences + all SMALL bounded
      // collections, but NOT the large ones (transactions/investments) which
      // load lazily per-page via their own queries. This is the eventual
      // replacement for loadAll's role once every page is page-wise.
      coreData: async (_p, _a, ctx) => {
        const db = serviceClient(ctx.env);
        const result: Row = {};

        const { data: settingsRow, error } = await db
          .from("user_settings")
          .select("settings")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        Object.assign(result, (settingsRow?.settings as Row) ?? {});

        for (const [key, meta] of Object.entries(COLLECTION_MAP)) {
          if (key === "investments") continue; // large — loaded per-page
          result[key] = await loadRaw(db, meta.table, ctx.userId);
        }
        return result;
      },
      notificationFeed: async (_p, _a, ctx) => {
        const db = serviceClient(ctx.env);
        const invRows = await fetchRawRows(
          db,
          "investments",
          ctx.userId,
          "start_date",
        );
        return { investments: invRows.map((r) => r.raw) };
      },
    },
    Mutation: {
      addTransaction: async (_p, args, ctx) => {
        const tx = args.transaction as Row;
        if (!tx || typeof tx !== "object") {
          throw new Error("invalid transaction");
        }
        if (!tx.id) tx.id = crypto.randomUUID();
        if (!tx.createdAt) tx.createdAt = new Date().toISOString();

        const db = serviceClient(ctx.env);

        const linkCol = tx.sipInvestmentId
          ? "sip_investment_id"
          : tx.autoDeductInvestmentId
            ? "auto_deduct_investment_id"
            : null;
        const linkId = tx.sipInvestmentId ?? tx.autoDeductInvestmentId;
        if (linkCol && linkId) {
          const occ = new Date(String(tx.occurredAt ?? tx.createdAt));
          if (!Number.isNaN(occ.getTime())) {
            const start = new Date(
              occ.getFullYear(),
              occ.getMonth(),
              1,
            ).toISOString();
            const end = new Date(
              occ.getFullYear(),
              occ.getMonth() + 1,
              1,
            ).toISOString();
            const { data: existing } = await db
              .from("transactions")
              .select("id")
              .eq("user_id", ctx.userId)
              .eq(linkCol, linkId)
              .gte("occurred_at", start)
              .lt("occurred_at", end)
              .neq("id", String(tx.id))
              .limit(1);
            if (existing && existing.length > 0) {
              return {
                id: String(existing[0].id),
                updatedAt: new Date().toISOString(),
              };
            }
          }
        }

        const { error } = await db
          .from("transactions")
          .upsert(mapTransaction(ctx.userId, tx));
        if (error) throw new Error(error.message);

        return { id: String(tx.id), updatedAt: new Date().toISOString() };
      },
      updateTransaction: async (_p, args, ctx) => {
        const tx = args.transaction as Row;
        if (!tx || !tx.id) throw new Error("transaction id required");

        const db = serviceClient(ctx.env);
        const { error } = await db
          .from("transactions")
          .upsert(mapTransaction(ctx.userId, tx));
        if (error) throw new Error(error.message);

        return { id: String(tx.id), updatedAt: new Date().toISOString() };
      },
      deleteTransaction: async (_p, args, ctx) => {
        const id = String(args.id);
        const db = serviceClient(ctx.env);

        const { data: row } = await db
          .from("transactions")
          .select("raw")
          .eq("user_id", ctx.userId)
          .eq("id", id)
          .maybeSingle();
        const target = (row?.raw ?? null) as Row | null;

        const { error } = await db
          .from("transactions")
          .delete()
          .eq("user_id", ctx.userId)
          .eq("id", id);
        if (error) throw new Error(error.message);

        if (
          target &&
          target.transactionType === "investment" &&
          !target.sipInvestmentId &&
          !target.licPolicyId
        ) {
          await db
            .from("investments")
            .delete()
            .eq("user_id", ctx.userId)
            .eq("id", id);
        }

        return { id, updatedAt: new Date().toISOString() };
      },
      upsertEntity: async (_p, args, ctx) => {
        const collection = String(args.collection);
        const meta = COLLECTION_MAP[collection];
        if (!meta) throw new Error("unknown collection");

        const entity = args.entity as Row;
        if (!entity || !entity.id) throw new Error("entity id required");

        const db = serviceClient(ctx.env);
        const { error } = await db
          .from(meta.table)
          .upsert(meta.map(ctx.userId, entity));
        if (error) throw new Error(error.message);

        return { id: String(entity.id), updatedAt: new Date().toISOString() };
      },
      deleteEntity: async (_p, args, ctx) => {
        const collection = String(args.collection);
        const meta = COLLECTION_MAP[collection];
        if (!meta) throw new Error("unknown collection");

        const id = String(args.id);
        const db = serviceClient(ctx.env);
        const { error } = await db
          .from(meta.table)
          .delete()
          .eq("user_id", ctx.userId)
          .eq("id", id);
        if (error) throw new Error(error.message);

        return { id, updatedAt: new Date().toISOString() };
      },
      bulkUpsertTransactions: async (_p, args, ctx) => {
        const txs = args.transactions as Row[];
        if (!Array.isArray(txs)) throw new Error("invalid transactions");
        if (txs.length === 0) {
          return { id: ctx.userId, updatedAt: new Date().toISOString() };
        }
        const rows = txs.map((t) => {
          if (!t.id) t.id = crypto.randomUUID();
          if (!t.createdAt) t.createdAt = new Date().toISOString();
          return mapTransaction(ctx.userId, t);
        });
        const db = serviceClient(ctx.env);
        const { error } = await db.from("transactions").upsert(rows);
        if (error) throw new Error(error.message);
        return { id: ctx.userId, updatedAt: new Date().toISOString() };
      },
      updateSettings: async (_p, args, ctx) => {
        const data = args.data as Record<string, unknown>;
        if (!data || typeof data !== "object") {
          throw new Error("invalid data");
        }
        await syncSettings(ctx.env, ctx.userId, data);
        return { id: ctx.userId, updatedAt: new Date().toISOString() };
      },
      upsertAll: async (_p, args, ctx) => {
        const data = args.data as Record<string, unknown>;
        if (!data || typeof data !== "object") {
          throw new Error("invalid data");
        }
        await projectToTables(ctx.env, ctx.userId, data, false);
        return { id: ctx.userId, updatedAt: new Date().toISOString() };
      },
      syncAll: async (_p, args, ctx) => {
        const data = args.data as Record<string, unknown>;
        if (!data || typeof data !== "object") {
          throw new Error("invalid data");
        }
        await projectToTables(ctx.env, ctx.userId, data);
        return { id: ctx.userId, updatedAt: new Date().toISOString() };
      },
    },
  },
});
