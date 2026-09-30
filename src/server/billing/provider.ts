import "server-only";

import { type SubscriptionStatus } from "@/lib/billing";

/*
 * What the application needs from a billing provider, in application terms.
 * The Stripe implementation (./stripe.ts) is the only module that knows
 * Stripe's API; everything else works with these types, and tests substitute
 * a fake.
 */

export type ProviderSubscription = {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  /** The (single) subscription item and its Price. */
  itemId: string | null;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type ProviderCheckoutSession = {
  id: string;
  customerId: string | null;
  subscriptionId: string | null;
  /** Our organization id, set when the session was created. */
  clientReferenceId: string | null;
};

/** A verified webhook event, reduced to what billing reacts to. */
export type ProviderEvent = {
  id: string;
  type: string;
  object:
    | { kind: "subscription"; subscriptionId: string; customerId: string | null }
    | {
        kind: "checkout_session";
        customerId: string | null;
        subscriptionId: string | null;
        clientReferenceId: string | null;
      }
    | { kind: "invoice"; customerId: string | null }
    | { kind: "other" };
};

export interface BillingProvider {
  createCustomer(input: { organizationId: string; name: string }): Promise<string>;
  createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;
  retrieveCheckoutSession(sessionId: string): Promise<ProviderCheckoutSession | null>;
  /** Move the subscription to another Price; applied only once any payment succeeds. */
  changeSubscriptionPrice(input: {
    subscriptionId: string;
    itemId: string;
    priceId: string;
  }): Promise<void>;
  setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void>;
  /** Verify the signature and parse the event; throws `InvalidWebhookError` otherwise. */
  verifyWebhook(payload: string, signature: string | null): ProviderEvent;
}

export class InvalidWebhookError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "InvalidWebhookError";
  }
}
