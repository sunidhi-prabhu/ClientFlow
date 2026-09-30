import "server-only";

import {
  type BillingInterval,
  type BillingState,
  entitlementsFor,
  type PaidPlan,
  planChangeTiming,
  PLANS,
  priceBreakdown,
  type SubscriptionStatus,
  usageOf,
} from "@/lib/billing";
import { ConflictError, ServiceUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/audit/service";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

import { countActive, getBillingState } from "./limits";
import { isBillingConfigured, providerPlanIdFor } from "./plan-ids";
import { type BillingProvider } from "./provider";
import { razorpayBillingProvider } from "./razorpay";
import { recordNewSubscription, syncSubscription } from "./sync";

/*
 * Billing operations inside an organization. The organization's limits come
 * from its stored billing state (written by ./sync.ts from subscription data
 * read back from the provider); nothing here accepts a plan limit, price,
 * provider id or organization id from a request beyond the validated plan the
 * user wants to buy. None of these operations writes the plan itself.
 */

type Deps = { ctx: TenantContext; db: TenantDb };

/** Subscriptions that exist and are (or were) paid: a second one would double-bill. */
const OPEN: ReadonlySet<SubscriptionStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "UNPAID",
  "PAUSED",
]);
/** Subscriptions whose plan can be changed or cancelled. */
const MANAGEABLE: ReadonlySet<SubscriptionStatus> = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

/**
 * Billing cycles a subscription runs for (the provider requires a count):
 * about ten years, after which it ends and can be renewed.
 */
const TOTAL_CYCLES: Record<BillingInterval, number> = { MONTH: 120, YEAR: 10 };

export type BillingOverview = Awaited<ReturnType<typeof getBillingOverview>>;

/** Plan, subscription and usage for the billing page. */
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
      hasScheduledChange: state.hasScheduledChange,
    },
    usage: {
      clients: usageOf(counts.clients, entitlements.limits.clients),
      projects: usageOf(counts.projects, entitlements.limits.projects),
    },
  };
}

/**
 * Bring the organization's billing state up to date from the provider (billing
 * page visits: e.g. right after paying on the provider's page). Uses only the
 * subscription id stored for the organization; failures keep the stored state.
 */
export async function refreshBillingState(
  ctx: TenantContext,
  provider: BillingProvider = razorpayBillingProvider,
) {
  if (!isBillingConfigured()) return;
  try {
    await syncSubscription(ctx.organization.id, provider);
  } catch (error) {
    logger.warn("Could not refresh the subscription from the provider", {
      organizationId: ctx.organization.id,
      error,
    });
  }
}

function requireConfigured() {
  if (!isBillingConfigured()) {
    throw new ServiceUnavailableError("Paid plans are not available yet. Please try again later.");
  }
}

/**
 * The provider plan for a paid plan, checked against the published price plus
 * GST (the amount the customer is charged): a misconfigured plan (wrong
 * amount, currency or period) is never charged.
 */
async function requireProviderPlan(
  plan: PaidPlan,
  interval: BillingInterval,
  provider: BillingProvider,
) {
  const providerPlanId = providerPlanIdFor(plan, interval);
  if (!providerPlanId) throw new ServiceUnavailableError("This plan is not available right now");
  const providerPlan = await provider.retrievePlan(providerPlanId);
  const period = interval === "MONTH" ? "monthly" : "yearly";
  if (
    !providerPlan ||
    providerPlan.currency !== "USD" ||
    providerPlan.amount !== priceBreakdown(plan, interval).totalCents ||
    providerPlan.period !== period ||
    providerPlan.interval !== 1
  ) {
    logger.error("Provider plan does not match the published price; not charging", {
      plan,
      interval,
      providerPlanId,
      found: providerPlan && {
        amount: providerPlan.amount,
        currency: providerPlan.currency,
        period: providerPlan.period,
        interval: providerPlan.interval,
      },
    });
    throw new ServiceUnavailableError("This plan is not available right now");
  }
  return providerPlanId;
}

/**
 * Start a first paid subscription: create it at the provider and return the
 * provider's payment page. The plan applies once the provider reports it
 * paid (webhook, or the billing page re-reading the subscription).
 */
export async function startCheckout(
  { ctx, db }: Deps,
  input: { plan: PaidPlan; interval: BillingInterval },
  provider: BillingProvider = razorpayBillingProvider,
) {
  requireConfigured();
  const state = await getBillingState(db);
  if (state?.status && OPEN.has(state.status)) {
    throw new ConflictError(
      "Your organization already has a subscription. Change its plan instead of starting a new one.",
    );
  }
  const providerPlanId = await requireProviderPlan(input.plan, input.interval, provider);

  // An earlier checkout that was never paid is replaced (and cancelled, so its
  // payment link can no longer be used).
  if (state?.providerSubscriptionId && state.status === "INCOMPLETE") {
    await provider
      .cancelSubscription(state.providerSubscriptionId, { atCycleEnd: false })
      .catch((error) =>
        logger.warn("Could not cancel an unfinished subscription", {
          subscriptionId: state.providerSubscriptionId,
          error,
        }),
      );
  }

  const subscription = await provider.createSubscription({
    planId: providerPlanId,
    organizationId: ctx.organization.id,
    totalCount: TOTAL_CYCLES[input.interval],
  });
  await recordNewSubscription(ctx.organization.id, subscription.id);
  const { priceCents, taxCents, totalCents } = priceBreakdown(input.plan, input.interval);
  await recordAudit(db, ctx, {
    action: "billing.checkout_started",
    resourceId: subscription.id,
    metadata: { plan: input.plan, interval: input.interval, priceCents, taxCents, totalCents },
  });
  return { url: subscription.url };
}

async function requireManageableSubscription(db: TenantDb) {
  const state = await getBillingState(db);
  if (!state?.providerSubscriptionId || !state.status || !MANAGEABLE.has(state.status)) {
    throw new ConflictError("Your organization has no active subscription to change.");
  }
  if (state.cancelAtPeriodEnd) {
    throw new ConflictError(
      "Your subscription is set to end. Subscribe again after it ends to choose another plan.",
    );
  }
  return { ...state, providerSubscriptionId: state.providerSubscriptionId };
}

/** Move an active subscription to another paid plan or interval. */
export async function changePlan(
  { ctx, db }: Deps,
  input: { plan: PaidPlan; interval: BillingInterval },
  provider: BillingProvider = razorpayBillingProvider,
) {
  requireConfigured();
  const state = await requireManageableSubscription(db);
  if (state.plan === input.plan && state.interval === input.interval) {
    throw new ConflictError(`You are already on the ${PLANS[input.plan].name} plan.`);
  }
  if (state.hasScheduledChange) {
    throw new ConflictError("A plan change is already scheduled for the end of this period.");
  }
  const providerPlanId = await requireProviderPlan(input.plan, input.interval, provider);
  const when = planChangeTiming(state, input);
  await provider.changeSubscriptionPlan({
    subscriptionId: state.providerSubscriptionId,
    planId: providerPlanId,
    when,
  });
  await recordAudit(db, ctx, {
    action: "billing.plan_change_requested",
    resourceId: state.providerSubscriptionId,
    metadata: {
      from: { plan: state.plan, interval: state.interval },
      to: { plan: input.plan, interval: input.interval },
      applies: when === "now" ? "now" : "at_period_end",
    },
  });
  await syncSubscription(ctx.organization.id, provider);
  return { when };
}

/**
 * Cancel at the end of the paid period (the organization then moves to Free).
 * The provider cannot undo this. Nothing is deleted: above the Free limits,
 * only new clients/projects are refused.
 */
export async function cancelSubscription(
  { ctx, db }: Deps,
  provider: BillingProvider = razorpayBillingProvider,
) {
  requireConfigured();
  const state = await requireManageableSubscription(db);
  await provider.cancelSubscription(state.providerSubscriptionId, { atCycleEnd: true });
  await recordAudit(db, ctx, {
    action: "billing.cancellation_requested",
    resourceId: state.providerSubscriptionId,
    metadata: { plan: state.plan, interval: state.interval, accessUntil: state.currentPeriodEnd },
  });
  await syncSubscription(ctx.organization.id, provider, { cancellationRequested: true });
}
