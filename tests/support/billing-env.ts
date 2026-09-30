import { vi } from "vitest";

import { TEST_BILLING_ENV } from "./billing-config";

export { TEST_BILLING_ENV };

export function stubBillingEnv(
  overrides: Partial<Record<keyof typeof TEST_BILLING_ENV, string>> = {},
) {
  for (const [key, value] of Object.entries({ ...TEST_BILLING_ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
}

export function clearBillingEnv() {
  for (const key of Object.keys(TEST_BILLING_ENV)) vi.stubEnv(key, "");
}
