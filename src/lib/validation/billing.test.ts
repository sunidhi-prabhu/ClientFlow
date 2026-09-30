import { describe, expect, it } from "vitest";

import { paidPlanInput } from "./billing";

describe("paidPlanInput", () => {
  it("accepts a paid plan and interval, and strips everything else", () => {
    expect(
      paidPlanInput.parse({
        plan: "GROWTH",
        interval: "YEAR",
        planId: "plan_cheap",
        subscriptionId: "sub_other",
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
