import "server-only";

import { type AuthEnv } from "@/lib/env";

/**
 * How Better Auth determines the client IP for rate limiting and audit
 * records. Next.js keeps a client-supplied `X-Forwarded-For` as is, and
 * Better Auth's default trusts a single-value header, so without this a
 * client could pick its own IP (and a fresh rate-limit bucket) per request.
 *
 * - `AUTH_CLIENT_IP_HEADER`: a header the edge sets and overwrites
 *   (e.g. `cf-connecting-ip`, `x-real-ip`), read instead of X-Forwarded-For.
 * - `AUTH_TRUSTED_PROXIES`: the proxies in front of the app; their entries are
 *   stripped from the right of X-Forwarded-For and the first untrusted hop is
 *   the client, so values a client prepends are ignored.
 *
 * Production requires one of them (src/lib/env.ts).
 */
export function clientIpOptions(
  env: Pick<AuthEnv, "AUTH_CLIENT_IP_HEADER" | "AUTH_TRUSTED_PROXIES">,
) {
  return {
    ...(env.AUTH_CLIENT_IP_HEADER ? { ipAddressHeaders: [env.AUTH_CLIENT_IP_HEADER] } : {}),
    ...(env.AUTH_TRUSTED_PROXIES?.length ? { trustedProxies: env.AUTH_TRUSTED_PROXIES } : {}),
  };
}
