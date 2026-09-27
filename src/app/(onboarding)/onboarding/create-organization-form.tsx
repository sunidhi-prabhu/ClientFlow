"use client";

import { Field, FormError, SubmitButton, useActionForm } from "@/components/forms/action-form";

import { createOrganizationAction } from "./actions";

export function CreateOrganizationForm() {
  const [state, formAction, pending] = useActionForm(createOrganizationAction);
  return (
    <form action={formAction} className="grid gap-4">
      <FormError state={state} />
      <Field label="Organization name" name="name" required maxLength={80} state={state} />
      <Field
        label="URL (optional)"
        name="slug"
        maxLength={48}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        state={state}
        hint="Lowercase letters, numbers and hyphens. Generated from the name if left empty."
      />
      <SubmitButton pending={pending}>Create organization</SubmitButton>
    </form>
  );
}
