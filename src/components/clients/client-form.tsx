"use client";

import {
  Field,
  FormError,
  SelectField,
  SubmitButton,
  TextareaField,
  useActionForm,
} from "@/components/forms/action-form";
import { type ActionResult } from "@/lib/errors";

import { CLIENT_STATUS_LABELS } from "./client-status-badge";

export type ClientFormValues = {
  id?: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  status: "ACTIVE" | "INACTIVE";
};

type ClientFormAction = (
  organizationSlug: string,
  input: Record<string, FormDataEntryValue>,
) => Promise<ActionResult<unknown> | undefined | void>;

/** Create and edit form. Validation is authoritative on the server; errors show per field. */
export function ClientForm({
  organizationSlug,
  action,
  initial,
  submitLabel,
}: {
  organizationSlug: string;
  action: ClientFormAction;
  initial?: ClientFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionForm((input) =>
    action(organizationSlug, initial?.id ? { ...input, id: initial.id } : input),
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormError state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Name"
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={initial?.name}
          state={state}
        />
        <Field
          label="Company"
          name="company"
          maxLength={120}
          autoComplete="organization"
          defaultValue={initial?.company ?? ""}
          state={state}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          maxLength={254}
          autoComplete="email"
          defaultValue={initial?.email ?? ""}
          state={state}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          maxLength={40}
          autoComplete="tel"
          defaultValue={initial?.phone ?? ""}
          state={state}
        />
      </div>
      <TextareaField
        label="Address"
        name="address"
        rows={3}
        maxLength={500}
        autoComplete="street-address"
        defaultValue={initial?.address ?? ""}
        state={state}
      />
      <TextareaField
        label="Notes"
        name="notes"
        rows={5}
        maxLength={5000}
        defaultValue={initial?.notes ?? ""}
        state={state}
        hint="Visible to everyone in your organization."
      />
      <SelectField
        label="Status"
        name="status"
        defaultValue={initial?.status ?? "ACTIVE"}
        state={state}
        className="sm:w-48"
      >
        <option value="ACTIVE">{CLIENT_STATUS_LABELS.ACTIVE}</option>
        <option value="INACTIVE">{CLIENT_STATUS_LABELS.INACTIVE}</option>
      </SelectField>
      <div className="sm:w-48">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
