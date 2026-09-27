import { beforeEach, describe, expect, it, vi } from "vitest";

// env.ts caches the parsed result, so load a fresh copy per test.
async function loadEnv() {
  vi.resetModules();
  return import("@/lib/env");
}

describe("getServerEnv", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LOG_LEVEL", "");
  });

  it("parses a valid PostgreSQL configuration", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/clientflow");
    vi.stubEnv("LOG_LEVEL", "warn");
    const { getServerEnv } = await loadEnv();

    expect(getServerEnv()).toMatchObject({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/clientflow",
      LOG_LEVEL: "warn",
    });
  });

  it("rejects a missing DATABASE_URL with a readable message", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow(/Invalid environment configuration[\s\S]*DATABASE_URL/);
  });

  it("rejects non-PostgreSQL URLs", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@localhost:3306/clientflow");
    const { getServerEnv } = await loadEnv();
    expect(() => getServerEnv()).toThrow(/PostgreSQL/);
  });
});
