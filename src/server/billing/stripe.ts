import "server-only";

import Stripe from "stripe";

import { type SubscriptionStatus } from "@/lib/billing";
import { getBillingEnv } from "@/lib/env";
import { ServiceUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import {
  type BillingProvider,
  InvalidWebhookError,
  type ProviderEvent,
  type ProviderSubscription,
} from "./provider";

/*
 * Stripe implementation of BillingProvider: the only module that imports the
 * Stripe SDK. Card details never pass through ClientFlow: customers pay on
 * Stripe Checkout and manage payment methods in the Stripe customer portal.
 */

const STATUS: Record<string, SubscriptionStatus> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  unpaid: "UNPAID",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE_EXPIRED",
  paused: "PAUSED",
};

/** Unknown future statuses grant nothing (INCOMPLETE is not entitled). */
export function toSubscriptionStatus(status: string): SubscriptionStatus {
  const mapped = STATUS[status];
  if (!mapped) logger.warn("Unknown Stripe subscription status", { status });
  return mapped ?? "INCOMPLETE";
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function toProviderSubscription(subscription: Stripe.Subscription): ProviderSubscription {
  const item = subscription.items.data[0];
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer) ?? "",
    status: toSubscriptionStatus(subscription.status),
    itemId: item?.id ?? null,
    priceId: item?.price.id ?? null,
    // Since API version 2025-03-31 the billing period is per subscription item.
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

/** Reduce a verified Stripe event to the parts billing reacts to. */
export function toProviderEvent(event: Stripe.Event): ProviderEvent {
  const object = event.data.object as unknown as Record<string, unknown> & { object?: string };
  const base = { id: event.id, type: event.type };
  switch (object.object) {
    case "subscription":
      return {
        ...base,
        object: {
          kind: "subscription",
          subscriptionId: String(object.id),
          customerId: idOf(object.customer as string | { id: string } | null),
        },
      };
    case "checkout.session":
      return {
        ...base,
        object: {
          kind: "checkout_session",
          customerId: idOf(object.customer as string | { id: string } | null),
          subscriptionId: idOf(object.subscription as string | { id: string } | null),
          clientReferenceId: (object.client_reference_id as string | null) ?? null,
        },
      };
    case "invoice":
      return {
        ...base,
        object: {
          kind: "invoice",
          customerId: idOf(object.customer as string | { id: string } | null),
        },
      };
    default:
      return { ...base, object: { kind: "other" } };
  }
}

/** Verify a webhook signature and parse the event (no network call). */
export function verifyStripeWebhook(
  payload: string,
  signature: string | null,
  secret: string,
): ProviderEvent {
  if (!signature) throw new InvalidWebhookError("Missing Stripe-Signature header");
  try {
    return toProviderEvent(Stripe.webhooks.constructEvent(payload, signature, secret));
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      throw new InvalidWebhookError();
    }
    throw error;
  }
}

let client: Stripe | undefined;

function stripe(): Stripe {
  const { STRIPE_SECRET_KEY } = getBillingEnv();
  if (!STRIPE_SECRET_KEY) throw new ServiceUnavailableError("Billing is not configured");
  client ??= new Stripe(STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "ClientFlow" },
  });
  return client;
}

function isMissing(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing"
  );
}

export const stripeBillingProvider: BillingProvider = {
  async createCustomer({ organizationId, name }) {
    const customer = await stripe().customers.create(
      { name, metadata: { organizationId } },
      // A double submit reuses the first customer instead of creating two.
      { idempotencyKey: `clientflow-customer-${organizationId}` },
    );
    return customer.id;
  },

  async createCheckoutSession({ customerId, priceId, organizationId, successUrl, cancelUrl }) {
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: organizationId,
      metadata: { organizationId },
      subscription_data: { metadata: { organizationId } },
      // {CHECKOUT_SESSION_ID} is filled in by Stripe (must stay unencoded).
      success_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
    });
    if (!session.url) throw new ServiceUnavailableError("Stripe did not return a checkout URL");
    return { url: session.url };
  },

  async createPortalSession({ customerId, returnUrl }) {
    const session = await stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  },

  async retrieveSubscription(subscriptionId) {
    try {
      return toProviderSubscription(await stripe().subscriptions.retrieve(subscriptionId));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },

  async retrieveCheckoutSession(sessionId) {
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      return {
        id: session.id,
        customerId: idOf(session.customer),
        subscriptionId: idOf(session.subscription),
        clientReferenceId: session.client_reference_id,
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },

  async changeSubscriptionPrice({ subscriptionId, itemId, priceId }) {
    await stripe().subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      // Charge (or credit) the difference now, and keep the old plan until
      // that payment succeeds: an upgrade never applies unpaid.
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
    });
  },

  async setCancelAtPeriodEnd(subscriptionId, cancel) {
    await stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: cancel });
  },

  verifyWebhook(payload, signature) {
    const { STRIPE_WEBHOOK_SECRET } = getBillingEnv();
    if (!STRIPE_WEBHOOK_SECRET) throw new ServiceUnavailableError("Billing is not configured");
    return verifyStripeWebhook(payload, signature, STRIPE_WEBHOOK_SECRET);
  },
};
