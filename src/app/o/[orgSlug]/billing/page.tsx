import { type Metadata } from "next";

import { PricingTable } from "@/components/billing/pricing-table";
import { SubscriptionActions } from "@/components/billing/subscription-actions";
import { UsageMeter } from "@/components/billing/usage-meter";
import { AccessDenied } from "@/components/layout/access-denied";
import { INTERVAL_LABELS, isPaidPlan, PLANS, SUBSCRIPTION_STATUS_LABELS } from "@/lib/billing";
import { formatCalendarDate } from "@/lib/calendar-date";
import { hasPermission } from "@/lib/permissions";
import { checkoutSessionIdSchema } from "@/lib/validation/billing";
import { logger } from "@/lib/logger";
import { getBillingOverview } from "@/server/billing/service";
import { stripeBillingProvider } from "@/server/billing/stripe";
import { syncCheckoutSession } from "@/server/billing/sync";
import { tenantPage } from "@/server/protected";

import {
  cancelSubscriptionAction,
  changePlanAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from "./actions";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/billing">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "billing:read");
  if (!access.allowed) {
    return <AccessDenied message="Only owners and admins can see the organization's plan." />;
  }
  const { ctx, db } = access;
  const query = await searchParams;

  // Returning from Stripe Checkout: apply the subscription now instead of
  // waiting for the webhook. The session id is only a lookup key: the session
  // is fetched from Stripe and must belong to this organization.
  let checkoutMessage: string | null = null;
  if (query.checkout === "success") {
    const sessionId = checkoutSessionIdSchema.safeParse(query.session_id);
    if (sessionId.success) {
      try {
        await syncCheckoutSession(ctx.organization.id, sessionId.data, stripeBillingProvider);
      } catch (error) {
        logger.warn("Checkout return sync failed; the webhook will apply it", { error });
      }
    }
    checkoutMessage = "Thanks! Your plan updates as soon as Stripe confirms the payment.";
  } else if (query.checkout === "cancelled") {
    checkoutMessage = "Checkout was cancelled. Your plan has not changed.";
  }

  const overview = await getBillingOverview(db);
  const { subscription, entitlements, usage } = overview;
  const canManage = hasPermission(ctx.role, "billing:manage");
  const plan = entitlements.plan;
  const manageable = Boolean(
    subscription?.status &&
    ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status) &&
    isPaidPlan(subscription.plan),
  );
  const status = subscription?.status;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Your organization&apos;s plan, usage and subscription.
        </p>
      </div>

      {checkoutMessage && (
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {checkoutMessage}
        </p>
      )}
      {!overview.configured && (
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          Paid plans are not available yet, so the plan cannot be changed right now.
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
              Your last payment failed. Update your payment details to keep the {PLANS[plan].name}{" "}
              plan.
            </p>
          )}
          {subscription && isPaidPlan(subscription.plan) && !isPaidPlan(plan) && status && (
            <p className="text-sm text-muted-foreground">
              Your {PLANS[subscription.plan].name} subscription is{" "}
              {SUBSCRIPTION_STATUS_LABELS[status].toLowerCase()}, so the Free limits apply.
            </p>
          )}
          {subscription?.cancelAtPeriodEnd && (
            <p className="text-sm text-muted-foreground">
              Your organization moves to the Free plan when this period ends. Nothing is deleted.
            </p>
          )}
          {canManage && overview.configured && (
            <SubscriptionActions
              organizationSlug={ctx.organization.slug}
              showPortal={Boolean(subscription?.hasCustomer)}
              showResume={Boolean(manageable && subscription?.cancelAtPeriodEnd)}
              portalAction={openBillingPortalAction}
              resumeAction={resumeSubscriptionAction}
            />
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
              ? "Upgrades apply as soon as the payment succeeds. Downgrades never delete anything."
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
