import { NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/api/handle-error";
import { BadRequestError, ServiceUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isBillingConfigured } from "@/server/billing/prices";
import { InvalidWebhookError } from "@/server/billing/provider";
import { stripeBillingProvider } from "@/server/billing/stripe";
import { processWebhookEvent } from "@/server/billing/sync";

/**
 * POST /api/billing/webhook
 * Stripe webhook endpoint. Public, authenticated by the Stripe-Signature
 * header (HMAC over the raw body with STRIPE_WEBHOOK_SECRET): unsigned or
 * tampered requests get 400 and change nothing. Verified events are applied
 * once (redeliveries are acknowledged without effect). Transient failures
 * return 500 so Stripe retries.
 */
export const POST = withErrorHandling(async (request: Request) => {
  if (!isBillingConfigured()) throw new ServiceUnavailableError("Billing is not configured");
  // The signature covers the exact bytes: read the raw body, never re-serialized JSON.
  const payload = await request.text();
  let event;
  try {
    event = stripeBillingProvider.verifyWebhook(payload, request.headers.get("stripe-signature"));
  } catch (error) {
    if (error instanceof InvalidWebhookError) {
      logger.warn("Stripe webhook rejected", { reason: error.message });
      throw new BadRequestError("Invalid signature");
    }
    throw error;
  }
  const outcome = await processWebhookEvent(event, stripeBillingProvider);
  logger.info("Stripe webhook processed", { eventId: event.id, type: event.type, outcome });
  return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
});
