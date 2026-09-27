import "dotenv/config";

import { defineConfig } from "vitest/config";

import baseConfig from "./vitest.config.mjs";

// Real PostgreSQL integration tests: `npm run test:integration`.
export default defineConfig({
  plugins: baseConfig.plugins,
  resolve: baseConfig.resolve,
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    // Point the application's database client at the test database. The URL
    // is validated (must end in `_test`) by the global setup before any test runs.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      LOG_LEVEL: "error",
      // Fixed auth configuration for tests (independent of the developer's .env).
      BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
      BETTER_AUTH_URL: "http://localhost:3000",
      // Google is configured so the standard provider can be exercised; no
      // request ever reaches Google.
      GOOGLE_CLIENT_ID: "test-google-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      // Never used: the mailer is replaced by an in-memory outbox (setup.ts).
      SMTP_URL: "smtp://127.0.0.1:2525",
      EMAIL_FROM: "ClientFlow <no-reply@clientflow.test>",
    },
    // Tests share one database and truncate it between tests.
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
