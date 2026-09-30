import Stripe from "stripe";

import {
  type BillingProvider,
  type ProviderCheckoutSession,
  type ProviderEvent,
  type ProviderSubscription,
} from "@/server/billing/provider";

import { TEST_BILLING_ENV } from "../../support/billing-config";

/*
 * In-memory stand-in for Stripe in integration tests. Everything ClientFlow
 * does with Stripe goes through the BillingProvider interface; this fake
 * keeps customers, checkout sessions and subscriptions in memory, while
 * webhook signatures are verified by the REAL Stripe SDK code (the verifier
 * is the actual module's, injected by the test's vi.mock factory).
 */

type Verifier = (payload: string, signature: string | null) => ProviderEvent;

let counter = 0;
const next = (prefix: string) => `${prefix}${(++counter).toString().padStart(12, "0")}`;

type FakeStripe = {
  customers: { id: string; organizationId: string }[];
  sessions: Map<string, ProviderCheckoutSession & { priceId: string }>;
  subscriptions: Map<string, ProviderSubscription>;
  checkouts: Parameters<BillingProvider["createCheckoutSession"]>[0][];
  verifier: Verifier | undefined;
  reset(): void;
  completeCheckout(
    sessionId: string,
    options?: { status?: ProviderSubscription["status"]; priceId?: string },
  ): ProviderSubscription;
  update(subscriptionId: string, changes: Partial<ProviderSubscription>): ProviderSubscription;
  provider: BillingProvider;
};

export const fakeStripe: FakeStripe = {
  customers: [] as { id: string; organizationId: string }[],
  sessions: new Map<string, ProviderCheckoutSession & { priceId: string }>(),
  subscriptions: new Map<string, ProviderSubscription>(),
  checkouts: [] as Parameters<BillingProvider["createCheckoutSession"]>[0][],
  verifier: undefined as Verifier | undefined,

  reset() {
    this.customers = [];
    this.sessions = new Map();
    this.subscriptions = new Map();
    this.checkouts = [];
  },

  /** What Stripe does when the customer pays on the Checkout page. */
  completeCheckout(
    sessionId: string,
    options: { status?: ProviderSubscription["status"]; priceId?: string } = {},
  ): ProviderSubscription {
    const session = this.sessions.get(sessionId);
    if (!session?.customerId) throw new Error(`Unknown checkout session ${sessionId}`);
    const subscription: ProviderSubscription = {
      id: next("sub_"),
      customerId: session.customerId,
      status: options.status ?? "ACTIVE",
      itemId: next("si_"),
      priceId: options.priceId ?? session.priceId,
      currentPeriodEnd: new Date(Date.UTC(2030, 0, 1)),
      cancelAtPeriodEnd: false,
    };
    this.subscriptions.set(subscription.id, subscription);
    session.subscriptionId = subscription.id;
    return subscription;
  },

  /** Change a subscription on the "Stripe side" (dashboard, dunning, portal…). */
  update(subscriptionId: string, changes: Partial<ProviderSubscription>) {
    const subscription: ProviderSubscription | undefined = this.subscriptions.get(subscriptionId);
    if (!subscription) throw new Error(`Unknown subscription ${subscriptionId}`);
    Object.assign(subscription, changes);
    return subscription;
  },

  provider: {
    async createCustomer({ organizationId }) {
      const id = next("cus_");
      fakeStripe.customers.push({ id, organizationId });
      return id;
    },
    async createCheckoutSession(input) {
      fakeStripe.checkouts.push(input);
      const id = next("cs_test_");
      fakeStripe.sessions.set(id, {
        id,
        customerId: input.customerId,
        subscriptionId: null,
        clientReferenceId: input.organizationId,
        priceId: input.priceId,
      });
      return { url: `https://checkout.stripe.test/${id}` };
    },
    async createPortalSession({ customerId }) {
      return { url: `https://billing.stripe.test/${customerId}` };
    },
    async retrieveSubscription(id) {
      const subscription = fakeStripe.subscriptions.get(id);
      return subscription ? { ...subscription } : null;
    },
    async retrieveCheckoutSession(id) {
      const session = fakeStripe.sessions.get(id);
      if (!session) return null;
      const { priceId: _priceId, ...rest } = session;
      return rest;
    },
    async changeSubscriptionPrice({ subscriptionId, priceId }) {
      fakeStripe.update(subscriptionId, { priceId });
    },
    async setCancelAtPeriodEnd(subscriptionId, cancel) {
      fakeStripe.update(subscriptionId, { cancelAtPeriodEnd: cancel });
    },
    verifyWebhook(payload, signature) {
      if (!fakeStripe.verifier) throw new Error("fakeStripe.verifier not set");
      return fakeStripe.verifier(payload, signature);
    },
  },
};

/** A webhook request exactly as Stripe sends it (signed with the test secret unless overridden). */
export function webhookRequest(
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; secret?: string; signature?: string | null } = {},
) {
  const payload = JSON.stringify({
    id: options.id ?? next("evt_"),
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  });
  const signature =
    options.signature !== undefined
      ? options.signature
      : Stripe.webhooks.generateTestHeaderString({
          payload,
          secret: options.secret ?? TEST_BILLING_ENV.STRIPE_WEBHOOK_SECRET,
        });
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);
  return new Request("http://localhost:3000/api/billing/webhook", {
    method: "POST",
    headers,
    body: payload,
  });
}
