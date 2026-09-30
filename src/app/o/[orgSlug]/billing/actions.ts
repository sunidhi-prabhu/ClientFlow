"use server";

import { noInput, paidPlanInput } from "@/lib/validation/billing";
import { cancelSubscription, changePlan, startCheckout } from "@/server/billing/service";
import { tenantAction } from "@/server/protected";

/*
 * Billing Server Actions: the standard pipeline (session → tenant context →
 * permission → validation) with `billing:manage` (OWNER and ADMIN). The input
 * is only the plan and interval; the provider plan, the organization and the
 * resulting limits are all resolved on the server. Nothing here changes the
 * plan directly: the payment provider does, and src/server/billing/sync.ts
 * stores what the provider reports.
 */

/** Returns the provider's payment page for a first paid plan. */
export const startCheckoutAction = tenantAction(
  { permission: "billing:manage", input: paidPlanInput },
  async ({ ctx, db, input }) => startCheckout({ ctx, db }, input),
);

export const changePlanAction = tenantAction(
  { permission: "billing:manage", input: paidPlanInput },
  async ({ ctx, db, input }) => changePlan({ ctx, db }, input),
);

export const cancelSubscriptionAction = tenantAction(
  { permission: "billing:manage", input: noInput },
  async ({ ctx, db }) => {
    await cancelSubscription({ ctx, db });
    return null;
  },
);
