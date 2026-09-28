import { describe, expect, it } from "vitest";

import { databasePoolConfig } from "./db";

describe("databasePoolConfig", () => {
  it("bounds the pool, connection waits and statement time", () => {
    expect(
      databasePoolConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://app@db/clientflow",
        LOG_LEVEL: "info",
        DATABASE_POOL_MAX: 15,
        DATABASE_CONNECT_TIMEOUT_MS: 5_000,
        DATABASE_STATEMENT_TIMEOUT_MS: 20_000,
      }),
    ).toEqual({
      connectionString: "postgresql://app@db/clientflow",
      max: 15,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 20_000,
    });
  });
});
