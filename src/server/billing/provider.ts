import "server-only";

import { type SubscriptionStatus } from "@/lib/billing";

/*
 * What the application needs from a payment provider, in application terms.
 * The Razorpay implementation (./razorpay.ts) is the only module that knows
 * the provider's API; everything else works with these types, and tests
 * substitute a fake.
 */

export type ProviderSubscription = {
  id: string;
  status: SubscriptionStatus;
  /** The provider plan the subscription is billed on (mapped to an application plan). */
  planId: string | null;
  /** Our organization id, stored in the subscription's notes when ClientFlow created it. */
  organizationId: string | null;
  currentPeriodEnd: Date | null;
  /** Ends at the close of the current period (set by the provider when it reports it). */
  cancelAtPeriodEnd: boolean;
  /** A plan change is scheduled for the end of the current period. */
  hasScheduledChange: boolean;
};

export type ProviderPlan = {
  id: string;
  /** Minor units (cents). */
  amount: number;
  currency: string;
  period: string;
  interval: number;
};

/** A verified webhook event, reduced to what billing reacts to. */
export type ProviderEvent = {
  id: string;
  type: string;
  object: { kind: "subscription"; subscriptionId: string } | { kind: "other" };
};

export interface BillingProvider {
  /** Create a subscription on `planId`; `url` is the provider's hosted payment page. */
  createSubscription(input: {
    planId: string;
    organizationId: string;
    /** Billing cycles before it ends on its own (the provider requires a number). */
    totalCount: number;
  }): Promise<{ id: string; url: string }>;
  retrieveSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;
  retrievePlan(planId: string): Promise<ProviderPlan | null>;
  /** Move the subscription to another plan, now or at the end of the current period. */
  changeSubscriptionPlan(input: {
    subscriptionId: string;
    planId: string;
    when: "now" | "cycle_end";
  }): Promise<void>;
  cancelSubscription(subscriptionId: string, options: { atCycleEnd: boolean }): Promise<void>;
  /** Verify the signature and parse the event; throws `InvalidWebhookError` otherwise. */
  verifyWebhook(payload: string, signature: string | null, eventId: string | null): ProviderEvent;
}

export class InvalidWebhookError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "InvalidWebhookError";
  }
}
