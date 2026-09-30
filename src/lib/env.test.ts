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

    // (Production also needs client IP configuration, see below.)
    stub({ BETTER_AUTH_URL: "http://localhost:3000", AUTH_TRUSTED_PROXIES: "127.0.0.1" });
    expect((await loadEnv()).getAuthEnv()).toMatchObject({
      BETTER_AUTH_URL: "http://localhost:3000",
    });
  });

  it("requires explicit client IP configuration in production", async () => {
    stub({ ...valid, NODE_ENV: "production", AUTH_CLIENT_IP_HEADER: "", AUTH_TRUSTED_PROXIES: "" });
    expect((await loadEnv()).getAuthEnv).toThrow(/AUTH_CLIENT_IP_HEADER or AUTH_TRUSTED_PROXIES/);

    stub({ AUTH_TRUSTED_PROXIES: "10.0.0.0/8, 2001:db8::/32 ,203.0.113.7" });
    expect((await loadEnv()).getAuthEnv()).toMatchObject({
      AUTH_TRUSTED_PROXIES: ["10.0.0.0/8", "2001:db8::/32", "203.0.113.7"],
    });

    stub({ AUTH_TRUSTED_PROXIES: "", AUTH_CLIENT_IP_HEADER: "cf-connecting-ip" });
    expect((await loadEnv()).getAuthEnv()).toMatchObject({
      AUTH_CLIENT_IP_HEADER: "cf-connecting-ip",
    });
  });

  it("rejects malformed proxy lists and header names", async () => {
    stub({ ...valid, AUTH_TRUSTED_PROXIES: "10.0.0.0/33,not-an-ip" });
    expect((await loadEnv()).getAuthEnv).toThrow(/10\.0\.0\.0\/33, not-an-ip/);
    stub({ AUTH_TRUSTED_PROXIES: "", AUTH_CLIENT_IP_HEADER: "X-Real-IP: evil" });
    expect((await loadEnv()).getAuthEnv).toThrow(/AUTH_CLIENT_IP_HEADER/);
  });

  it("only lets tests turn rate limiting on (never off)", async () => {
    stub({ ...valid, AUTH_RATE_LIMIT: "off" });
    expect((await loadEnv()).getAuthEnv).toThrow(/AUTH_RATE_LIMIT/);
    stub({ AUTH_RATE_LIMIT: "on" });
    expect((await loadEnv()).getAuthEnv()).toMatchObject({ AUTH_RATE_LIMIT: "on" });
  });
});

describe("getServerEnv in production", () => {
  it("requires TLS for a non-local database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@db.internal:5432/clientflow");
    expect((await loadEnv()).getServerEnv).toThrow(/TLS/);

    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://app:secret@db.internal:5432/clientflow?sslmode=verify-full",
    );
    expect((await loadEnv()).getServerEnv()).toMatchObject({ NODE_ENV: "production" });

    vi.stubEnv("DATABASE_URL", "postgresql://app:secret@localhost:5432/clientflow");
    expect((await loadEnv()).getServerEnv()).toMatchObject({ NODE_ENV: "production" });
  });
});

describe("database connection settings", () => {
  it("default to bounded values and reject out-of-range ones", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/clientflow");
    expect((await loadEnv()).getServerEnv()).toMatchObject({
      DATABASE_POOL_MAX: 10,
      DATABASE_CONNECT_TIMEOUT_MS: 10_000,
      DATABASE_STATEMENT_TIMEOUT_MS: 30_000,
    });
    vi.stubEnv("DATABASE_POOL_MAX", "0");
    expect((await loadEnv()).getServerEnv).toThrow(/DATABASE_POOL_MAX/);
    vi.stubEnv("DATABASE_POOL_MAX", "25");
    vi.stubEnv("DATABASE_STATEMENT_TIMEOUT_MS", "5000");
    expect((await loadEnv()).getServerEnv()).toMatchObject({
      DATABASE_POOL_MAX: 25,
      DATABASE_STATEMENT_TIMEOUT_MS: 5_000,
    });
  });
});

describe("getBillingEnv", () => {
  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { clearBillingEnv } = await import("../../tests/support/billing-env");
    clearBillingEnv();
  });

  it("is optional: without Stripe variables billing is simply not configured", async () => {
    const { getBillingEnv } = await loadEnv();
    expect(getBillingEnv().STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("accepts a complete test-mode configuration", async () => {
    const { stubBillingEnv, TEST_BILLING_ENV } = await import("../../tests/support/billing-env");
    stubBillingEnv();
    const { getBillingEnv } = await loadEnv();
    expect(getBillingEnv()).toMatchObject(TEST_BILLING_ENV);
  });

  it("refuses a partial configuration, naming what is missing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc");
    const { getBillingEnv } = await loadEnv();
    expect(() => getBillingEnv()).toThrow(/STRIPE_WEBHOOK_SECRET[\s\S]*STRIPE_PRICE_AGENCY_ANNUAL/);
  });

  it("refuses live keys outside production", async () => {
    const { stubBillingEnv } = await import("../../tests/support/billing-env");
    stubBillingEnv({ STRIPE_SECRET_KEY: "sk_live_abc123" });
    const { getBillingEnv } = await loadEnv();
    expect(() => getBillingEnv()).toThrow(/test-mode key/);
  });

  it("refuses malformed ids and the same Price for two plans", async () => {
    const { stubBillingEnv } = await import("../../tests/support/billing-env");
    stubBillingEnv({ STRIPE_PRICE_GROWTH_MONTHLY: "prod_123" });
    let env = await loadEnv();
    expect(() => env.getBillingEnv()).toThrow(
      /STRIPE_PRICE_GROWTH_MONTHLY: must be a Stripe Price id/,
    );

    stubBillingEnv({ STRIPE_PRICE_GROWTH_MONTHLY: "price_startermonthly" });
    env = await loadEnv();
    expect(() => env.getBillingEnv()).toThrow(/its own Stripe Price id/);
  });
});
