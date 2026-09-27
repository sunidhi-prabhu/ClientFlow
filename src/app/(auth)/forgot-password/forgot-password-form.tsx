"use client";

import { Field, FormError, SubmitButton, useActionForm } from "@/components/forms/action-form";

import { requestPasswordResetAction } from "../actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionForm(requestPasswordResetAction);

  if (state?.ok) {
    // Identical for registered and unregistered addresses.
    return (
      <p className="rounded-lg bg-muted px-3 py-2 text-sm">
        If an account exists for that address, we&apos;ve emailed a link to reset the password. The
        link is valid for 1 hour.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <FormError state={state} />
      <Field label="Email" name="email" type="email" autoComplete="email" required state={state} />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
