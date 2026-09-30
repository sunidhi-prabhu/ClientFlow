import { afterEach, describe, expect, it, vi } from "vitest";

const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:secret@db.internal:5432/clientflow?sslmode=verify-full",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-chars-long",
  BETTER_AUTH_URL: "https://app.clientflow.example",
  AUTH_TRUSTED_PROXIES: "10.0.0.0/8",
  SMTP_URL: "smtps://user:pass@smtp.example.com:465",
  EMAIL_FROM: "ClientFlow <no-reply@clientflow.example>",
  // Billing not configured (paid plans unavailable).
  STRIPE_SECRET_KEY: "",
};

async function load() {
  vi.resetModules();
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  vi.doMock("@/lib/logger", () => ({ logger }));
  return { ...(await import("./startup")), logger };
}

afterEach(() => {
  vi.doUnmock("@/lib/logger");
});

describe("validateConfigurationAtStartup", () => {
  it("accepts a complete production configuration", async () => {
    for (const [key, value] of Object.entries(valid)) vi.stubEnv(key, value);
    const { validateConfigurationAtStartup, logger } = await load();
    expect(() => validateConfigurationAtStartup()).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith("Configuration validated", {
      nodeEnv: "production",
      billing: "not configured",
    });
  });

  it.each([
    ["the auth secret", { BETTER_AUTH_SECRET: "short" }, /BETTER_AUTH_SECRET/],
    ["client IP configuration", { AUTH_TRUSTED_PROXIES: "" }, /AUTH_TRUSTED_PROXIES/],
    ["email settings", { SMTP_URL: "" }, /SMTP_URL/],
    ["TLS to the database", { DATABASE_URL: "postgresql://a:b@db.internal:5432/x" }, /TLS/],
    ["complete Stripe settings", { STRIPE_SECRET_KEY: "sk_live_abc123" }, /STRIPE_WEBHOOK_SECRET/],
  ])("refuses to start without valid %s", async (_label, override, message) => {
    for (const [key, value] of Object.entries({ ...valid, ...override })) vi.stubEnv(key, value);
    const { validateConfigurationAtStartup } = await load();
    expect(() => validateConfigurationAtStartup()).toThrow(message);
  });
});

describe("exitOnInvalidConfiguration", () => {
  it("logs the reason and exits with code 1", async () => {
    const { exitOnInvalidConfiguration, logger } = await load();
    const exit = vi.fn() as unknown as (code: number) => never;
    exitOnInvalidConfiguration(
      new Error("Invalid environment configuration:\n  - SMTP_URL: Required"),
      exit,
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith("Invalid configuration: refusing to start", {
      error: "Invalid environment configuration:\n  - SMTP_URL: Required",
    });
  });
});

describe("reportRequestError", () => {
  it("logs one structured entry with the digest and without the query string", async () => {
    const { reportRequestError, logger } = await load();
    const error = Object.assign(new Error("boom"), { digest: "1234567" });
    reportRequestError(
      error,
      { path: "/reset-password?token=secret-reset-token", method: "GET" },
      { routePath: "/(auth)/reset-password", routeType: "render" },
    );
    expect(logger.error).toHaveBeenCalledWith("Request failed", {
      digest: "1234567",
      method: "GET",
      path: "/reset-password",
      routePath: "/(auth)/reset-password",
      routeType: "render",
      error,
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-reset-token");
  });
});
