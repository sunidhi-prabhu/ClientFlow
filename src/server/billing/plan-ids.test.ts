import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearBillingEnv,
  stubBillingEnv,
  TEST_BILLING_ENV,
} from "../../../tests/support/billing-env";

async function load() {
  vi.resetModules();
  return import("./plan-ids");
}

describe("Razorpay plan mapping", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    stubBillingEnv();
  });

  it("maps every paid plan and interval to its configured Razorpay plan, and back", async () => {
    const { providerPlanIdFor, planForProviderPlanId } = await load();
    expect(providerPlanIdFor("STARTER", "MONTH")).toBe(
      TEST_BILLING_ENV.RAZORPAY_PLAN_STARTER_MONTHLY,
    );
    expect(providerPlanIdFor("AGENCY", "YEAR")).toBe(TEST_BILLING_ENV.RAZORPAY_PLAN_AGENCY_ANNUAL);
    for (const plan of ["STARTER", "GROWTH", "PROFESSIONAL", "AGENCY"] as const) {
      for (const interval of ["MONTH", "YEAR"] as const) {
        expect(planForProviderPlanId(providerPlanIdFor(plan, interval))).toEqual({
          plan,
          interval,
        });
      }
    }
  });

  it("grants nothing for an unknown or missing plan (forged or misconfigured)", async () => {
    const { planForProviderPlanId } = await load();
    expect(planForProviderPlanId("plan_forged")).toBeNull();
    expect(planForProviderPlanId(null)).toBeNull();
    expect(planForProviderPlanId("")).toBeNull();
  });

  it("reports whether billing is configured", async () => {
    expect((await load()).isBillingConfigured()).toBe(true);
    clearBillingEnv();
    expect((await load()).isBillingConfigured()).toBe(false);
  });
});
