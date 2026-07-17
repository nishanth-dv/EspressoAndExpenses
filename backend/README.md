# Espresso & Expenses — Backend (Phase 0)

A thin Hono + TypeScript API that stores each enrolled user's `transactionData`
blob in a Supabase Postgres row. Everyone not on the allowlist keeps using Google
Drive via the frontend storage facade — this service is opt-in per user.

- **Runtime:** Hono, deployable to Cloudflare Workers (default), Deno, or Node.
- **Store:** Supabase Postgres, one `jsonb` row per user keyed by Google `sub`.
- **Auth:** the client sends its existing **Google access token**; the API verifies
  it against Google's `tokeninfo` endpoint, checks the token audience matches your
  Google client id, and checks the email allowlist. No second login, no extra SDK
  on the frontend.

## Why server-side Google verification (Phase 0)

The web app signs in with the Google OAuth *token client*, which issues an access
token (not an ID token). Rather than add a second Google credential flow, the API
verifies that access token directly. Row isolation is enforced in the API (every
query is scoped to the verified `sub`), and the table has RLS enabled with **no
policies**, so only this service's service-role key can reach it. When you later
move to a full auth provider (Supabase Auth / an IdP), only this middleware
changes.

## Endpoints

| Method | Path                | Body        | Returns               |
| ------ | ------------------- | ----------- | --------------------- |
| GET    | `/health`           | —           | `ok`                  |
| GET    | `/api/transactions` | —           | `{ data, updatedAt }` |
| PUT    | `/api/transactions` | `{ data }`  | `{ updatedAt }`       |

## Setup

1. Create a free Supabase project. In the SQL editor, run the migrations in
   [`supabase/`](supabase/) in filename order (`0001_*` → `0006_*`).
2. `npm install`
3. Copy `.dev.vars.example` → `.dev.vars` and fill in:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API)
   - `GOOGLE_CLIENT_ID` — the **same** id the web app uses (`VITE_GOOGLE_CLIENT_ID`)
   - `ALLOWLIST` — comma-separated emails (must match the frontend's `VITE_DB_USERS`)
4. `npm run dev` (local). Deploy with `npm run deploy`.
   Set production secrets with `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
   (and `SUPABASE_URL`, `GOOGLE_CLIENT_ID`); `ALLOWLIST` can live in
   `wrangler.toml` `[vars]`.

## Frontend wiring

The frontend storage facade (`src/utils/storage/`) routes allowlisted users here
and everyone else to Drive. It reuses the existing Google access token
(`getAccessToken()`), so there is nothing extra to wire on the client. In the web
app's `.env`:

```
VITE_API_URL=https://<your-worker>.workers.dev
VITE_DB_USERS=you@gmail.com           # must match this service's ALLOWLIST
```

## CORS

`APP_ORIGIN` controls allowed origins. Leave it **empty for local dev** (reflects
the caller's origin). In production set it to your app origin(s), comma-separated,
e.g. `APP_ORIGIN=https://your-app-domain` — anything else is rejected.

## Optimistic concurrency

`PUT /api/transactions` accepts `{ data, baseUpdatedAt }`. When `baseUpdatedAt` is
present, the write only applies if the row's current `updated_at` still matches —
otherwise it returns **409**. The frontend tracks the last-seen version and, on a
409, refetches and retries once (last-write-wins with a fresh base). This stops a
blind stale overwrite; true multi-device *merge* is deferred to Phase 1.

## Security notes

- The access token carries the app's Google scopes. This service only sends it to
  Google's `tokeninfo` for verification and never stores or reuses it. The audience
  check prevents tokens minted for other apps from being accepted.

## Deferred (TODOs)

- Phase 1: normalize the `jsonb` blob into per-entity tables.
- Later: migrate identity to Supabase Auth / a dedicated IdP (middleware-only change).
