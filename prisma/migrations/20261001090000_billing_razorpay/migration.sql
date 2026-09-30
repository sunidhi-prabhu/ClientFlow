-- Billing provider: Stripe → Razorpay. Renames keep any existing data.

-- Provider-neutral subscription id (Razorpay `sub_…`).
ALTER TABLE "Subscription" RENAME COLUMN "stripeSubscriptionId" TO "providerSubscriptionId";
ALTER INDEX "Subscription_stripeSubscriptionId_key" RENAME TO "Subscription_providerSubscriptionId_key";

-- Razorpay subscriptions need no separate customer object.
DROP INDEX "Subscription_stripeCustomerId_key";
ALTER TABLE "Subscription" DROP COLUMN "stripeCustomerId";

-- A plan change scheduled for the end of the current period (downgrades).
ALTER TABLE "Subscription" ADD COLUMN "hasScheduledChange" BOOLEAN NOT NULL DEFAULT false;

-- Processed webhook events (idempotency), now provider-neutral.
ALTER TABLE "StripeEvent" RENAME TO "BillingEvent";
ALTER TABLE "BillingEvent" RENAME CONSTRAINT "StripeEvent_pkey" TO "BillingEvent_pkey";

-- The paid-plan CHECK constraint follows the renamed column automatically.
