import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { type SubscriptionStatus } from "@/lib/billing";
import { getBillingEnv } from "@/lib/env";
import { ServiceUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import {
  type BillingProvider,
  InvalidWebhookError,
  type ProviderEvent,
  type ProviderPlan,
  type ProviderSubscription,
} from "./provider";

/*
 * Razorpay implementation of BillingProvider (REST API, no SDK): the only
 * module that talks to Razorpay. Customers pay on Razorpay's hosted
 * subscription page; card details never pass through ClientFlow.
 * API: https://razorpay.com/docs/api/payments/subscriptions/
 */

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 20_000;

const STATUS: Record<string, SubscriptionStatus> = {
  // Created, waiting for the first payment / card authorisation.
  created: "INCOMPLETE",
  authenticated: "INCOMPLETE",
  active: "ACTIVE",
  // A charge failed; Razorpay retries.
  pending: "PAST_DUE",
  // All retries failed.
  halted: "UNPAID",
  cancelled: "CANCELED",
  // Every billing cycle has been charged: the subscription is over.
  completed: "CANCELED",
  expired: "INCOMPLETE_EXPIRED",
  paused: "PAUSED",
};

/** Unknown future statuses grant nothing (INCOMPLETE is not entitled). */
export function toSubscriptionStatus(status: string): SubscriptionStatus {
  const mapped = STATUS[status];
  if (!mapped) logger.warn("Unknown Razorpay subscription status", { status });
  return mapped ?? "INCOMPLETE";
}

type RazorpaySubscription = {
  id: string;
  status: string;
  plan_id?: string | null;
  current_end?: number | null;
  notes?: Record<string, string> | unknown[] | null;
  has_scheduled_changes?: boolean | null;
  cancel_at_cycle_end?: boolean | number | null;
  short_url?: string | null;
};

export function toProviderSubscription(subscription: RazorpaySubscription): ProviderSubscription {
  // Razorpay returns `notes: []` when a subscription has none.
  const notes = subscription.notes && !Array.isArray(subscription.notes) ? subscription.notes : {};
  return {
    id: subscription.id,
    status: toSubscriptionStatus(subscription.status),
    planId: subscription.plan_id ?? null,
    organizationId: typeof notes.organizationId === "string" ? notes.organizationId : null,
    currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_cycle_end),
    hasScheduledChange: Boolean(subscription.has_scheduled_changes),
  };
}

/** Reduce a verified Razorpay webhook body to the parts billing reacts to. */
export function toProviderEvent(eventId: string, body: unknown): ProviderEvent {
  const event = body as {
    event?: unknown;
    payload?: { subscription?: { entity?: { id?: unknown } } };
  };
  const type = typeof event?.event === "string" ? event.event : "unknown";
  const subscriptionId = event?.payload?.subscription?.entity?.id;
  if (type.startsWith("subscription.") && typeof subscriptionId === "string") {
    return { id: eventId, type, object: { kind: "subscription", subscriptionId } };
  }
  return { id: eventId, type, object: { kind: "other" } };
}

/**
 * Verify a webhook: `X-Razorpay-Signature` is the hex HMAC-SHA256 of the raw
 * body with the webhook secret. `x-razorpay-event-id` identifies the event
 * (redeliveries repeat it). No network call.
 */
export function verifyRazorpayWebhook(
  payload: string,
  signature: string | null,
  eventId: string | null,
  secret: string,
): ProviderEvent {
  if (!signature) throw new InvalidWebhookError("Missing X-Razorpay-Signature header");
  if (!eventId) throw new InvalidWebhookError("Missing x-razorpay-event-id header");
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest();
  const received = Buffer.from(signature, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new InvalidWebhookError();
  }
  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    throw new InvalidWebhookError("Webhook body is not JSON");
  }
  return toProviderEvent(eventId, body);
}

class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`Razorpay API error ${status}: ${description}`);
    this.name = "RazorpayApiError";
  }

  /** Razorpay answers unknown ids with 400 "… does not exist". */
  get isNotFound() {
    return this.status === 404 || /does not exist|not found/i.test(this.description);
  }
}

async function razorpay<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = getBillingEnv();
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    throw new ServiceUnavailableError("Billing is not configured");
  }
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    logger.error("Razorpay request failed", { method, path: path.split("/")[1], error });
    throw new ServiceUnavailableError(UNAVAILABLE, { cause: error });
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: { description?: string };
  };
  if (!response.ok) {
    const error = new RazorpayApiError(
      response.status,
      data.error?.description ?? response.statusText,
    );
    if (error.isNotFound) throw error;
    // Wrong keys, International payments not enabled, validation errors, outages:
    // log Razorpay's reason for the operator, show the customer a clear message.
    logger.error("Razorpay API error", {
      method,
      path: path.split("/")[1],
      status: error.status,
      description: error.description,
    });
    throw new ServiceUnavailableError(UNAVAILABLE, { cause: error });
  }
  return data as T;
}

const UNAVAILABLE = "Payments are temporarily unavailable. Please try again later.";

async function orNull<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof RazorpayApiError && error.isNotFound) return null;
    throw error;
  }
}

export const razorpayBillingProvider: BillingProvider = {
  async createSubscription({ planId, organizationId, totalCount }) {
    const subscription = await razorpay<RazorpaySubscription>("POST", "/subscriptions", {
      plan_id: planId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: true,
      notes: { organizationId },
    });
    if (!subscription.short_url) {
      throw new ServiceUnavailableError("Razorpay did not return a payment page");
    }
    return { id: subscription.id, url: subscription.short_url };
  },

  async retrieveSubscription(subscriptionId) {
    const subscription = await orNull(
      razorpay<RazorpaySubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`),
    );
    return subscription && toProviderSubscription(subscription);
  },

  async retrievePlan(planId) {
    const plan = await orNull(
      razorpay<{
        id: string;
        period: string;
        interval: number;
        item: { amount: number; currency: string };
      }>("GET", `/plans/${encodeURIComponent(planId)}`),
    );
    return (plan && {
      id: plan.id,
      amount: plan.item.amount,
      currency: plan.item.currency,
      period: plan.period,
      interval: plan.interval,
    }) satisfies ProviderPlan | null;
  },

  async changeSubscriptionPlan({ subscriptionId, planId, when }) {
    await razorpay("PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      plan_id: planId,
      schedule_change_at: when,
      customer_notify: true,
    });
  },

  async cancelSubscription(subscriptionId, { atCycleEnd }) {
    await razorpay("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      cancel_at_cycle_end: atCycleEnd,
    });
  },

  verifyWebhook(payload, signature, eventId) {
    const { RAZORPAY_WEBHOOK_SECRET } = getBillingEnv();
    if (!RAZORPAY_WEBHOOK_SECRET) throw new ServiceUnavailableError("Billing is not configured");
    return verifyRazorpayWebhook(payload, signature, eventId, RAZORPAY_WEBHOOK_SECRET);
  },
};
