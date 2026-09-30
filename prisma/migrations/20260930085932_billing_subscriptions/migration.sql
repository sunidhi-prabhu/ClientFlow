-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'AGENCY');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'PAUSED');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus",
    "interval" "BillingInterval",
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_id_key" ON "Subscription"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A paid plan is only ever recorded together with the Stripe subscription that
-- pays for it (written from verified Stripe data). Defense in depth: no code
-- path can grant a plan without one.
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paid_plan_has_subscription_check"
  CHECK ("plan" = 'FREE' OR "stripeSubscriptionId" IS NOT NULL);

-- Billing events are audited under their own resource type.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_resourceType_check";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_resourceType_check" CHECK (
  "resourceType" IN ('user', 'organization', 'membership', 'client', 'project', 'task', 'invoice', 'billing')
);
