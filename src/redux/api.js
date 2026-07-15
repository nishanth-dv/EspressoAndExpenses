import { createApi } from "@reduxjs/toolkit/query/react";
import { gql } from "../utils/graphql";

// RTK Query — the caching + page-wise data layer for DB users.
//
// Transport is unchanged: `gqlBaseQuery` wraps the existing gql() helper (which
// handles auth + the /graphql POST), so all the new value — caching, request
// de-duplication, loading/error state, and tag-based invalidation — lives in
// RTK Query while the wire protocol stays the same.
//
// IMPORTANT: these endpoints are DB-only. Google-Drive users have no queryable
// backend (their data is one JSON file), so they keep reading the in-memory
// blob loaded by `loadAll`. Consumers must branch on `dbEnabled(...)` and only
// use these hooks (with `skip`) when the DB is active.
const gqlBaseQuery =
  () =>
  async ({ query, variables }) => {
    try {
      const data = await gql(query, variables);
      return { data };
    } catch (err) {
      return { error: { message: err?.message || "request failed" } };
    }
  };

const TRANSACTIONS_QUERY = `query Transactions {
  transactions {
    items
    total
    hasMore
  }
}`;

const INVESTMENTS_QUERY = `query Investments {
  investments {
    items
    total
    hasMore
  }
}`;

const CORE_DATA_QUERY = `query CoreData { coreData }`;

const NOTIFICATION_FEED_QUERY = `query NotificationFeed { notificationFeed }`;

export const api = createApi({
  reducerPath: "api",
  baseQuery: gqlBaseQuery(),
  tagTypes: ["Transactions", "Investments"],
  endpoints: (build) => ({
    // The full transaction ledger via the page-wise API — NOT paginated for now.
    // Returns every raw transaction object so the ledger renders off this query
    // instead of the blob; the existing client-side filters run over the result.
    transactions: build.query({
      query: () => ({ query: TRANSACTIONS_QUERY }),
      transformResponse: (res) => res.transactions?.items ?? [],
      // Tag each row + the list so a transaction write invalidates the ledger.
      providesTags: (result) => [
        ...(result ?? []).map((t) => ({
          type: "Transactions",
          id: t?.id ?? "unknown",
        })),
        { type: "Transactions", id: "LIST" },
      ],
    }),
    // The full holdings list via the page-wise API — same full-fetch pattern.
    investments: build.query({
      query: () => ({ query: INVESTMENTS_QUERY }),
      transformResponse: (res) => res.investments?.items ?? [],
      providesTags: (result) => [
        ...(result ?? []).map((inv) => ({
          type: "Investments",
          id: inv?.id ?? "unknown",
        })),
        { type: "Investments", id: "LIST" },
      ],
    }),
    // Bundled bootstrap for settings + all SMALL bounded collections. One cheap
    // round trip; seeded into the blob so existing selectors keep working.
    coreData: build.query({
      query: () => ({ query: CORE_DATA_QUERY }),
      transformResponse: (res) => res.coreData ?? {},
    }),
    notificationFeed: build.query({
      query: () => ({ query: NOTIFICATION_FEED_QUERY }),
      transformResponse: (res) => res.notificationFeed ?? { investments: [] },
    }),
  }),
});

export const {
  useTransactionsQuery,
  useInvestmentsQuery,
  useCoreDataQuery,
  useNotificationFeedQuery,
} = api;
