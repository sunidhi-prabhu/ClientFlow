import { describe, expect, it } from "vitest";

import {
  annualSavingsCents,
  effectivePlan,
  entitlementsFor,
  formatPlanPrice,
  formatUsd,
  GST_RATE_BPS,
  limitReachedMessage,
  PAID_PLANS,
  planChangeTiming,
  PLAN_ORDER,
  planRank,
  PLANS,
  priceBreakdown,
  type SubscriptionStatus,
  usageOf,
} from "./billing";

describe("plan definitions", () => {
  it("are exactly the five published plans, limits and prices", () => {
    expect(PLAN_ORDER).toEqual(["FREE", "STARTER", "GROWTH", "PROFESSIONAL", "AGENCY"]);
    const table = PLAN_ORDER.map((plan) => [
      PLANS[plan].name,
      PLANS[plan].clientLimit,
      PLANS[plan].projectLimit,
      PLANS[plan].priceCents.MONTH,
      PLANS[plan].priceCents.YEAR,
    ]);
    expect(table).toEqual([
      ["Free", 5, 5, 0, 0],
      ["Starter", 15, 15, 900, 9_000],
      ["Growth", 50, 50, 1_900, 19_000],
      ["Professional", 150, 150, 3_900, 39_000],
      ["Agency", 500, 500, 7_900, 79_000],
    ]);
    expect(PAID_PLANS).toEqual(["STARTER", "GROWTH", "PROFESSIONAL", "AGENCY"]);
  });

  it("formats prices per interval", () => {
    expect(PLAN_ORDER.map((plan) => formatPlanPrice(plan, "MONTH"))).toEqual([
      "$0",
      "$9/month",
      "$19/month",
      "$39/month",
      "$79/month",
    ]);
    expect(PLAN_ORDER.map((plan) => formatPlanPrice(plan, "YEAR"))).toEqual([
      "$0",
      "$90/year",
      "$190/year",
      "$390/year",
      "$790/year",
    ]);
  });

  it("annual billing saves two months on every paid plan", () => {
    for (const plan of PAID_PLANS) {
      expect(annualSavingsCents(plan)).toBe(PLANS[plan].priceCents.MONTH * 2);
    }
    expect(annualSavingsCents("FREE")).toBe(0);
  });

  it("ranks plans from Free to Agency", () => {
    expect(PLAN_ORDER.map(planRank)).toEqual([0, 1, 2, 3, 4]);
  });

  it("applies upgrades now and downgrades at the end of the period", () => {
    const growthMonthly = { plan: "GROWTH", interval: "MONTH" } as const;
    expect(planChangeTiming(growthMonthly, { plan: "AGENCY", interval: "MONTH" })).toBe("now");
    expect(planChangeTiming(growthMonthly, { plan: "STARTER", interval: "YEAR" })).toBe(
      "cycle_end",
    );
    expect(planChangeTiming(growthMonthly, { plan: "GROWTH", interval: "YEAR" })).toBe("now");
    expect(planChangeTiming({ plan: "GROWTH", interval: "YEAR" }, growthMonthly)).toBe("cycle_end");
  });
});

describe("entitlements", () => {
  it("default to Free (5 clients, 5 projects) without billing state", () => {
    expect(entitlementsFor(null)).toEqual({ plan: "FREE", limits: { clients: 5, projects: 5 } });
    expect(entitlementsFor({ plan: "FREE", status: null })).toEqual(entitlementsFor(null));
  });

  it.each([
    ["STARTER", 15],
    ["GROWTH", 50],
    ["PROFESSIONAL", 150],
    ["AGENCY", 500],
  ] as const)("give %s its limits while active", (plan, limit) => {
    expect(entitlementsFor({ plan, status: "ACTIVE" })).toEqual({
      plan,
      limits: { clients: limit, projects: limit },
    });
  });

  it("keep the paid plan while trialing or while the provider retries a failed payment", () => {
    for (const status of ["TRIALING", "PAST_DUE"] as const) {
      expect(effectivePlan({ plan: "GROWTH", status })).toBe("GROWTH");
    }
  });

  it.each(["UNPAID", "CANCELED", "INCOMPLETE", "INCOMPLETE_EXPIRED", "PAUSED"] as const)(
    "fall back to Free when the subscription is %s",
    (status: SubscriptionStatus) => {
      expect(entitlementsFor({ plan: "AGENCY", status }).limits).toEqual({
        clients: 5,
        projects: 5,
      });
    },
  );

  it("never grant a paid plan without a subscription status", () => {
    expect(effectivePlan({ plan: "AGENCY", status: null })).toBe("FREE");
  });
});

describe("usage", () => {
  it("reports remaining capacity below the limit", () => {
    expect(usageOf(3, 5)).toEqual({ used: 3, limit: 5, remaining: 2, overBy: 0, atLimit: false });
  });

  it("is at the limit exactly when used equals the limit", () => {
    expect(usageOf(4, 5).atLimit).toBe(false);
    expect(usageOf(5, 5)).toEqual({ used: 5, limit: 5, remaining: 0, overBy: 0, atLimit: true });
  });

  it("reports how far over the limit an organization is after a downgrade", () => {
    expect(usageOf(12, 5)).toEqual({ used: 12, limit: 5, remaining: 0, overBy: 7, atLimit: true });
  });
});

describe("limit messages", () => {
  it("explain the limit and the upgrade", () => {
    expect(limitReachedMessage("clients", 5)).toBe(
      "You've reached your 5-client limit. Upgrade your plan to add more clients.",
    );
    expect(limitReachedMessage("projects", 50)).toBe(
      "You've reached your 50-project limit. Upgrade your plan to add more projects.",
    );
    expect(limitReachedMessage("clients", 15, "restore")).toBe(
      "You've reached your 15-client limit. Upgrade your plan to restore this client.",
    );
  });
});

describe("GST", () => {
  it("adds 18% GST to every paid plan, exact to the cent", () => {
    expect(GST_RATE_BPS).toBe(1_800);
    const totals = PAID_PLANS.map((plan) => [
      priceBreakdown(plan, "MONTH").totalCents,
      priceBreakdown(plan, "YEAR").totalCents,
    ]);
    expect(totals).toEqual([
      [1_062, 10_620],
      [2_242, 22_420],
      [4_602, 46_020],
      [9_322, 93_220],
    ]);
    expect(priceBreakdown("STARTER", "MONTH")).toEqual({
      priceCents: 900,
      taxCents: 162,
      totalCents: 1_062,
    });
    expect(priceBreakdown("FREE", "MONTH")).toEqual({ priceCents: 0, taxCents: 0, totalCents: 0 });
    expect(formatUsd(1_062)).toBe("$10.62");
  });
});
