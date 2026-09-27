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

function getTransporter() {
  transporter ??= nodemailer.createTransport(getEmailEnv().SMTP_URL);
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
