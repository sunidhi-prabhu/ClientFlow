import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { InvalidWebhookError } from "./provider";
import { toProviderSubscription, toSubscriptionStatus, verifyRazorpayWebhook } from "./razorpay";

const SECRET = "unit-test-webhook-secret";
const sign = (payload: string, secret = SECRET) =>
  createHmac("sha256", secret).update(payload).digest("hex");

const activated = JSON.stringify({
  entity: "event",
  event: "subscription.activated",
  contains: ["subscription"],
  payload: { subscription: { entity: { id: "sub_1", status: "active" } } },
});

describe("verifyRazorpayWebhook", () => {
  it("accepts a correctly signed event and reduces it to application terms", () => {
    expect(verifyRazorpayWebhook(activated, sign(activated), "evt_1", SECRET)).toEqual({
      id: "evt_1",
      type: "subscription.activated",
      object: { kind: "subscription", subscriptionId: "sub_1" },
    });
  });

  it.each([
    ["a missing signature", null, "evt_1"],
    ["a missing event id", sign(activated), null],
    ["another secret's signature", sign(activated, "attacker-secret"), "evt_1"],
    ["a malformed signature", "zz-not-hex", "evt_1"],
    ["a truncated signature", sign(activated).slice(0, 32), "evt_1"],
  ])("rejects %s", (_label, signature, eventId) => {
    expect(() => verifyRazorpayWebhook(activated, signature, eventId, SECRET)).toThrow(
      InvalidWebhookError,
    );
  });

  it("rejects a tampered body (e.g. another subscription)", () => {
    const tampered = activated.replace("sub_1", "sub_2");
    expect(() => verifyRazorpayWebhook(tampered, sign(activated), "evt_1", SECRET)).toThrow(
      InvalidWebhookError,
    );
  });

  it("treats non-subscription events as other", () => {
    const payment = JSON.stringify({ event: "payment.captured", payload: { payment: {} } });
    expect(verifyRazorpayWebhook(payment, sign(payment), "evt_2", SECRET).object).toEqual({
      kind: "other",
    });
  });
});

describe("subscription mapping", () => {
  it("maps every Razorpay status; only active (and pending while retrying) are paid", () => {
    expect(
      [
        "created",
        "authenticated",
        "active",
        "pending",
        "halted",
        "cancelled",
        "completed",
        "expired",
        "paused",
      ].map(toSubscriptionStatus),
    ).toEqual([
      "INCOMPLETE",
      "INCOMPLETE",
      "ACTIVE",
      "PAST_DUE",
      "UNPAID",
      "CANCELED",
      "CANCELED",
      "INCOMPLETE_EXPIRED",
      "PAUSED",
    ]);
    expect(toSubscriptionStatus("some_future_status")).toBe("INCOMPLETE");
  });

  it("reads the plan, period end, notes and scheduled changes", () => {
    expect(
      toProviderSubscription({
        id: "sub_1",
        status: "active",
        plan_id: "plan_growthmonthly",
        current_end: 1_800_000_000,
        notes: { organizationId: "org_1" },
        has_scheduled_changes: true,
      }),
    ).toEqual({
      id: "sub_1",
      status: "ACTIVE",
      planId: "plan_growthmonthly",
      organizationId: "org_1",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
      cancelAtPeriodEnd: false,
      hasScheduledChange: true,
    });
  });

  it("handles Razorpay's empty notes (an array) and missing fields", () => {
    expect(toProviderSubscription({ id: "sub_2", status: "created", notes: [] })).toMatchObject({
      organizationId: null,
      planId: null,
      currentPeriodEnd: null,
    });
  });
});

describe("Razorpay API errors", () => {
  it("become a clear 503 for the customer, with Razorpay's reason logged for the operator", async () => {
    const { stubBillingEnv } = await import("../../../tests/support/billing-env");
    vi.stubEnv("NODE_ENV", "test");
    stubBillingEnv();
    vi.resetModules();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    vi.doMock("@/lib/logger", () => ({ logger }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "BAD_REQUEST_ERROR", description: "Currency USD is not supported" } },
          { status: 400 },
        ),
      ),
    );
    const { razorpayBillingProvider } = await import("./razorpay");
    await expect(
      razorpayBillingProvider.createSubscription({
        planId: "plan_x",
        organizationId: "o",
        totalCount: 1,
      }),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Payments are temporarily unavailable. Please try again later.",
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Razorpay API error",
      expect.objectContaining({ status: 400, description: "Currency USD is not supported" }),
    );
    // Unknown ids are "not found", not an outage.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { description: "The id provided does not exist" } },
          { status: 400 },
        ),
      ),
    );
    expect(await razorpayBillingProvider.retrieveSubscription("sub_missing")).toBeNull();
    vi.unstubAllGlobals();
    vi.doUnmock("@/lib/logger");
  });
});
