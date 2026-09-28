"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { toActionError } from "@/lib/api/handle-error";
import { type ActionResult } from "@/lib/errors";
import { callAuthEndpoint } from "@/server/auth/endpoint";
import { fromAuthError } from "@/server/auth/errors";

/*
 * Authentication Server Actions. Each validates its input, calls the Better
 * Auth endpoint through its HTTP handler (callAuthEndpoint: rate limiting,
 * origin check and disabled paths apply exactly as for /api/auth/*; cookies
 * are copied to the response), and returns an ActionResult on failure or
 * redirects on success. Responses never reveal whether an email address is
 * registered.
 */

const email = z.email("Enter a valid email address").trim().toLowerCase();
const newPassword = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters");

async function run(operation: () => Promise<unknown>): Promise<ActionResult<never> | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(fromAuthError(error));
  }
}

function verifyEmailPath(address: string) {
  return `/verify-email?email=${encodeURIComponent(address)}`;
}

const signUpInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email,
  password: newPassword,
});

export async function signUpAction(input: unknown) {
  let address = "";
  const failure = await run(async () => {
    const body = signUpInput.parse(input);
    address = body.email;
    await callAuthEndpoint("/sign-up/email", body);
  });
  if (failure) return failure;
  // Same destination whether or not the address was already registered.
  redirect(verifyEmailPath(address));
}

const signInInput = z.object({ email, password: z.string().min(1, "Enter your password") });

export async function signInAction(input: unknown) {
  const failure = await run(async () => {
    const body = signInInput.parse(input);
    await callAuthEndpoint("/sign-in/email", body);
  });
  if (failure) return failure;
  redirect("/");
}

const verifyEmailInput = z.object({
  email,
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export async function verifyEmailAction(input: unknown) {
  const failure = await run(async () => {
    const body = verifyEmailInput.parse(input);
    // Signs the user in on success (autoSignInAfterVerification).
    await callAuthEndpoint("/email-otp/verify-email", body);
  });
  if (failure) return failure;
  redirect("/");
}

export async function resendVerificationCodeAction(input: unknown) {
  return (
    (await run(async () => {
      const body = z.object({ email }).parse(input);
      await callAuthEndpoint("/email-otp/send-verification-otp", {
        email: body.email,
        type: "email-verification",
      });
    })) ?? ({ ok: true, data: undefined } as const)
  );
}

export async function requestPasswordResetAction(input: unknown) {
  return (
    (await run(async () => {
      const body = z.object({ email }).parse(input);
      await callAuthEndpoint("/request-password-reset", {
        email: body.email,
        redirectTo: "/reset-password",
      });
    })) ?? ({ ok: true, data: undefined } as const)
  );
}

const resetPasswordInput = z.object({ token: z.string().min(1), newPassword });

export async function resetPasswordAction(input: unknown) {
  const failure = await run(async () => {
    const body = resetPasswordInput.parse(input);
    // Also signs out every existing session (revokeSessionsOnPasswordReset).
    await callAuthEndpoint("/reset-password", body);
  });
  if (failure) return failure;
  redirect("/sign-in?reset=1");
}

export async function signInWithGoogleAction() {
  let url: string | undefined;
  const failure = await run(async () => {
    const result = await callAuthEndpoint<{ url?: string }>("/sign-in/social", {
      provider: "google",
      callbackURL: "/",
    });
    url = result?.url;
  });
  if (failure) return failure;
  if (!url) return toActionError(new Error("Google sign-in did not return a redirect URL"));
  redirect(url);
}

export async function signOutAction() {
  await run(async () => {
    await callAuthEndpoint("/sign-out", {});
  });
  redirect("/sign-in");
}
