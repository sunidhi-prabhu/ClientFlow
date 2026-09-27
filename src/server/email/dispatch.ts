import "server-only";

import { after } from "next/server";

import { logger } from "@/lib/logger";
import { type EmailMessage, sendEmail } from "@/server/email/mailer";

/**
 * Send an email without delaying the HTTP response. Response timing then
 * does not reveal whether an email was sent (e.g. whether an address is
 * registered), and SMTP latency never blocks sign-up or reset requests.
 * Uses Next.js `after()` so the send completes on serverless platforms.
 */
export function dispatchEmail(message: EmailMessage): void {
  const sending = sendEmail(message).catch((error: unknown) => {
    logger.error("Email delivery failed", { type: message.type, error });
  });
  try {
    after(sending);
  } catch {
    // Outside a Next.js request scope (scripts, tests): the promise above
    // already runs and handles its own errors.
  }
}
