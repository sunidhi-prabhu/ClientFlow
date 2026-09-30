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

import { planForProviderPlanId } from "./plan-ids";
import { type BillingProvider, type ProviderEvent, type ProviderSubscription } from "./provider";

/*
 * Applies subscription data read back from the payment provider to an
 * organization's billing state: webhook events, the billing page (which
 * re-reads the organization's own subscription), and ClientFlow's own
 * changes. The only writer of plan/status.
 *
 * - Webhook events have no session or tenant context. The organization is
 *   found through the subscription id ClientFlow stored when it created that
 *   subscription; events for any other subscription are ignored. This module
 *   is on the ESLint raw-database allowlist for that reason.
 * - Event payloads are not trusted for state: the subscription is re-read
 *   from the provider, so late or out-of-order deliveries cannot roll it back.
 * - Each event is applied once: its id is stored in the same transaction as
 *   the change (a redelivery finds it and does nothing).
 * - Audit records for provider-driven changes have no actor.
 */

type Tx = Prisma.TransactionClient;
type StoredSubscription = Awaited<ReturnType<Tx["subscription"]["findUniqueOrThrow"]>>;
type State = Pick<
  StoredSubscription,
  "plan" | "interval" | "status" | "cancelAtPeriodEnd" | "currentPeriodEnd" | "hasScheduledChange"
>;

/** Subscriptions that are over for good; a new checkout creates a new one. */
const ENDED: ReadonlySet<SubscriptionStatus> = new Set(["CANCELED", "INCOMPLETE_EXPIRED"]);

export type SyncOutcome = "applied" | "duplicate" | "ignored";

async function organizationForSubscription(subscriptionId: string) {
  const row = await getDb().subscription.findUnique({
    where: { providerSubscriptionId: subscriptionId },
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

function describe(state: Pick<State, "plan" | "interval" | "status">) {
  return { plan: state.plan, interval: state.interval, status: state.status };
}

/** Audit events for the change from `before` to `after` (provider-driven, no actor). */
function auditEventsFor(before: State, after: State, subscriptionId: string): AuditEvent[] {
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
    !before.cancelAtPeriodEnd &&
    after.cancelAtPeriodEnd &&
    !(after.status && ENDED.has(after.status))
  ) {
    events.push({
      ...base,
      action: "billing.subscription_status_changed",
      metadata: { cancelAtPeriodEnd: true, accessUntil: after.currentPeriodEnd, plan: after.plan },
    });
  }
  return events;
}

/**
 * Store the state of `subscription` (fresh from the provider) for the
 * organization. Returns false when it is not the organization's current
 * subscription (e.g. an abandoned checkout that was replaced).
 */
async function applySubscription(
  tx: Tx,
  organizationId: string,
  subscription: ProviderSubscription,
  options: { audit?: AuditEvent[]; cancellationRequested?: boolean } = {},
): Promise<boolean> {
  const stored = await lockSubscription(tx, organizationId);
  if (
    !stored ||
    stored.providerSubscriptionId !== subscription.id ||
    (subscription.organizationId && subscription.organizationId !== organizationId)
  ) {
    logger.warn("Subscription is not the organization's current subscription; ignored", {
      organizationId,
      subscriptionId: subscription.id,
    });
    return false;
  }

  const plan = planForProviderPlanId(subscription.planId);
  if (!plan) {
    logger.error("Subscription uses an unknown provider plan; no plan granted", {
      organizationId,
      subscriptionId: subscription.id,
      providerPlanId: subscription.planId,
    });
  }
  const ended = ENDED.has(subscription.status);
  const next: State = {
    // Only a configured provider plan grants a plan; an ended subscription grants none.
    plan: plan && !ended ? plan.plan : "FREE",
    interval: plan && !ended ? plan.interval : null,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    // A requested end-of-period cancellation stays recorded until the
    // subscription ends (the provider does not always report it back).
    cancelAtPeriodEnd:
      !ended &&
      (subscription.cancelAtPeriodEnd ||
        stored.cancelAtPeriodEnd ||
        Boolean(options.cancellationRequested)),
    hasScheduledChange: !ended && subscription.hasScheduledChange,
  };

  await tx.subscription.update({ where: { organizationId }, data: next });
  const audit = [...(options.audit ?? []), ...auditEventsFor(stored, next, subscription.id)];
  if (audit.length > 0) {
    const context = { organizationId, actorUserId: null };
    await tx.auditLog.createMany({ data: audit.map((event) => auditRecordData(context, event)) });
  }
  return true;
}

/** Store the event id; false if it was already processed (concurrently or before). */
async function claimEvent(tx: Tx, event: ProviderEvent): Promise<boolean> {
  try {
    await tx.billingEvent.create({ data: { id: event.id, type: event.type } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

class DuplicateEvent extends Error {}

/**
 * Apply one verified webhook event. Idempotent. Throws on transient failures
 * (provider or database), so the route answers 500 and the provider retries.
 */
export async function processWebhookEvent(
  event: ProviderEvent,
  provider: BillingProvider,
): Promise<SyncOutcome> {
  const db = getDb();
  if (await db.billingEvent.findUnique({ where: { id: event.id }, select: { id: true } })) {
    return "duplicate";
  }
  const subscriptionId = event.object.kind === "subscription" ? event.object.subscriptionId : null;
  const organizationId = subscriptionId ? await organizationForSubscription(subscriptionId) : null;
  // Read the subscription before the transaction (network call).
  const subscription =
    subscriptionId && organizationId ? await provider.retrieveSubscription(subscriptionId) : null;
  if (organizationId && !subscription) {
    logger.warn("Subscription not found at the provider; event ignored", {
      eventId: event.id,
      subscriptionId,
    });
  }
  const audit: AuditEvent[] =
    event.type === "subscription.pending" && subscriptionId
      ? [
          {
            action: "billing.payment_failed",
            resourceId: subscriptionId,
            metadata: { event: event.type },
          },
        ]
      : [];

  try {
    return await db.$transaction(async (tx) => {
      if (!(await claimEvent(tx, event))) throw new DuplicateEvent();
      if (!organizationId || !subscription) return "ignored";
      const applied = await applySubscription(tx, organizationId, subscription, { audit });
      return applied ? "applied" : "ignored";
    });
  } catch (error) {
    if (error instanceof DuplicateEvent) return "duplicate";
    throw error;
  }
}

/**
 * Re-read the organization's current subscription from the provider and
 * store it (billing page visits, and after ClientFlow changed it). Uses only
 * the subscription id stored for the organization, never request input.
 */
export async function syncSubscription(
  organizationId: string,
  provider: BillingProvider,
  options: { cancellationRequested?: boolean } = {},
): Promise<boolean> {
  const stored = await getDb().subscription.findUnique({ where: { organizationId } });
  if (!stored?.providerSubscriptionId) return false;
  const subscription = await provider.retrieveSubscription(stored.providerSubscriptionId);
  if (!subscription) return false;
  return getDb().$transaction((tx) => applySubscription(tx, organizationId, subscription, options));
}

/**
 * Remember the subscription ClientFlow just created at the provider (not paid
 * yet: no plan). Replaces an earlier unfinished one.
 */
export async function recordNewSubscription(organizationId: string, subscriptionId: string) {
  const data = {
    providerSubscriptionId: subscriptionId,
    plan: "FREE" as const,
    status: "INCOMPLETE" as const,
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasScheduledChange: false,
  };
  await getDb().subscription.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
}
