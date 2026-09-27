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
import { EDITABLE_PROJECT_STATUSES, PROJECT_PRIORITIES } from "@/lib/validation/project";

import { PROJECT_PRIORITY_LABELS, PROJECT_STATUS_LABELS } from "./project-labels";

export type ProjectFormValues = {
  id?: string;
  name: string;
  description: string | null;
  clientId: string | null;
  status: (typeof EDITABLE_PROJECT_STATUSES)[number];
  priority: (typeof PROJECT_PRIORITIES)[number];
  /** `YYYY-MM-DD` or "" */
  startDate: string;
  dueDate: string;
  progress: number;
};

type ProjectFormAction = (
  organizationSlug: string,
  input: Record<string, FormDataEntryValue>,
) => Promise<ActionResult<unknown> | undefined | void>;

/** Create and edit form. The server re-validates everything, including the client. */
export function ProjectForm({
  organizationSlug,
  action,
  clients,
  initial,
  submitLabel,
}: {
  organizationSlug: string;
  action: ProjectFormAction;
  clients: { id: string; name: string }[];
  initial?: ProjectFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionForm((input) =>
    action(organizationSlug, initial?.id ? { ...input, id: initial.id } : input),
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormError state={state} />
      <Field
        label="Project name"
        name="name"
        required
        maxLength={120}
        autoComplete="off"
        defaultValue={initial?.name}
        state={state}
      />
      <SelectField
        label="Client"
        name="clientId"
        defaultValue={initial?.clientId ?? ""}
        state={state}
      >
        <option value="">No client</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </SelectField>
      <TextareaField
        label="Description"
        name="description"
        rows={4}
        maxLength={5000}
        defaultValue={initial?.description ?? ""}
        state={state}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label="Status"
          name="status"
          defaultValue={initial?.status ?? "PLANNING"}
          state={state}
        >
          {EDITABLE_PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Priority"
          name="priority"
          defaultValue={initial?.priority ?? "MEDIUM"}
          state={state}
        >
          {PROJECT_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PROJECT_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Start date"
          name="startDate"
          type="date"
          defaultValue={initial?.startDate ?? ""}
          state={state}
        />
        <Field
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={initial?.dueDate ?? ""}
          state={state}
        />
        <Field
          label="Progress (%)"
          name="progress"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          defaultValue={initial?.progress ?? 0}
          state={state}
        />
      </div>
      <div className="sm:w-48">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
