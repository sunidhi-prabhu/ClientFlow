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
import { SUPPORTED_CURRENCIES } from "@/lib/money";

export type InvoiceFormValues = {
  id?: string;
  clientId: string;
  currency: string;
  /** `YYYY-MM-DD` or "" */
  dueDate: string;
  notes: string | null;
  /** Percentages as typed, e.g. "18.25" */
  discountPercent: string;
  taxPercent: string;
};

type InvoiceFormAction = (
  organizationSlug: string,
  input: Record<string, FormDataEntryValue>,
) => Promise<ActionResult<unknown> | undefined | void>;

/** Draft invoice header (client, due date, currency, rates, notes). Totals are computed on the server. */
export function InvoiceForm({
  organizationSlug,
  action,
  clients,
  initial,
  submitLabel,
}: {
  organizationSlug: string;
  action: InvoiceFormAction;
  clients: { id: string; name: string }[];
  initial?: InvoiceFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionForm((input) =>
    action(organizationSlug, initial?.id ? { ...input, id: initial.id } : input),
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormError state={state} />
      <SelectField
        label="Client"
        name="clientId"
        defaultValue={initial?.clientId ?? ""}
        state={state}
      >
        <option value="" disabled>
          Choose a client…
        </option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={initial?.dueDate ?? ""}
          state={state}
          hint="Required to issue the invoice."
        />
        <SelectField
          label="Currency"
          name="currency"
          defaultValue={initial?.currency ?? "USD"}
          state={state}
        >
          {SUPPORTED_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </SelectField>
        <Field
          label="Discount (%)"
          name="discountPercent"
          inputMode="decimal"
          defaultValue={initial?.discountPercent ?? "0"}
          state={state}
          hint="Applied to the subtotal."
        />
        <Field
          label="Tax (%)"
          name="taxPercent"
          inputMode="decimal"
          defaultValue={initial?.taxPercent ?? "0"}
          state={state}
          hint="Applied after the discount."
        />
      </div>
      <TextareaField
        label="Notes"
        name="notes"
        rows={3}
        maxLength={5000}
        defaultValue={initial?.notes ?? ""}
        state={state}
        hint="Shown on the invoice (e.g. payment instructions)."
      />
      <div className="sm:w-48">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
