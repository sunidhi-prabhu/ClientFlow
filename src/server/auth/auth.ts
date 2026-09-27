import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";

import { getDb } from "@/lib/db";
import { getAuthEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { dispatchEmail } from "@/server/email/dispatch";
import {
  existingAccountEmail,
  passwordResetEmail,
  verificationCodeEmail,
} from "@/server/email/templates";

/** Session lifetime and sliding refresh window. */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // extend at most once a day
export const VERIFICATION_CODE_EXPIRES_IN_SECONDS = 60 * 10;
export const RESET_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

function createAuth() {
  const env = getAuthEnv();
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return betterAuth({
    appName: "ClientFlow",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Unscoped client: auth tables are global (see src/server/tenancy/models.ts).
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    telemetry: { enabled: false },
    // The email OTP plugin is used only for email verification. Its sign-in,
    // password-reset and email-change flows are not part of ClientFlow.
    // Endpoints ClientFlow does not use. See docs/architecture.md
    // ("Account-management endpoints") for the full review.
    disabledPaths: [
      // Email OTP plugin: only verification is used, not OTP sign-in/reset/email change.
      "/sign-in/email-otp",
      "/email-otp/check-verification-otp",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
      // Default link-based verification: stateless, replayable JWTs that also
      // sign the user in. Replaced by /email-otp/* (server-side, single use).
      "/verify-email",
      "/send-verification-email",
      // Unused password oracle (valid session + guessed password).
      "/verify-password",
      // Would hand Google OAuth tokens to browser JavaScript; ClientFlow does
      // not call Google APIs.
      "/get-access-token",
      "/refresh-token",
      "/account-info",
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A password change always signs out every other session (the current
        // one is replaced), regardless of what the client asks for.
        if (ctx.path === "/change-password") {
          return { context: { body: { ...ctx.body, revokeOtherSessions: true } } };
        }
      }),
    },
    logger: {
      // Better Auth logs e-mail addresses at info level; keep only warnings+.
      level: "warn",
      log: (level, message) => logger[level](`[auth] ${message}`),
    },

    emailAndPassword: {
      enabled: true,
      // Password sign-in only after the address is verified. This also makes
      // duplicate sign-ups return the same response as new ones.
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: RESET_TOKEN_EXPIRES_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        dispatchEmail(passwordResetEmail(user.email, url));
      },
      onExistingUserSignUp: async ({ user }) => {
        dispatchEmail(existingAccountEmail(user.email, `${env.BETTER_AUTH_URL}/sign-in`));
      },
    },

    emailVerification: {
      autoSignInAfterVerification: true,
    },

    socialProviders: googleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            prompt: "select_account",
          },
        }
      : {},

    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // Never attach an OAuth login to a local account whose email was not
        // verified (prevents pre-registration account takeover).
        requireLocalEmailVerified: true,
      },
    },

    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Every request validates the session in the database, so sign-out and
      // password-reset revocation take effect immediately.
      cookieCache: { enabled: false },
    },

    verification: {
      // Reset tokens and OTP identifiers are stored hashed at rest.
      storeIdentifier: "hashed",
    },

    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/email-otp/*": { window: 60, max: 5 },
        // Verifies the current password: limit guessing with a stolen session.
        "/change-password": { window: 60, max: 5 },
      },
    },

    advanced: {
      // `__Secure-` cookies with the Secure flag whenever the app is served over
      // HTTPS (env validation requires HTTPS in production, except localhost).
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
      // No `backgroundTasks` handler: Better Auth awaits its own database work
      // (e.g. storing a verification code) before responding. Only the SMTP
      // send is deferred, by dispatchEmail() via Next.js `after()`.
    },

    plugins: [
      // Replaces link-based verification (stateless JWTs) with server-stored,
      // hashed, expiring, single-use codes.
      emailOTP({
        otpLength: 6,
        expiresIn: VERIFICATION_CODE_EXPIRES_IN_SECONDS,
        allowedAttempts: 5,
        storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "email-verification") dispatchEmail(verificationCodeEmail(email, otp));
        },
      }),
      // Must be last: lets Server Actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * The Better Auth instance. Created lazily so importing auth code (e.g.
 * during `next build`) does not require secrets.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export function isGoogleSignInEnabled(): boolean {
  const env = getAuthEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
