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
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", LOG_LEVEL: "error" },
    // Tests share one database and truncate it between tests.
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
