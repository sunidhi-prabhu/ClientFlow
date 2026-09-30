import { createHmac } from "node:crypto";

import { type BillingInterval, type PaidPlan, priceBreakdown } from "@/lib/billing";
import { RAZORPAY_PLAN_ENV } from "@/lib/env";
import {
  type BillingProvider,
  type ProviderEvent,
  type ProviderPlan,
  type ProviderSubscription,
} from "@/server/billing/provider";

import { TEST_BILLING_ENV } from "../../support/billing-config";

/*
 * In-memory stand-in for Razorpay in integration tests. Everything ClientFlow
 * does with the provider goes through the BillingProvider interface; this fake
 * keeps plans and subscriptions in memory, while webhook signatures are
 * verified by the REAL verification code (the verifier is the actual module's,
 * injected by the test's vi.mock factory).
 */

type Verifier = (
  payload: string,
  signature: string | null,
  eventId: string | null,
) => ProviderEvent;

let counter = 0;
const next = (prefix: string) => `${prefix}${(++counter).toString().padStart(12, "0")}`;

/** The configured plans, priced exactly as published (price + 18% GST). */
function defaultPlans(): Map<string, ProviderPlan> {
  const plans = new Map<string, ProviderPlan>();
  for (const [plan, byInterval] of Object.entries(RAZORPAY_PLAN_ENV)) {
    for (const [interval, variable] of Object.entries(byInterval)) {
      const id = TEST_BILLING_ENV[variable as keyof typeof TEST_BILLING_ENV];
      plans.set(id, {
        id,
        // GST-inclusive, as created by scripts/razorpay-setup-plans.mjs.
        amount: priceBreakdown(plan as PaidPlan, interval as BillingInterval).totalCents,
        currency: "USD",
        period: interval === "MONTH" ? "monthly" : "yearly",
        interval: 1,
      });
    }
  }
  return plans;
}

type FakeRazorpay = {
  plans: Map<string, ProviderPlan>;
  subscriptions: Map<string, ProviderSubscription & { totalCount: number }>;
  created: Parameters<BillingProvider["createSubscription"]>[0][];
  planChanges: Parameters<BillingProvider["changeSubscriptionPlan"]>[0][];
  cancellations: { subscriptionId: string; atCycleEnd: boolean }[];
  verifier: Verifier | undefined;
  reset(): void;
  /** What Razorpay does when the customer pays on the hosted page. */
  pay(subscriptionId: string, status?: ProviderSubscription["status"]): ProviderSubscription;
  /** Change a subscription on the "Razorpay side" (dashboard, retries, renewals…). */
  update(subscriptionId: string, changes: Partial<ProviderSubscription>): ProviderSubscription;
  provider: BillingProvider;
};

export const fakeRazorpay: FakeRazorpay = {
  plans: defaultPlans(),
  subscriptions: new Map(),
  created: [],
  planChanges: [],
  cancellations: [],
  verifier: undefined,

  reset() {
    this.plans = defaultPlans();
    this.subscriptions = new Map();
    this.created = [];
    this.planChanges = [];
    this.cancellations = [];
  },

  pay(subscriptionId, status = "ACTIVE") {
    return this.update(subscriptionId, {
      status,
      currentPeriodEnd: new Date(Date.UTC(2030, 0, 1)),
    });
  },

  update(subscriptionId, changes) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error(`Unknown subscription ${subscriptionId}`);
    Object.assign(subscription, changes);
    return subscription;
  },

  provider: {
    async createSubscription(input) {
      fakeRazorpay.created.push(input);
      const id = next("sub_");
      fakeRazorpay.subscriptions.set(id, {
        id,
        status: "INCOMPLETE",
        planId: input.planId,
        organizationId: input.organizationId,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        hasScheduledChange: false,
        totalCount: input.totalCount,
      });
      return { id, url: `https://rzp.test/i/${id}` };
    },
    async retrieveSubscription(id) {
      const subscription = fakeRazorpay.subscriptions.get(id);
      if (!subscription) return null;
      const { totalCount: _totalCount, ...rest } = subscription;
      return { ...rest };
    },
    async retrievePlan(id) {
      const plan = fakeRazorpay.plans.get(id);
      return plan ? { ...plan } : null;
    },
    async changeSubscriptionPlan(input) {
      fakeRazorpay.planChanges.push(input);
      if (input.when === "now") fakeRazorpay.update(input.subscriptionId, { planId: input.planId });
      else fakeRazorpay.update(input.subscriptionId, { hasScheduledChange: true });
    },
    async cancelSubscription(subscriptionId, { atCycleEnd }) {
      fakeRazorpay.cancellations.push({ subscriptionId, atCycleEnd });
      // Like Razorpay, an end-of-cycle cancellation is not reported back on the subscription.
      if (!atCycleEnd) fakeRazorpay.update(subscriptionId, { status: "CANCELED" });
    },
    verifyWebhook(payload, signature, eventId) {
      if (!fakeRazorpay.verifier) throw new Error("fakeRazorpay.verifier not set");
      return fakeRazorpay.verifier(payload, signature, eventId);
    },
  },
};

/** A webhook request exactly as Razorpay sends it (signed with the test secret unless overridden). */
export function webhookRequest(
  event: string,
  subscriptionId: string,
  options: { eventId?: string | null; secret?: string; signature?: string | null } = {},
) {
  const payload = JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event,
    contains: ["subscription"],
    payload: { subscription: { entity: { id: subscriptionId, entity: "subscription" } } },
    created_at: Math.floor(Date.now() / 1000),
  });
  const signature =
    options.signature !== undefined
      ? options.signature
      : createHmac("sha256", options.secret ?? TEST_BILLING_ENV.RAZORPAY_WEBHOOK_SECRET)
          .update(payload)
          .digest("hex");
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("x-razorpay-signature", signature);
  const eventId = options.eventId !== undefined ? options.eventId : next("evt_");
  if (eventId) headers.set("x-razorpay-event-id", eventId);
  return new Request("http://localhost:3000/api/billing/webhook", {
    method: "POST",
    headers,
    body: payload,
  });
}
