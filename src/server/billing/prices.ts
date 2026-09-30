import "server-only";

import { type BillingInterval, type PaidPlan } from "@/lib/billing";
import { getBillingEnv, STRIPE_PRICE_ENV } from "@/lib/env";

/*
 * The only mapping between application plans and Stripe Prices, both
 * directions, from server configuration. Checkout looks the Price up from the
 * plan the user chose (a validated enum); a Price id is never accepted from
 * the browser. Webhooks map the Price on a verified subscription back to a
 * plan; an unknown Price grants nothing.
 */

export function isBillingConfigured(): boolean {
  return Boolean(getBillingEnv().STRIPE_SECRET_KEY);
}

export function priceIdFor(plan: PaidPlan, interval: BillingInterval): string | undefined {
  const env = getBillingEnv() as Record<string, string | undefined>;
  return env[STRIPE_PRICE_ENV[plan][interval]];
}

export function planForPriceId(
  priceId: string | null | undefined,
): { plan: PaidPlan; interval: BillingInterval } | null {
  if (!priceId) return null;
  const env = getBillingEnv() as Record<string, string | undefined>;
  for (const [plan, byInterval] of Object.entries(STRIPE_PRICE_ENV)) {
    for (const [interval, variable] of Object.entries(byInterval)) {
      if (env[variable] === priceId) {
        return { plan: plan as PaidPlan, interval: interval as BillingInterval };
      }
    }
  }
  return null;
}
