import { type EmailMessage } from "@/server/email/mailer";

/** Emails "sent" during the current test (see setup.ts). */
export const outbox: EmailMessage[] = [];

export function emailsTo(address: string, type?: string): EmailMessage[] {
  return outbox.filter(
    (message) => message.to === address.toLowerCase() && (!type || message.type === type),
  );
}

/** The 6-digit code from the latest verification email to `address`. */
export function latestVerificationCode(address: string): string {
  const message = emailsTo(address, "verification-code").at(-1);
  const code = message?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No verification code emailed to ${address}`);
  return code;
}

/** The token from the latest password-reset link emailed to `address`. */
export function latestResetToken(address: string): string {
  const message = emailsTo(address, "password-reset").at(-1);
  const token = message?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
  if (!token) throw new Error(`No password reset link emailed to ${address}`);
  return token;
}
