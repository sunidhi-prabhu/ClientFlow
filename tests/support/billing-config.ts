/** Stripe test-mode configuration for tests (fake ids: nothing here reaches Stripe). */
export const TEST_BILLING_ENV = {
  STRIPE_SECRET_KEY: "sk_test_clientflowtests",
  STRIPE_WEBHOOK_SECRET: "whsec_clientflowtests",
  STRIPE_PRICE_STARTER_MONTHLY: "price_startermonthly",
  STRIPE_PRICE_STARTER_ANNUAL: "price_starterannual",
  STRIPE_PRICE_GROWTH_MONTHLY: "price_growthmonthly",
  STRIPE_PRICE_GROWTH_ANNUAL: "price_growthannual",
  STRIPE_PRICE_PROFESSIONAL_MONTHLY: "price_professionalmonthly",
  STRIPE_PRICE_PROFESSIONAL_ANNUAL: "price_professionalannual",
  STRIPE_PRICE_AGENCY_MONTHLY: "price_agencymonthly",
  STRIPE_PRICE_AGENCY_ANNUAL: "price_agencyannual",
} as const;
