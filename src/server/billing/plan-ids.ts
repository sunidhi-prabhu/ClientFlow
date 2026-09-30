import "server-only";

import { type BillingInterval, type PaidPlan } from "@/lib/billing";
import { getBillingEnv, RAZORPAY_PLAN_ENV } from "@/lib/env";

/*
 * The only mapping between application plans and the provider's plan ids,
 * both directions, from server configuration. Checkout looks the provider
 * plan up from the plan the user chose (a validated enum); a provider plan id
 * is never accepted from the browser. Syncing maps the plan on a subscription
 * read back from the provider to an application plan; an unknown plan grants
 * nothing.
 */

export function isBillingConfigured(): boolean {
  return Boolean(getBillingEnv().RAZORPAY_KEY_ID);
}

export function providerPlanIdFor(plan: PaidPlan, interval: BillingInterval): string | undefined {
  const env = getBillingEnv() as Record<string, string | undefined>;
  return env[RAZORPAY_PLAN_ENV[plan][interval]];
}

export function planForProviderPlanId(
  providerPlanId: string | null | undefined,
): { plan: PaidPlan; interval: BillingInterval } | null {
  if (!providerPlanId) return null;
  const env = getBillingEnv() as Record<string, string | undefined>;
  for (const [plan, byInterval] of Object.entries(RAZORPAY_PLAN_ENV)) {
    for (const [interval, variable] of Object.entries(byInterval)) {
      if (env[variable] === providerPlanId) {
        return { plan: plan as PaidPlan, interval: interval as BillingInterval };
      }
    }
  }
  return null;
}
