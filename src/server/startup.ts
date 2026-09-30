import "server-only";

import { getAuthEnv, getBillingEnv, getEmailEnv, getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/*
 * Process-level hooks, called from src/instrumentation.ts.
 */

/**
 * Validate every configuration group when the server starts. The getters are
 * otherwise lazy (so `next build` needs no secrets), which would let a
 * misconfigured deployment start and then fail requests one by one. Throwing
 * here stops the server before it accepts traffic.
 */
export function validateConfigurationAtStartup(): void {
  const server = getServerEnv();
  getAuthEnv();
  getEmailEnv();
  const billing = getBillingEnv();
  logger.info("Configuration validated", {
    nodeEnv: server.NODE_ENV,
    billing: billing.STRIPE_SECRET_KEY ? "stripe" : "not configured",
  });
}

/** Log why the configuration is invalid and stop the process (exit code 1). */
export function exitOnInvalidConfiguration(
  error: unknown,
  exit: (code: number) => never = process.exit,
) {
  logger.error("Invalid configuration: refusing to start", {
    error: error instanceof Error ? error.message : String(error),
  });
  exit(1);
}

type RequestInfo = { path: string; method: string };
type ErrorContext = { routePath?: string; routeType?: string };

/**
 * One structured log line per server error (Server Components, Route Handlers,
 * Server Actions, proxy), with the digest users see on the error page so a
 * report can be matched to its log entry. The query string is dropped: it can
 * carry tokens (e.g. password-reset links).
 */
export function reportRequestError(error: unknown, request: RequestInfo, context: ErrorContext) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  logger.error("Request failed", {
    digest,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    error,
  });
}
