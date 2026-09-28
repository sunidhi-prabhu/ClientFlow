import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import { getEmailEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

export type EmailMessage = {
  /** Category for logs only, e.g. "verification-code". Never the content. */
  type: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

let transporter: Transporter | undefined;

/**
 * Nodemailer waits up to 2 minutes to connect and 10 minutes on an idle
 * socket. A stalled provider would keep every deferred send (and the
 * serverless invocation running it) alive that long; fail fast instead and
 * let the failure be logged. Values already in SMTP_URL take precedence.
 */
const SMTP_TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

export function smtpTransportUrl(smtpUrl: string): string {
  const url = new URL(smtpUrl);
  for (const [key, value] of Object.entries(SMTP_TIMEOUTS)) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function getTransporter() {
  transporter ??= nodemailer.createTransport(smtpTransportUrl(getEmailEnv().SMTP_URL));
  return transporter;
}

/**
 * Send one email over SMTP. Message bodies contain secrets (codes, reset
 * links), so only the message type is ever logged.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  await getTransporter().sendMail({
    from: getEmailEnv().EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  logger.info("Email sent", { type: message.type });
}
