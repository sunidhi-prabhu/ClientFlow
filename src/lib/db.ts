import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv, type ServerEnv } from "@/lib/env";

/** node-postgres pool settings for the application's connections. */
export function databasePoolConfig(env: ServerEnv) {
  return {
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    // node-postgres waits indefinitely by default: during a database outage
    // every request would hang instead of failing (and the health check report it).
    connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  };
}

function createPrismaClient() {
  const env = getServerEnv();
  const adapter = new PrismaPg(databasePoolConfig(env));
  return new PrismaClient({
    adapter,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// One client per server process, also reused across hot reloads in development
// so connection pools are not exhausted.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Shared Prisma client. Created lazily so importing this module (e.g. during
 * `next build`) does not require DATABASE_URL.
 *
 * Tenant-scoped data must only be accessed through the data-access layer in
 * `src/server`, which enforces organization scoping. See CLAUDE.md.
 */
export function getDb(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}
