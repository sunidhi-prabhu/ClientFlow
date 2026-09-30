import { type Metadata } from "next";

import { PricingTable } from "@/components/billing/pricing-table";
import { UsageMeter } from "@/components/billing/usage-meter";
import { AccessDenied } from "@/components/layout/access-denied";
import {
  formatUsd,
  INTERVAL_LABELS,
  isPaidPlan,
  PLANS,
  priceBreakdown,
  SUBSCRIPTION_STATUS_LABELS,
} from "@/lib/billing";
import { formatCalendarDate } from "@/lib/calendar-date";
import { hasPermission } from "@/lib/permissions";
import { getBillingOverview, refreshBillingState } from "@/server/billing/service";
import { tenantPage } from "@/server/protected";

import { cancelSubscriptionAction, changePlanAction, startCheckoutAction } from "./actions";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ params }: PageProps<"/o/[orgSlug]/billing">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "billing:read");
  if (!access.allowed) {
    return <AccessDenied message="Only owners and admins can see the organization's plan." />;
  }
  const { ctx, db } = access;

  // Re-read the organization's own subscription from Razorpay (e.g. right after
  // paying on Razorpay's page), using only the subscription id stored for it.
  await refreshBillingState(ctx);
  const overview = await getBillingOverview(db);
  const { subscription, entitlements, usage } = overview;
  const canManage = hasPermission(ctx.role, "billing:manage");
  const plan = entitlements.plan;
  const status = subscription?.status;
  const manageable = Boolean(
    status && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(status) && isPaidPlan(subscription!.plan),
  );

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your organization&apos;s plan, usage and subscription. Payments are processed securely by
          Razorpay; card details never reach ClientFlow.
        </p>
      </div>

      {!overview.configured && (
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          Paid plans are not available yet, so the plan cannot be changed right now.
        </p>
      )}
      {status === "INCOMPLETE" && (
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          Waiting for your payment. After paying on Razorpay&apos;s page, reload this page; your
          plan updates as soon as Razorpay confirms it. To start over, choose a plan again below.
        </p>
      )}

      <section aria-labelledby="current-plan" className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <h2 id="current-plan" className="text-sm font-medium text-muted-foreground">
            Current plan
          </h2>
          <p className="text-2xl font-semibold tracking-tight" data-testid="current-plan">
            {PLANS[plan].name}
          </p>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd data-testid="subscription-status">
                {status ? SUBSCRIPTION_STATUS_LABELS[status] : "No subscription"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Billing</dt>
              <dd>
                {subscription?.interval && isPaidPlan(plan)
                  ? INTERVAL_LABELS[subscription.interval]
                  : "Free"}
              </dd>
            </div>
            {subscription?.interval && isPaidPlan(plan) && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Amount</dt>
                <dd data-testid="renewal-amount">
                  {formatUsd(priceBreakdown(plan, subscription.interval).totalCents)} (incl.{" "}
                  {formatUsd(priceBreakdown(plan, subscription.interval).taxCents)} GST)
                </dd>
              </div>
            )}
            {subscription?.currentPeriodEnd && isPaidPlan(plan) && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">
                  {subscription.cancelAtPeriodEnd ? "Ends on" : "Renews on"}
                </dt>
                <dd>{formatCalendarDate(subscription.currentPeriodEnd)}</dd>
              </div>
            )}
          </dl>
          {status === "PAST_DUE" && (
            <p role="alert" className="text-sm text-destructive">
              Your last payment failed. Razorpay will retry charging your card; the{" "}
              {PLANS[plan].name} plan stays active meanwhile.
            </p>
          )}
          {subscription && isPaidPlan(subscription.plan) && !isPaidPlan(plan) && status && (
            <p className="text-sm text-muted-foreground">
              Your {PLANS[subscription.plan].name} subscription is{" "}
              {SUBSCRIPTION_STATUS_LABELS[status].toLowerCase()}, so the Free limits apply.
            </p>
          )}
          {subscription?.hasScheduledChange && (
            <p className="text-sm text-muted-foreground">
              A plan change is scheduled for the end of this billing period.
            </p>
          )}
          {subscription?.cancelAtPeriodEnd && (
            <p className="text-sm text-muted-foreground">
              Your organization moves to the Free plan when this period ends. Nothing is deleted.
            </p>
          )}
        </div>
        <UsageMeter label="clients" usage={usage.clients} />
        <UsageMeter label="projects" usage={usage.projects} />
      </section>

      <section aria-labelledby="plans-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="plans-heading" className="text-lg font-semibold tracking-tight">
            Plans
          </h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Upgrades apply as soon as Razorpay confirms the payment. Downgrades apply at the end of the billing period and never delete anything."
              : "Only owners and admins can change the plan."}
          </p>
        </div>
        <PricingTable
          mode="billing"
          organizationSlug={ctx.organization.slug}
          current={{
            plan: manageable && subscription ? subscription.plan : "FREE",
            interval: manageable ? (subscription?.interval ?? null) : null,
            manageable,
            cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
            hasScheduledChange: Boolean(subscription?.hasScheduledChange),
          }}
          canManage={canManage}
          configured={overview.configured}
          startCheckoutAction={startCheckoutAction}
          changePlanAction={changePlanAction}
          cancelAction={cancelSubscriptionAction}
        />
      </section>
    </div>
  );
}
