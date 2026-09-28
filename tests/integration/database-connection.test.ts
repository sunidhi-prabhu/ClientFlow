import { describe, expect, it } from "vitest";

import { toAppError } from "@/lib/api/handle-error";
import { databasePoolConfig, getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

/*
 * Production-readiness: bounded database waits. A runaway statement is
 * cancelled by the server, and an unreachable database fails fast instead of
 * hanging every request.
 */

async function clientWith(overrides: Partial<ReturnType<typeof getServerEnv>>) {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  return new PrismaClient({
    adapter: new PrismaPg(databasePoolConfig({ ...getServerEnv(), ...overrides })),
  });
}

describe("database connection settings", () => {
  it("the application's connections carry the statement timeout", async () => {
    const [row] = await getDb().$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    expect(row.statement_timeout).toBe("30s");
  });

  it("a statement over the limit is cancelled and reported as a generic error", async () => {
    const client = await clientWith({ DATABASE_STATEMENT_TIMEOUT_MS: 1_000 });
    try {
      const started = Date.now();
      const error = await client.$queryRaw`SELECT pg_sleep(5)`.catch((caught: unknown) => caught);
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(String((error as Error).message)).toMatch(/statement timeout/);
      const appError = toAppError(error);
      expect([appError.status, appError.message]).toEqual([500, "An unexpected error occurred"]);
    } finally {
      await client.$disconnect();
    }
  });

  it("an unreachable database fails within the connect timeout instead of hanging", async () => {
    const client = await clientWith({
      // A non-routable address: without a timeout, connecting would wait for the OS (minutes).
      DATABASE_URL: "postgresql://app:secret@10.255.255.1:5432/clientflow",
      DATABASE_CONNECT_TIMEOUT_MS: 1_000,
    });
    try {
      const started = Date.now();
      await expect(client.$queryRaw`SELECT 1`).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await client.$disconnect();
    }
  });
});
