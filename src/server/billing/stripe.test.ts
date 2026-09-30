import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { InvalidWebhookError } from "./provider";
import { toProviderSubscription, toSubscriptionStatus, verifyStripeWebhook } from "./stripe";

const SECRET = "whsec_unit";

function signed(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  return { payload, signature: Stripe.webhooks.generateTestHeaderString({ payload, secret }) };
}

const subscriptionEvent = {
  id: "evt_1",
  object: "event",
  type: "customer.subscription.updated",
  created: 1_700_000_000,
  data: { object: { id: "sub_1", object: "subscription", customer: "cus_1" } },
};

describe("verifyStripeWebhook", () => {
  it("accepts a correctly signed event and reduces it to application terms", () => {
    const { payload, signature } = signed(subscriptionEvent);
    expect(verifyStripeWebhook(payload, signature, SECRET)).toEqual({
      id: "evt_1",
      type: "customer.subscription.updated",
      object: { kind: "subscription", subscriptionId: "sub_1", customerId: "cus_1" },
    });
  });

  it("rejects a missing signature", () => {
    const { payload } = signed(subscriptionEvent);
    expect(() => verifyStripeWebhook(payload, null, SECRET)).toThrow(InvalidWebhookError);
  });

  it("rejects an event signed with another secret", () => {
    const { payload, signature } = signed(subscriptionEvent, "whsec_attacker");
    expect(() => verifyStripeWebhook(payload, signature, SECRET)).toThrow(InvalidWebhookError);
  });

  it("rejects a tampered body (e.g. another customer or a forged Price)", () => {
    const { payload, signature } = signed(subscriptionEvent);
    const tampered = payload.replace("cus_1", "cus_2");
    expect(() => verifyStripeWebhook(tampered, signature, SECRET)).toThrow(InvalidWebhookError);
  });

  it("rejects a replayed signature outside Stripe's tolerance window", () => {
    const payload = JSON.stringify(subscriptionEvent);
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: old,
    });
    expect(() => verifyStripeWebhook(payload, signature, SECRET)).toThrow(InvalidWebhookError);
  });

  it("maps checkout sessions and invoices; other objects are ignored", () => {
    const checkout = signed({
      ...subscriptionEvent,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          object: "checkout.session",
          customer: "cus_1",
          subscription: "sub_1",
          client_reference_id: "org_1",
        },
      },
    });
    expect(verifyStripeWebhook(checkout.payload, checkout.signature, SECRET).object).toEqual({
      kind: "checkout_session",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      clientReferenceId: "org_1",
    });
    const invoice = signed({
      ...subscriptionEvent,
      type: "invoice.payment_failed",
      data: { object: { id: "in_1", object: "invoice", customer: "cus_1" } },
    });
    expect(verifyStripeWebhook(invoice.payload, invoice.signature, SECRET).object).toEqual({
      kind: "invoice",
      customerId: "cus_1",
    });
    const other = signed({
      ...subscriptionEvent,
      type: "charge.succeeded",
      data: { object: { id: "ch_1", object: "charge" } },
    });
    expect(verifyStripeWebhook(other.payload, other.signature, SECRET).object).toEqual({
      kind: "other",
    });
  });
});

describe("subscription mapping", () => {
  it("maps every Stripe status; unknown statuses grant nothing", () => {
    expect(
      [
        "active",
        "trialing",
        "past_due",
        "unpaid",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "paused",
      ].map(toSubscriptionStatus),
    ).toEqual([
      "ACTIVE",
      "TRIALING",
      "PAST_DUE",
      "UNPAID",
      "CANCELED",
      "INCOMPLETE",
      "INCOMPLETE_EXPIRED",
      "PAUSED",
    ]);
    expect(toSubscriptionStatus("some_future_status")).toBe("INCOMPLETE");
  });

  it("reads the Price and period end from the subscription item", () => {
    const subscription = {
      id: "sub_1",
      customer: { id: "cus_1" },
      status: "active",
      cancel_at_period_end: true,
      items: {
        data: [
          { id: "si_1", price: { id: "price_growthmonthly" }, current_period_end: 1_800_000_000 },
        ],
      },
    } as unknown as Stripe.Subscription;
    expect(toProviderSubscription(subscription)).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      status: "ACTIVE",
      itemId: "si_1",
      priceId: "price_growthmonthly",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
      cancelAtPeriodEnd: true,
    });
  });
});
