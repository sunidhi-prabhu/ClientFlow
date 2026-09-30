"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  annualSavingsCents,
  type BillingInterval,
  type BillingPlan,
  formatPlanPrice,
  formatUsd,
  GST_RATE_BPS,
  isPaidPlan,
  type PaidPlan,
  planChangeTiming,
  PLAN_ORDER,
  planRank,
  PLANS,
  priceBreakdown,
} from "@/lib/billing";
import { type ActionResult } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

import { PriceBreakdown } from "./price-breakdown";

type PlanAction = (
  organizationSlug: string,
  input: { plan: PaidPlan; interval: BillingInterval },
) => Promise<ActionResult<unknown>>;
type NoInputAction = (organizationSlug: string, input: object) => Promise<ActionResult<unknown>>;

export type BillingModeProps = {
  mode: "billing";
  organizationSlug: string;
  /** The plan the organization pays for, and whether its subscription can be changed. */
  current: {
    plan: BillingPlan;
    interval: BillingInterval | null;
    manageable: boolean;
    cancelAtPeriodEnd: boolean;
    hasScheduledChange: boolean;
  };
  canManage: boolean;
  configured: boolean;
  startCheckoutAction: PlanAction;
  changePlanAction: PlanAction;
  cancelAction: NoInputAction;
};

type Props = { mode: "public" } | BillingModeProps;

function IntervalToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval;
  onChange: (interval: BillingInterval) => void;
}) {
  const options: { value: BillingInterval; label: string }[] = [
    { value: "MONTH", label: "Monthly" },
    { value: "YEAR", label: "Annual" },
  ];
  return (
    <div
      role="group"
      aria-label="Billing interval"
      className="inline-flex rounded-lg bg-muted p-1 ring-1 ring-foreground/10"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={interval === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            interval === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
          {option.value === "YEAR" && (
            <span className="ml-1.5 text-xs text-primary">2 months free</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** The action area of one plan card on the billing page. */
function PlanCardAction({
  plan,
  interval,
  props,
}: {
  plan: BillingPlan;
  interval: BillingInterval;
  props: BillingModeProps;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { current, canManage, configured, organizationSlug } = props;

  const isCurrent = plan === current.plan && (!isPaidPlan(plan) || current.interval === interval);
  if (isCurrent) {
    return (
      <p className="text-sm font-medium text-primary">
        {current.cancelAtPeriodEnd && isPaidPlan(plan) ? "Current plan (ending)" : "Current plan"}
      </p>
    );
  }
  if (!canManage) return null;
  // A cancellation or plan change is already pending until the period ends.
  if (current.manageable && (current.cancelAtPeriodEnd || current.hasScheduledChange)) return null;

  // Free: downgrading means cancelling at the end of the paid period.
  if (!isPaidPlan(plan)) {
    if (!configured || !current.manageable) return null;
  } else if (!configured) {
    return <p className="text-sm text-muted-foreground">Not available yet</p>;
  }

  const label = !isPaidPlan(plan)
    ? "Downgrade to Free"
    : !current.manageable
      ? `Upgrade to ${PLANS[plan].name}`
      : planRank(plan) > planRank(current.plan)
        ? `Upgrade to ${PLANS[plan].name}`
        : planRank(plan) < planRank(current.plan)
          ? `Downgrade to ${PLANS[plan].name}`
          : `Switch to ${interval === "YEAR" ? "annual" : "monthly"}`;
  const timing = isPaidPlan(plan) ? planChangeTiming(current, { plan, interval }) : "cycle_end";

  function run() {
    setError(null);
    startTransition(async () => {
      if (!isPaidPlan(plan)) {
        const result = await props.cancelAction(organizationSlug, {});
        if (!result.ok) return setError(result.error.message);
      } else if (!current.manageable) {
        const result = await props.startCheckoutAction(organizationSlug, { plan, interval });
        if (!result.ok) return setError(result.error.message);
        setPaymentUrl((result.data as { url: string }).url);
        return;
      } else {
        const result = await props.changePlanAction(organizationSlug, { plan, interval });
        if (!result.ok) return setError(result.error.message);
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (paymentUrl && isPaidPlan(plan)) {
    return (
      <div className="space-y-2" role="status">
        <PriceBreakdown plan={plan} interval={interval} />
        <p className="text-xs text-muted-foreground">
          Pay {formatUsd(priceBreakdown(plan, interval).totalCents)} (includes GST) on
          Razorpay&apos;s secure page, then come back here.
        </p>
        <a
          href={paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants(), "w-full")}
        >
          Pay with Razorpay
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <Button variant="outline" className="w-full" onClick={() => router.refresh()}>
          I&apos;ve paid, refresh status
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="space-y-2">
          {isPaidPlan(plan) && <PriceBreakdown plan={plan} interval={interval} />}
          <p className="text-xs text-muted-foreground">
            {!isPaidPlan(plan)
              ? "Your paid plan stays active until the end of the billing period, then the organization moves to Free. This can't be undone; nothing is deleted."
              : !current.manageable
                ? `Razorpay charges this total, including GST, today and every ${interval === "MONTH" ? "month" : "year"} until you cancel.`
                : timing === "now"
                  ? "Applies right away. Razorpay charges your card for the new plan, including GST."
                  : "Applies at the end of the current billing period."}
          </p>
          {/* Stacked: plan cards are narrow (five across on wide screens). */}
          <div className="grid gap-2">
            <Button
              autoFocus
              className="w-full"
              variant={isPaidPlan(plan) ? "default" : "destructive"}
              disabled={pending}
              onClick={run}
            >
              {pending ? "Working…" : !current.manageable ? "Continue to payment" : "Confirm"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="w-full"
          variant={
            isPaidPlan(plan) && planRank(plan) > planRank(current.plan) ? "default" : "outline"
          }
          disabled={pending}
          // Every choice is confirmed first (paid ones show the price, GST and total).
          onClick={() => setConfirming(true)}
        >
          {label}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The five plans with a monthly/annual toggle. Public mode (landing page)
 * links to sign-up; billing mode shows the organization's current plan and
 * the upgrade/downgrade actions its role allows (the server checks again).
 */
export function PricingTable(props: Props) {
  const [interval, setInterval] = useState<BillingInterval>(
    props.mode === "billing" && props.current.interval ? props.current.interval : "MONTH",
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <IntervalToggle interval={interval} onChange={setInterval} />
      </div>
      <ul
        aria-label="Plans"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        {PLAN_ORDER.map((plan) => {
          const definition = PLANS[plan];
          const savings = annualSavingsCents(plan);
          const highlighted = plan === "GROWTH";
          return (
            <li
              key={plan}
              aria-label={definition.name}
              className={cn(
                "flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10",
                highlighted && "ring-2 ring-primary",
              )}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{definition.name}</h3>
                  {highlighted && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Popular
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{definition.description}</p>
              </div>
              <div>
                <p className="text-2xl font-semibold tracking-tight" data-testid="plan-price">
                  {formatPlanPrice(plan, interval)}
                </p>
                <p className="min-h-4 text-xs text-muted-foreground" data-testid="plan-tax">
                  {isPaidPlan(plan)
                    ? `+ ${GST_RATE_BPS / 100}% GST · ${formatUsd(priceBreakdown(plan, interval).totalCents)}${interval === "MONTH" ? "/month" : "/year"} total`
                    : "No GST"}
                </p>
                <p className="min-h-4 text-xs text-muted-foreground">
                  {interval === "YEAR" && savings > 0
                    ? `Save ${formatMoney(savings, "USD").replace(/\.00$/, "")} a year`
                    : ""}
                </p>
              </div>
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  {definition.clientLimit} active clients
                </li>
                <li className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  {definition.projectLimit} active projects
                </li>
                <li className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  Tasks, invoices and dashboard
                </li>
              </ul>
              <div className="mt-auto">
                {props.mode === "public" ? (
                  <Link
                    href="/sign-up"
                    className={cn(
                      buttonVariants({ variant: highlighted ? "default" : "outline" }),
                      "w-full",
                    )}
                  >
                    {isPaidPlan(plan) ? `Start with ${definition.name}` : "Start free"}
                  </Link>
                ) : (
                  <PlanCardAction plan={plan} interval={interval} props={props} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
