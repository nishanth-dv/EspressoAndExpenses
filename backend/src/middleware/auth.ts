import { createMiddleware } from "hono/factory";
import { isAllowed } from "../config/allowlist";
import type { AppEnv, Env } from "../types";

interface TokenInfo {
  sub?: string;
  email?: string;
  email_verified?: string;
  aud?: string;
}

async function verifyToken(authHeader: string | undefined, env: Env) {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "missing token", status: 401 as const };
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) return { error: "invalid token", status: 401 as const };
  const info = (await res.json()) as TokenInfo;
  if (!info.sub || !info.email) return { error: "invalid token", status: 401 as const };
  if (info.aud !== env.GOOGLE_CLIENT_ID)
    return { error: "wrong audience", status: 401 as const };
  return { user: { sub: info.sub, email: info.email } };
}

// Verifies the Google token but does NOT require allowlist membership — used by
// the page-access endpoint so Drive (non-enrolled) users are gated too.
export const requireToken = createMiddleware<AppEnv>(async (c, next) => {
  const v = await verifyToken(c.req.header("Authorization"), c.env);
  if ("error" in v) return c.json({ error: v.error }, v.status);
  c.set("user", v.user);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const v = await verifyToken(c.req.header("Authorization"), c.env);
  if ("error" in v) return c.json({ error: v.error }, v.status);
  if (!isAllowed(v.user.email, c.env.ALLOWLIST))
    return c.json({ error: "not enrolled" }, 403);
  c.set("user", v.user);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const v = await verifyToken(c.req.header("Authorization"), c.env);
  if ("error" in v) return c.json({ error: v.error }, v.status);
  if (v.user.email.toLowerCase() !== (c.env.ADMIN ?? "").toLowerCase())
    return c.json({ error: "forbidden" }, 403);
  c.set("user", v.user);
  await next();
});
