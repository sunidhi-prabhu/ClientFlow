"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Field, FormError, SubmitButton, useActionForm } from "@/components/forms/action-form";

import { signInAction } from "../actions";

export function SignInForm() {
  const router = useRouter();
  const email = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionForm(signInAction);

  // Unverified accounts continue on the verification page.
  const needsVerification =
    state &&
    !state.ok &&
    (state.error.details as { reason?: string })?.reason === "EMAIL_NOT_VERIFIED";
  useEffect(() => {
    if (needsVerification && email.current) {
      router.push(`/verify-email?email=${encodeURIComponent(email.current.value)}&resend=1`);
    }
  }, [needsVerification, router]);

  return (
    <form action={formAction} className="grid gap-4">
      <FormError state={state} />
      <Field
        ref={email}
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        state={state}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        state={state}
      />
      <div className="-mt-2 text-right text-sm">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
          Forgot password?
        </Link>
      </div>
      <SubmitButton pending={pending}>Sign in</SubmitButton>
    </form>
  );
}
