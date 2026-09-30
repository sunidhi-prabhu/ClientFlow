import {
  type BillingInterval,
  type BillingPlan,
  type SubscriptionStatus,
} from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/money";

/*
 * Plans, prices and entitlements. Pure (no database, no Stripe) so the server
 * (limit checks, checkout), the pricing UI and the tests share one definition.
 * The server derives an organization's limits from its stored plan and
 * subscription status with `entitlementsFor`; limits are never read from a
 * request.
 */

export type { BillingInterval, BillingPlan, SubscriptionStatus };
export type PaidPlan = Exclude<BillingPlan, "FREE">;

export type PlanDefinition = {
  name: string;
  description: string;
  /** Maximum active (non-archived) clients. */
  clientLimit: number;
  /** Maximum active (non-archived) projects. */
  projectLimit: number;
  /** Price in US cents per billing interval (0 for Free). */
  priceCents: Record<BillingInterval, number>;
};

export const PLANS: Record<BillingPlan, PlanDefinition> = {
  FREE: {
    name: "Free",
    description: "For trying ClientFlow with your first clients.",
    clientLimit: 5,
    projectLimit: 5,
    priceCents: { MONTH: 0, YEAR: 0 },
  },
  STARTER: {
    name: "Starter",
    description: "For freelancers with a steady client list.",
    clientLimit: 15,
    projectLimit: 15,
    priceCents: { MONTH: 900, YEAR: 9_000 },
  },
  GROWTH: {
    name: "Growth",
    description: "For small teams taking on more work.",
    clientLimit: 50,
    projectLimit: 50,
    priceCents: { MONTH: 1_900, YEAR: 19_000 },
  },
  PROFESSIONAL: {
    name: "Professional",
    description: "For established studios and consultancies.",
    clientLimit: 150,
    projectLimit: 150,
    priceCents: { MONTH: 3_900, YEAR: 39_000 },
  },
  AGENCY: {
    name: "Agency",
    description: "For agencies running many accounts at once.",
    clientLimit: 500,
    projectLimit: 500,
    priceCents: { MONTH: 7_900, YEAR: 79_000 },
  },
};

/** Cheapest first. */
export const PLAN_ORDER = [
  "FREE",
  "STARTER",
  "GROWTH",
  "PROFESSIONAL",
  "AGENCY",
] as const satisfies readonly BillingPlan[];

export const PAID_PLANS = [
  "STARTER",
  "GROWTH",
  "PROFESSIONAL",
  "AGENCY",
] as const satisfies readonly PaidPlan[];

export const BILLING_INTERVALS = ["MONTH", "YEAR"] as const satisfies readonly BillingInterval[];

export function isPaidPlan(plan: BillingPlan): plan is PaidPlan {
  return plan !== "FREE";
}

/** Position in PLAN_ORDER: higher is a bigger plan. */
export function planRank(plan: BillingPlan): number {
  return PLAN_ORDER.indexOf(plan);
}

/**
 * Subscription statuses in which the paid plan applies. PAST_DUE keeps it
 * while Stripe retries the payment (smart retries / dunning); UNPAID,
 * CANCELED, INCOMPLETE, INCOMPLETE_EXPIRED and PAUSED fall back to Free.
 * Falling back never removes data: it only stops new creations above the
 * Free limits.
 */
const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

export type BillingState = { plan: BillingPlan; status: SubscriptionStatus | null } | null;

/** The plan whose limits currently apply (Free without a paying subscription). */
export function effectivePlan(state: BillingState): BillingPlan {
  if (!state || !isPaidPlan(state.plan)) return "FREE";
  return state.status && ENTITLED_STATUSES.has(state.status) ? state.plan : "FREE";
}

export type LimitedResource = "clients" | "projects";

export type Entitlements = { plan: BillingPlan; limits: Record<LimitedResource, number> };

export function entitlementsFor(state: BillingState): Entitlements {
  const plan = effectivePlan(state);
  return {
    plan,
    limits: { clients: PLANS[plan].clientLimit, projects: PLANS[plan].projectLimit },
  };
}

export type Usage = {
  used: number;
  limit: number;
  /** New records that can still be added (0 at or over the limit). */
  remaining: number;
  /** Records above the limit (after a downgrade); they stay fully usable. */
  overBy: number;
  atLimit: boolean;
};

export function usageOf(used: number, limit: number): Usage {
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    overBy: Math.max(0, used - limit),
    atLimit: used >= limit,
  };
}

const SINGULAR: Record<LimitedResource, string> = { clients: "client", projects: "project" };

/** Shown when a create (or restore) would exceed the plan. */
export function limitReachedMessage(
  resource: LimitedResource,
  limit: number,
  operation: "add" | "restore" = "add",
): string {
  return operation === "add"
    ? `You've reached your ${limit}-${SINGULAR[resource]} limit. Upgrade your plan to add more ${resource}.`
    : `You've reached your ${limit}-${SINGULAR[resource]} limit. Upgrade your plan to restore this ${SINGULAR[resource]}.`;
}

const INTERVAL_SUFFIX: Record<BillingInterval, string> = { MONTH: "/month", YEAR: "/year" };

/** "$0", "$9/month", "$790/year". */
export function formatPlanPrice(plan: BillingPlan, interval: BillingInterval): string {
  const cents = PLANS[plan].priceCents[interval];
  if (cents === 0) return "$0";
  const amount = formatMoney(cents, "USD").replace(/\.00$/, "");
  return `${amount}${INTERVAL_SUFFIX[interval]}`;
}

/** What paying yearly saves compared with twelve monthly payments, in cents. */
export function annualSavingsCents(plan: BillingPlan): number {
  const { MONTH, YEAR } = PLANS[plan].priceCents;
  return MONTH * 12 - YEAR;
}

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Payment overdue",
  UNPAID: "Unpaid",
  CANCELED: "Cancelled",
  INCOMPLETE: "Payment incomplete",
  INCOMPLETE_EXPIRED: "Payment expired",
  PAUSED: "Paused",
};

export const INTERVAL_LABELS: Record<BillingInterval, string> = {
  MONTH: "Monthly",
  YEAR: "Annual",
};
