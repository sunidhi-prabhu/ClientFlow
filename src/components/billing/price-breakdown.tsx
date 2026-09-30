import {
  type BillingInterval,
  formatUsd,
  GST_RATE_BPS,
  type PaidPlan,
  PLANS,
  priceBreakdown,
} from "@/lib/billing";

const PERIOD: Record<BillingInterval, string> = { MONTH: "month", YEAR: "year" };

/** Plan price, GST and the total the customer is charged each period. */
export function PriceBreakdown({ plan, interval }: { plan: PaidPlan; interval: BillingInterval }) {
  const { priceCents, taxCents, totalCents } = priceBreakdown(plan, interval);
  return (
    <dl
      aria-label="Price breakdown"
      className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs tabular-nums"
    >
      <div className="flex justify-between gap-2">
        <dt>
          {PLANS[plan].name} ({interval === "MONTH" ? "monthly" : "annual"})
        </dt>
        <dd>{formatUsd(priceCents)}</dd>
      </div>
      <div className="flex justify-between gap-2 text-muted-foreground">
        <dt>GST ({GST_RATE_BPS / 100}%)</dt>
        <dd>{formatUsd(taxCents)}</dd>
      </div>
      <div className="flex justify-between gap-2 border-t pt-1 font-medium">
        <dt>Total per {PERIOD[interval]}</dt>
        <dd data-testid="price-total">{formatUsd(totalCents)}</dd>
      </div>
    </dl>
  );
}
