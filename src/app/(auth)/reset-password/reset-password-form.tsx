"use client";

import { Field, FormError, SubmitButton, useActionForm } from "@/components/forms/action-form";

import { resetPasswordAction } from "../actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionForm(resetPasswordAction);
  return (
    <form action={formAction} className="grid gap-4">
      <FormError state={state} />
      <input type="hidden" name="token" value={token} />
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        state={state}
        hint="At least 10 characters. You'll be signed out everywhere."
      />
      <SubmitButton pending={pending}>Set new password</SubmitButton>
    </form>
  );
}
