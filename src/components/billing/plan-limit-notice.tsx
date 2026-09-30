import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  type BillingPlan,
  limitReachedMessage,
  type LimitedResource,
  PLANS,
  type Usage,
} from "@/lib/billing";

/**
 * Shown on client/project pages once the plan's limit is reached (or exceeded
 * after a downgrade). The server enforces the limit; this only explains it.
 */
export function PlanLimitNotice({
  resource,
  usage,
  billingPath,
}: {
  resource: LimitedResource;
  usage: Usage & { plan: BillingPlan };
  /** Link to the billing page, for roles that can change the plan. */
  billingPath?: string;
}) {
  if (!usage.atLimit) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl bg-destructive/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium">{limitReachedMessage(resource, usage.limit)}</p>
          <p className="text-muted-foreground">
            {usage.used} / {usage.limit} active {resource} on the {PLANS[usage.plan].name} plan.
            {usage.overBy > 0 && ` Existing ${resource} stay fully usable.`}
            {!billingPath && " Ask an owner or admin to upgrade."}
          </p>
        </div>
      </div>
      {billingPath && (
        <Link href={billingPath} className={buttonVariants({ variant: "outline" })}>
          View plans
        </Link>
      )}
    </div>
  );
}
