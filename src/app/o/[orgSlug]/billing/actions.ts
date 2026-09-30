"use server";

import { noInput, paidPlanInput } from "@/lib/validation/billing";
import {
  cancelSubscription,
  changePlan,
  openBillingPortal,
  resumeSubscription,
  startCheckout,
} from "@/server/billing/service";
import { tenantAction } from "@/server/protected";

/*
 * Billing Server Actions: the standard pipeline (session → tenant context →
 * permission → validation) with `billing:manage` (OWNER and ADMIN). The input
 * is only the plan and interval; the Stripe Price, the organization and the
 * resulting limits are all resolved on the server. Nothing here changes the
 * plan directly: Stripe does, and verified Stripe data is stored by
 * src/server/billing/sync.ts.
 */

/** Returns the Stripe Checkout URL to send the browser to. */
export const startCheckoutAction = tenantAction(
  { permission: "billing:manage", input: paidPlanInput },
  async ({ ctx, db, input }) => {
    const { url } = await startCheckout({ ctx, db }, input);
    return { url };
  },
);

export const changePlanAction = tenantAction(
  { permission: "billing:manage", input: paidPlanInput },
  async ({ ctx, db, input }) => {
    await changePlan({ ctx, db }, input);
    return null;
  },
);

export const cancelSubscriptionAction = tenantAction(
  { permission: "billing:manage", input: noInput },
  async ({ ctx, db }) => {
    await cancelSubscription({ ctx, db });
    return null;
  },
);

export const resumeSubscriptionAction = tenantAction(
  { permission: "billing:manage", input: noInput },
  async ({ ctx, db }) => {
    await resumeSubscription({ ctx, db });
    return null;
  },
);

/** Returns the Stripe customer portal URL (payment method, invoices). */
export const openBillingPortalAction = tenantAction(
  { permission: "billing:manage", input: noInput },
  async ({ ctx, db }) => openBillingPortal({ ctx, db }),
);
