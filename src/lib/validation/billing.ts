import { z } from "zod";

import { BILLING_INTERVALS, PAID_PLANS } from "@/lib/billing";

/**
 * The only billing input accepted from the browser: which paid plan and
 * interval. Prices, limits, organization ids and payment-provider ids are
 * never read from a request (unknown keys are stripped); the server maps the
 * plan to its configured provider plan.
 */
export const paidPlanInput = z.object({
  plan: z.enum(PAID_PLANS, "Choose a plan"),
  interval: z.enum(BILLING_INTERVALS, "Choose monthly or annual billing"),
});

export type PaidPlanInput = z.infer<typeof paidPlanInput>;

export const noInput = z.object({});
