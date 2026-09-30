import { NextResponse } from "next/server";

import { withErrorHandling } from "@/lib/api/handle-error";
import { BadRequestError, ServiceUnavailableError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isBillingConfigured } from "@/server/billing/plan-ids";
import { InvalidWebhookError } from "@/server/billing/provider";
import { razorpayBillingProvider } from "@/server/billing/razorpay";
import { processWebhookEvent } from "@/server/billing/sync";

/**
 * POST /api/billing/webhook
 * Razorpay webhook endpoint. Public, authenticated by the X-Razorpay-Signature
 * header (HMAC over the raw body with RAZORPAY_WEBHOOK_SECRET): unsigned or
 * tampered requests get 400 and change nothing. Verified events are applied
 * once (x-razorpay-event-id; redeliveries are acknowledged without effect).
 * Transient failures return 500 so Razorpay retries.
 */
export const POST = withErrorHandling(async (request: Request) => {
  if (!isBillingConfigured()) throw new ServiceUnavailableError("Billing is not configured");
  // The signature covers the exact bytes: read the raw body, never re-serialized JSON.
  const payload = await request.text();
  let event;
  try {
    event = razorpayBillingProvider.verifyWebhook(
      payload,
      request.headers.get("x-razorpay-signature"),
      request.headers.get("x-razorpay-event-id"),
    );
  } catch (error) {
    if (error instanceof InvalidWebhookError) {
      logger.warn("Billing webhook rejected", { reason: error.message });
      throw new BadRequestError("Invalid signature");
    }
    throw error;
  }
  const outcome = await processWebhookEvent(event, razorpayBillingProvider);
  logger.info("Billing webhook processed", { eventId: event.id, type: event.type, outcome });
  return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
});
