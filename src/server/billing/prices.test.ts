import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearBillingEnv,
  stubBillingEnv,
  TEST_BILLING_ENV,
} from "../../../tests/support/billing-env";

async function load() {
  vi.resetModules();
  return import("./prices");
}

describe("Stripe Price mapping", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    stubBillingEnv();
  });

  it("maps every paid plan and interval to its configured Price, and back", async () => {
    const { priceIdFor, planForPriceId } = await load();
    expect(priceIdFor("STARTER", "MONTH")).toBe(TEST_BILLING_ENV.STRIPE_PRICE_STARTER_MONTHLY);
    expect(priceIdFor("AGENCY", "YEAR")).toBe(TEST_BILLING_ENV.STRIPE_PRICE_AGENCY_ANNUAL);
    for (const plan of ["STARTER", "GROWTH", "PROFESSIONAL", "AGENCY"] as const) {
      for (const interval of ["MONTH", "YEAR"] as const) {
        expect(planForPriceId(priceIdFor(plan, interval))).toEqual({ plan, interval });
      }
    }
  });

  it("grants nothing for an unknown or missing Price (forged or misconfigured)", async () => {
    const { planForPriceId } = await load();
    expect(planForPriceId("price_forged")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
    expect(planForPriceId("")).toBeNull();
  });

  it("reports whether billing is configured", async () => {
    expect((await load()).isBillingConfigured()).toBe(true);
    clearBillingEnv();
    expect((await load()).isBillingConfigured()).toBe(false);
  });
});
