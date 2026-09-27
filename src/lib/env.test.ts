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

describe("getAuthEnv", () => {
  const valid = {
    BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-chars-long",
    BETTER_AUTH_URL: "https://app.clientflow.example",
  };

  function stub(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  }

  it("parses a valid configuration with Google disabled", async () => {
    stub({ ...valid, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" });
    const { getAuthEnv } = await loadEnv();
    expect(getAuthEnv()).toMatchObject({ ...valid, GOOGLE_CLIENT_ID: undefined });
  });

  it("rejects a short secret", async () => {
    stub({ ...valid, BETTER_AUTH_SECRET: "too-short" });
    const { getAuthEnv } = await loadEnv();
    expect(() => getAuthEnv()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("requires both Google credentials or neither", async () => {
    stub({ ...valid, GOOGLE_CLIENT_ID: "id-only", GOOGLE_CLIENT_SECRET: "" });
    const { getAuthEnv } = await loadEnv();
    expect(() => getAuthEnv()).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("requires HTTPS in production except on localhost", async () => {
    stub({ ...valid, NODE_ENV: "production", BETTER_AUTH_URL: "http://app.clientflow.example" });
    expect((await loadEnv()).getAuthEnv).toThrow(/https/);

    stub({ BETTER_AUTH_URL: "http://localhost:3000" });
    expect((await loadEnv()).getAuthEnv()).toMatchObject({
      BETTER_AUTH_URL: "http://localhost:3000",
    });
  });
});
