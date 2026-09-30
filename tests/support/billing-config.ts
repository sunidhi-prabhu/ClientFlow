/** Razorpay test-mode configuration for tests (fake ids: nothing here reaches Razorpay). */
export const TEST_BILLING_ENV = {
  RAZORPAY_KEY_ID: "rzp_test_clientflowtests",
  RAZORPAY_KEY_SECRET: "clientflow-test-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "clientflow-test-webhook-secret",
  RAZORPAY_PLAN_STARTER_MONTHLY: "plan_startermonthly",
  RAZORPAY_PLAN_STARTER_ANNUAL: "plan_starterannual",
  RAZORPAY_PLAN_GROWTH_MONTHLY: "plan_growthmonthly",
  RAZORPAY_PLAN_GROWTH_ANNUAL: "plan_growthannual",
  RAZORPAY_PLAN_PROFESSIONAL_MONTHLY: "plan_professionalmonthly",
  RAZORPAY_PLAN_PROFESSIONAL_ANNUAL: "plan_professionalannual",
  RAZORPAY_PLAN_AGENCY_MONTHLY: "plan_agencymonthly",
  RAZORPAY_PLAN_AGENCY_ANNUAL: "plan_agencyannual",
} as const;
