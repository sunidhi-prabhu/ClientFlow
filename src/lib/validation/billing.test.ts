import { describe, expect, it } from "vitest";

import { checkoutSessionIdSchema, paidPlanInput } from "./billing";

describe("paidPlanInput", () => {
  it("accepts a paid plan and interval, and strips everything else", () => {
    expect(
      paidPlanInput.parse({
        plan: "GROWTH",
        interval: "YEAR",
        priceId: "price_cheap",
        organizationId: "org_other",
        clientLimit: 10_000,
        status: "ACTIVE",
      }),
    ).toEqual({ plan: "GROWTH", interval: "YEAR" });
  });

  it.each([
    [{ plan: "ENTERPRISE", interval: "MONTH" }],
    [{ plan: "FREE", interval: "MONTH" }],
    [{ plan: "growth", interval: "MONTH" }],
    [{ plan: "GROWTH", interval: "WEEK" }],
    [{ plan: "GROWTH" }],
    [{}],
  ])("rejects forged or incomplete input %j", (input) => {
    expect(paidPlanInput.safeParse(input).success).toBe(false);
  });
});

describe("checkoutSessionIdSchema", () => {
  it("accepts Checkout Session ids only", () => {
    expect(checkoutSessionIdSchema.safeParse("cs_test_a1B2c3D4e5F6g7").success).toBe(true);
    for (const value of ["sub_123", "cs_test_", "cs_test_abc'--", "", undefined]) {
      expect(checkoutSessionIdSchema.safeParse(value).success).toBe(false);
    }
  });
});
