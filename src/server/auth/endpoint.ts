import "server-only";

import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { cookies, headers } from "next/headers";

import { getAuthEnv } from "@/lib/env";
import { getAuth } from "@/server/auth/auth";
import { AuthEndpointError } from "@/server/auth/errors";

/** Request headers that describe the incoming Server Action, not the auth call. */
const DROPPED_HEADERS = [
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "host",
  "next-action",
  "next-router-state-tree",
];

/**
 * Call a Better Auth endpoint from a Server Action through its HTTP handler.
 *
 * `auth.api.*` calls skip Better Auth's router, and with it the rate limiter,
 * the origin check and `disabledPaths`. Going through the handler applies the
 * same pipeline as `/api/auth/*`, with the caller's own headers (client IP,
 * cookies, origin). Cookies the endpoint sets or clears are copied onto the
 * Server Action response (Better Auth's `nextCookies` does not run for
 * handler requests).
 */
export async function callAuthEndpoint<T = unknown>(path: `/${string}`, body: unknown): Promise<T> {
  const env = getAuthEnv();
  const forwarded = new Headers(await headers());
  for (const name of DROPPED_HEADERS) forwarded.delete(name);
  forwarded.set("content-type", "application/json");
  // Browsers always send Origin with Server Actions (Next.js has already
  // verified it); outside a browser, the call is attributed to the app itself.
  if (!forwarded.has("origin")) forwarded.set("origin", new URL(env.BETTER_AUTH_URL).origin);

  const response = await getAuth().handler(
    new Request(new URL(`/api/auth${path}`, env.BETTER_AUTH_URL), {
      method: "POST",
      headers: forwarded,
      body: JSON.stringify(body ?? {}),
    }),
  );

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const store = await cookies();
    parseSetCookieHeader(setCookie).forEach((cookie, name) => {
      if (name) store.set(name, cookie.value, toCookieOptions(cookie));
    });
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new AuthEndpointError(
      response.status,
      data && typeof data === "object" ? (data as AuthEndpointError["body"]) : undefined,
    );
  }
  return data as T;
}
