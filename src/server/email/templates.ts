import { type EmailMessage } from "@/server/email/mailer";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function layout(body: string) {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#171717">${body}<p style="color:#737373;font-size:13px">ClientFlow</p></div>`;
}

export function verificationCodeEmail(to: string, code: string): EmailMessage {
  return {
    type: "verification-code",
    to,
    subject: "Your ClientFlow verification code",
    text: `Your verification code is ${code}. It expires in 10 minutes and can be used once.\n\nIf you did not request this, you can ignore this email.`,
    html: layout(
      `<p>Your verification code is</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${escapeHtml(code)}</p><p>It expires in 10 minutes and can be used once. If you did not request this, you can ignore this email.</p>`,
    ),
  };
}

export function passwordResetEmail(to: string, url: string): EmailMessage {
  return {
    type: "password-reset",
    to,
    subject: "Reset your ClientFlow password",
    text: `Reset your password using this link (valid for 1 hour, single use):\n${url}\n\nIf you did not request a reset, you can ignore this email.`,
    html: layout(
      `<p>Reset your password using the link below. It is valid for 1 hour and can be used once.</p><p><a href="${escapeHtml(url)}">Reset password</a></p><p>If you did not request a reset, you can ignore this email.</p>`,
    ),
  };
}

/** Sent instead of a second account when someone signs up with a registered email. */
export function existingAccountEmail(to: string, signInUrl: string): EmailMessage {
  return {
    type: "existing-account",
    to,
    subject: "You already have a ClientFlow account",
    text: `Someone tried to create a ClientFlow account with this email address, but you already have one.\n\nSign in: ${signInUrl}\nForgot your password? Use "Forgot password" on the sign-in page.\n\nIf this wasn't you, no action is needed.`,
    html: layout(
      `<p>Someone tried to create a ClientFlow account with this email address, but you already have one.</p><p><a href="${escapeHtml(signInUrl)}">Sign in</a>. Forgot your password? Use "Forgot password" on the sign-in page.</p><p>If this wasn't you, no action is needed.</p>`,
    ),
  };
}
