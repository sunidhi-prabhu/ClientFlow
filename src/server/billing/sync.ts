import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  type BillingState,
  effectivePlan,
  isPaidPlan,
  type SubscriptionStatus,
} from "@/lib/billing";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { type AuditEvent, auditRecordData } from "@/server/audit/service";

import { planForPriceId } from "./prices";
import { type BillingProvider, type ProviderEvent, type ProviderSubscription } from "./provider";

/*
 * Applies verified Stripe data to an organization's billing state: webhook
 * events, and the checkout return page. The only writer of plan/status.
 *
 * - Webhook events have no session or tenant context. The organization is
 *   found through the Stripe customer id stored when ClientFlow created that
 *   customer; events for any other customer are ignored. This module is on
 *   the ESLint raw-database allowlist for that reason.
 * - Event payloads are not trusted for state: the subscription is re-read
 *   from Stripe, so late or out-of-order deliveries cannot roll it back.
 * - Each event is applied once: its id is stored in the same transaction as
 *   the change (a redelivery finds it and does nothing).
 * - Audit records for Stripe-driven changes have no actor.
 */

type Tx = Prisma.TransactionClient;
type StoredSubscription = Awaited<ReturnType<Tx["subscription"]["findUniqueOrThrow"]>>;

/** Subscriptions that are over for good; a new checkout creates a new one. */
const ENDED: ReadonlySet<SubscriptionStatus> = new Set(["CANCELED", "INCOMPLETE_EXPIRED"]);
/** Subscriptions that are (or may become) the organization's paid plan. */
const LIVE: ReadonlySet<SubscriptionStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "UNPAID",
  "INCOMPLETE",
  "PAUSED",
]);

function isLive(status: SubscriptionStatus | null | undefined) {
  return Boolean(status && LIVE.has(status));
}

export type SyncOutcome = "applied" | "duplicate" | "ignored";

async function organizationForCustomer(customerId: string | null) {
  if (!customerId) return null;
  const row = await getDb().subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

/** Lock the organization's billing row for the rest of the transaction. */
async function lockSubscription(
  tx: Tx,
  organizationId: string,
): Promise<StoredSubscription | null> {
  await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
  return tx.subscription.findUnique({ where: { organizationId } });
}

function describe(state: { plan: string; interval: string | null; status: string | null }) {
  return { plan: state.plan, interval: state.interval, status: state.status };
}

/** Audit events for the change from `before` to `after` (Stripe-driven, no actor). */
function auditEventsFor(
  before: StoredSubscription,
  after: Pick<
    StoredSubscription,
    "plan" | "interval" | "status" | "cancelAtPeriodEnd" | "currentPeriodEnd"
  >,
  subscriptionId: string,
): AuditEvent[] {
  const wasPlan = effectivePlan(before as BillingState);
  const isPlan = effectivePlan(after as BillingState);
  const base = { resourceId: subscriptionId };
  const events: AuditEvent[] = [];

  if (after.status && ENDED.has(after.status) && before.status && !ENDED.has(before.status)) {
    events.push({
      ...base,
      action: "billing.subscription_cancelled",
      metadata: { previous: describe(before), status: after.status },
    });
  } else if (!isPaidPlan(wasPlan) && isPaidPlan(isPlan)) {
    events.push({
      ...base,
      action: "billing.subscription_activated",
      metadata: { ...describe(after), previousStatus: before.status },
    });
  } else if (
    isPaidPlan(wasPlan) &&
    isPaidPlan(isPlan) &&
    (before.plan !== after.plan || before.interval !== after.interval)
  ) {
    events.push({
      ...base,
      action: "billing.plan_changed",
      metadata: { from: describe(before), to: describe(after) },
    });
  } else if (before.status !== after.status) {
    events.push({
      ...base,
      action: "billing.subscription_status_changed",
      metadata: { from: before.status, to: after.status, plan: after.plan, effectivePlan: isPlan },
    });
  }
  if (
    before.cancelAtPeriodEnd !== after.cancelAtPeriodEnd &&
    !(after.status && ENDED.has(after.status))
  ) {
    events.push({
      ...base,
      action: "billing.subscription_status_changed",
      metadata: {
        cancelAtPeriodEnd: after.cancelAtPeriodEnd,
        accessUntil: after.cancelAtPeriodEnd ? after.currentPeriodEnd : null,
        plan: after.plan,
      },
    });
  }
  return events;
}

/**
 * Store the state of `subscription` (fresh from Stripe) for the organization.
 * Returns false when it does not belong there (another customer, or a stale
 * subscription while a different one is live).
 */
async function applySubscription(
  tx: Tx,
  organizationId: string,
  subscription: ProviderSubscription,
  extraAudit: AuditEvent[] = [],
): Promise<boolean> {
  const stored = await lockSubscription(tx, organizationId);
  if (!stored || stored.stripeCustomerId !== subscription.customerId) {
    logger.warn("Stripe subscription does not match the organization's customer; ignored", {
      organizationId,
      subscriptionId: subscription.id,
    });
    return false;
  }
  if (
    stored.stripeSubscriptionId &&
    stored.stripeSubscriptionId !== subscription.id &&
    isLive(stored.status) &&
    !isLive(subscription.status)
  ) {
    // An older subscription ending (or failing) while a newer one is live.
    logger.info("Stale Stripe subscription update ignored", {
      organizationId,
      subscriptionId: subscription.id,
    });
    return false;
  }

  const price = planForPriceId(subscription.priceId);
  if (!price) {
    logger.error("Stripe subscription uses an unknown Price; no plan granted", {
      organizationId,
      subscriptionId: subscription.id,
      priceId: subscription.priceId,
    });
  }
  const ended = ENDED.has(subscription.status);
  const next = {
    // Only a configured Price grants a plan; an ended subscription grants none.
    plan: price && !ended ? price.plan : "FREE",
    interval: price && !ended ? price.interval : null,
    status: subscription.status,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: ended ? false : subscription.cancelAtPeriodEnd,
  } as const;

  await tx.subscription.update({ where: { organizationId }, data: next });
  const audit = [...extraAudit, ...auditEventsFor(stored, next, subscription.id)];
  if (audit.length > 0) {
    const context = { organizationId, actorUserId: null };
    await tx.auditLog.createMany({ data: audit.map((event) => auditRecordData(context, event)) });
  }
  return true;
}

/** Store the event id; false if it was already processed (concurrently or before). */
async function claimEvent(tx: Tx, event: ProviderEvent): Promise<boolean> {
  try {
    await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

class DuplicateEvent extends Error {}

/** The subscription an event is about, and the organization it belongs to. */
async function resolveEvent(
  event: ProviderEvent,
): Promise<{ organizationId: string; subscriptionId: string; audit: AuditEvent[] } | null> {
  const { object } = event;
  if (object.kind === "subscription") {
    const organizationId = await organizationForCustomer(object.customerId);
    return organizationId
      ? { organizationId, subscriptionId: object.subscriptionId, audit: [] }
      : null;
  }
  if (object.kind === "checkout_session") {
    if (event.type !== "checkout.session.completed" || !object.subscriptionId) return null;
    const organizationId = await organizationForCustomer(object.customerId);
    if (!organizationId || object.clientReferenceId !== organizationId) {
      logger.warn("Checkout session does not match its customer's organization; ignored", {
        eventId: event.id,
      });
      return null;
    }
    return { organizationId, subscriptionId: object.subscriptionId, audit: [] };
  }
  if (object.kind === "invoice") {
    if (event.type !== "invoice.payment_failed" && event.type !== "invoice.paid") return null;
    const organizationId = await organizationForCustomer(object.customerId);
    if (!organizationId) return null;
    const stored = await getDb().subscription.findUnique({ where: { organizationId } });
    if (!stored?.stripeSubscriptionId) return null;
    const audit: AuditEvent[] =
      event.type === "invoice.payment_failed"
        ? [
            {
              action: "billing.payment_failed",
              resourceId: stored.stripeSubscriptionId,
              metadata: { plan: stored.plan, interval: stored.interval },
            },
          ]
        : [];
    return { organizationId, subscriptionId: stored.stripeSubscriptionId, audit };
  }
  return null;
}

/**
 * Apply one verified webhook event. Idempotent. Throws on transient failures
 * (Stripe or database), so the route answers 500 and Stripe retries.
 */
export async function processWebhookEvent(
  event: ProviderEvent,
  provider: BillingProvider,
): Promise<SyncOutcome> {
  const db = getDb();
  if (await db.stripeEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
    return "duplicate";
  }
  const target = await resolveEvent(event);
  // Read the subscription before the transaction (network call).
  const subscription = target ? await provider.retrieveSubscription(target.subscriptionId) : null;
  if (target && !subscription) {
    logger.warn("Stripe subscription not found; event ignored", {
      eventId: event.id,
      subscriptionId: target.subscriptionId,
    });
  }

  try {
    return await db.$transaction(async (tx) => {
      if (!(await claimEvent(tx, event))) throw new DuplicateEvent();
      if (!target || !subscription) return "ignored";
      const applied = await applySubscription(
        tx,
        target.organizationId,
        subscription,
        target.audit,
      );
      return applied ? "applied" : "ignored";
    });
  } catch (error) {
    if (error instanceof DuplicateEvent) return "duplicate";
    throw error;
  }
}

/**
 * The checkout return page: apply the session's subscription right away
 * instead of waiting for the webhook. The session id comes from the URL, so
 * it is checked against Stripe: it must be this organization's session
 * (its customer and client_reference_id), otherwise nothing happens.
 */
export async function syncCheckoutSession(
  organizationId: string,
  sessionId: string,
  provider: BillingProvider,
): Promise<boolean> {
  const stored = await getDb().subscription.findUnique({ where: { organizationId } });
  if (!stored?.stripeCustomerId) return false;
  const session = await provider.retrieveCheckoutSession(sessionId);
  if (
    !session?.subscriptionId ||
    session.customerId !== stored.stripeCustomerId ||
    session.clientReferenceId !== organizationId
  ) {
    return false;
  }
  const subscription = await provider.retrieveSubscription(session.subscriptionId);
  if (!subscription) return false;
  return getDb().$transaction((tx) => applySubscription(tx, organizationId, subscription));
}

/**
 * Re-read one of the organization's subscriptions from Stripe and store it
 * (after a plan change or cancellation made through ClientFlow). The webhook
 * for the same change later finds the state already applied.
 */
export async function syncSubscription(
  organizationId: string,
  subscriptionId: string,
  provider: BillingProvider,
): Promise<boolean> {
  const subscription = await provider.retrieveSubscription(subscriptionId);
  if (!subscription) return false;
  return getDb().$transaction((tx) => applySubscription(tx, organizationId, subscription));
}
