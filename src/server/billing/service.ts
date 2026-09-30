import "server-only";

import {
  type BillingInterval,
  type BillingState,
  entitlementsFor,
  type PaidPlan,
  PLANS,
  type SubscriptionStatus,
  usageOf,
} from "@/lib/billing";
import { getAuthEnv } from "@/lib/env";
import { ConflictError, ServiceUnavailableError } from "@/lib/errors";
import { recordAudit } from "@/server/audit/service";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

import { countActive, getBillingState } from "./limits";
import { isBillingConfigured, priceIdFor } from "./prices";
import { type BillingProvider } from "./provider";
import { stripeBillingProvider } from "./stripe";
import { syncSubscription } from "./sync";

/*
 * Plans and limits inside an organization (tenant client only). The
 * organization's limits come from its stored billing state (written from
 * verified Stripe data by ./sync.ts); nothing here accepts a plan, limit,
 * price or organization id from a request beyond the validated plan the user
 * wants to buy.
 */

type Deps = { ctx: TenantContext; db: TenantDb };

/** Subscriptions that already exist in Stripe (a new checkout would duplicate them). */
const OPEN: ReadonlySet<SubscriptionStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "UNPAID",
  "INCOMPLETE",
  "PAUSED",
]);
/** Subscriptions whose plan can be changed or cancelled. */
const MANAGEABLE: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

export type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;

/** Plan, subscription and usage for the billing page and limit notices. */
export async function getBillingOverview(db: TenantDb) {
  const [state, counts] = await Promise.all([getBillingState(db), countActive(db)]);
  const entitlements = entitlementsFor(state as BillingState);
  return {
    configured: isBillingConfigured(),
    entitlements,
    subscription: state && {
      plan: state.plan,
      status: state.status,
      interval: state.interval,
      currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      hasCustomer: Boolean(state.stripeCustomerId),
    },
    usage: {
      clients: usageOf(counts.clients, entitlements.limits.clients),
      projects: usageOf(counts.projects, entitlements.limits.projects),
    },
  };
}

function billingUrl(ctx: TenantContext, query = "") {
  const base = getAuthEnv().BETTER_AUTH_URL.replace(/\/$/, "");
  return `${base}/o/${ctx.organization.slug}/billing${query}`;
}

function requireConfigured() {
  if (!isBillingConfigured()) {
    throw new ServiceUnavailableError("Paid plans are not available yet. Please try again later.");
  }
}

function requirePrice(plan: PaidPlan, interval: BillingInterval) {
  const priceId = priceIdFor(plan, interval);
  if (!priceId) throw new ServiceUnavailableError("This plan is not available right now");
  return priceId;
}

/** Start Stripe Checkout for a first paid plan. Returns the Checkout URL. */
export async function startCheckout(
  { ctx, db }: Deps,
  input: { plan: PaidPlan; interval: BillingInterval },
  provider: BillingProvider = stripeBillingProvider,
) {
  requireConfigured();
  const priceId = requirePrice(input.plan, input.interval);
  const state = await getBillingState(db);
  if (state?.status && OPEN.has(state.status)) {
    throw new ConflictError(
      "Your organization already has a subscription. Change its plan instead of starting a new one.",
    );
  }

  let customerId = state?.stripeCustomerId;
  if (!customerId) {
    customerId = await provider.createCustomer({
      organizationId: ctx.organization.id,
      name: ctx.organization.name,
    });
    await db.subscription.upsert({
      where: { organizationId: ctx.organization.id },
      create: { organizationId: ctx.organization.id, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  const session = await provider.createCheckoutSession({
    customerId,
    priceId,
    organizationId: ctx.organization.id,
    successUrl: billingUrl(ctx, "?checkout=success"),
    cancelUrl: billingUrl(ctx, "?checkout=cancelled"),
  });
  await recordAudit(db, ctx, {
    action: "billing.checkout_started",
    metadata: { plan: input.plan, interval: input.interval },
  });
  return session;
}

async function requireManageableSubscription(db: TenantDb) {
  const state = await getBillingState(db);
  if (!state?.stripeSubscriptionId || !state.status || !MANAGEABLE.has(state.status)) {
    throw new ConflictError("Your organization has no active subscription to change.");
  }
  return { ...state, stripeSubscriptionId: state.stripeSubscriptionId };
}

/**
 * Move an active subscription to another paid plan or interval. Stripe charges
 * (or credits) the difference; the new plan applies once that succeeds.
 */
export async function changePlan(
  { ctx, db }: Deps,
  input: { plan: PaidPlan; interval: BillingInterval },
  provider: BillingProvider = stripeBillingProvider,
) {
  requireConfigured();
  const priceId = requirePrice(input.plan, input.interval);
  const state = await requireManageableSubscription(db);
  const subscription = await provider.retrieveSubscription(state.stripeSubscriptionId);
  if (!subscription?.itemId || subscription.customerId !== state.stripeCustomerId) {
    throw new ConflictError("Your subscription could not be found. Please contact support.");
  }
  if (subscription.priceId === priceId) {
    throw new ConflictError(`You are already on the ${PLANS[input.plan].name} plan.`);
  }
  await provider.changeSubscriptionPrice({
    subscriptionId: subscription.id,
    itemId: subscription.itemId,
    priceId,
  });
  await recordAudit(db, ctx, {
    action: "billing.plan_change_requested",
    resourceId: subscription.id,
    metadata: {
      from: { plan: state.plan, interval: state.interval },
      to: { plan: input.plan, interval: input.interval },
    },
  });
  await syncSubscription(ctx.organization.id, subscription.id, provider);
}

/**
 * Cancel at the end of the paid period (downgrade to Free then). Nothing is
 * deleted: above the Free limits, only new clients/projects are refused.
 */
export async function cancelSubscription(
  { ctx, db }: Deps,
  provider: BillingProvider = stripeBillingProvider,
) {
  requireConfigured();
  const state = await requireManageableSubscription(db);
  if (state.cancelAtPeriodEnd) throw new ConflictError("Your subscription is already set to end.");
  await provider.setCancelAtPeriodEnd(state.stripeSubscriptionId, true);
  await recordAudit(db, ctx, {
    action: "billing.cancellation_requested",
    resourceId: state.stripeSubscriptionId,
    metadata: { plan: state.plan, interval: state.interval, accessUntil: state.currentPeriodEnd },
  });
  await syncSubscription(ctx.organization.id, state.stripeSubscriptionId, provider);
}

/** Keep a subscription that was set to end. */
export async function resumeSubscription(
  { ctx, db }: Deps,
  provider: BillingProvider = stripeBillingProvider,
) {
  requireConfigured();
  const state = await requireManageableSubscription(db);
  if (!state.cancelAtPeriodEnd) throw new ConflictError("Your subscription is not set to end.");
  await provider.setCancelAtPeriodEnd(state.stripeSubscriptionId, false);
  await recordAudit(db, ctx, {
    action: "billing.cancellation_withdrawn",
    resourceId: state.stripeSubscriptionId,
    metadata: { plan: state.plan, interval: state.interval },
  });
  await syncSubscription(ctx.organization.id, state.stripeSubscriptionId, provider);
}

/** Stripe customer portal (payment method, invoices, receipts). */
export async function openBillingPortal(
  { ctx, db }: Deps,
  provider: BillingProvider = stripeBillingProvider,
) {
  requireConfigured();
  const state = await getBillingState(db);
  if (!state?.stripeCustomerId) {
    throw new ConflictError("Your organization has no billing account yet.");
  }
  return provider.createPortalSession({
    customerId: state.stripeCustomerId,
    returnUrl: billingUrl(ctx),
  });
}
