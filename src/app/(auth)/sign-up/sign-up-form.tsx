"use client";

import { Field, FormError, SubmitButton, useActionForm } from "@/components/forms/action-form";

import { signUpAction } from "../actions";

export function SignUpForm() {
  const [state, formAction, pending] = useActionForm(signUpAction);
  return (
    <form action={formAction} className="grid gap-4">
      <FormError state={state} />
      <Field label="Name" name="name" autoComplete="name" required state={state} />
      <Field label="Email" name="email" type="email" autoComplete="email" required state={state} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        state={state}
        hint="At least 10 characters."
      />
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}
