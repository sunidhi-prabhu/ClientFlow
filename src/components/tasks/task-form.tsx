"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  Field,
  FormError,
  SelectField,
  SubmitButton,
  TextareaField,
  useActionForm,
} from "@/components/forms/action-form";
import { PRIORITY_LABELS } from "@/components/shared/priority-indicator";
import { type ActionResult } from "@/lib/errors";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/validation/task";

import { TASK_STATUS_LABELS } from "./task-labels";

export type TaskFormValues = {
  id: string;
  title: string;
  description: string | null;
  status: (typeof TASK_STATUSES)[number];
  priority: (typeof TASK_PRIORITIES)[number];
  /** `YYYY-MM-DD` or "" */
  dueDate: string;
  assigneeUserId: string | null;
};

type TaskFormAction = (
  organizationSlug: string,
  input: Record<string, FormDataEntryValue>,
) => Promise<ActionResult<unknown> | undefined | void>;

/** Edit a task. Assignees are limited to project members (and re-checked on the server). */
export function TaskForm({
  organizationSlug,
  action,
  initial,
  members,
}: {
  organizationSlug: string;
  action: TaskFormAction;
  initial: TaskFormValues;
  members: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionForm((input) =>
    action(organizationSlug, { ...input, id: initial.id }),
  );
  const saved = state?.ok === true;

  // Show the saved values (and new history) from the server.
  useEffect(() => {
    if (saved) router.refresh();
  }, [saved, router]);

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormError state={state} />
      {saved && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
          Changes saved.
        </p>
      )}
      <Field
        label="Title"
        name="title"
        required
        maxLength={200}
        autoComplete="off"
        defaultValue={initial.title}
        state={state}
      />
      <TextareaField
        label="Description"
        name="description"
        rows={6}
        maxLength={10000}
        defaultValue={initial.description ?? ""}
        state={state}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Status" name="status" defaultValue={initial.status} state={state}>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Priority" name="priority" defaultValue={initial.priority} state={state}>
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Assignee"
          name="assigneeUserId"
          defaultValue={initial.assigneeUserId ?? ""}
          state={state}
          hint={members.length === 0 ? "Add people to the project to assign tasks." : undefined}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </SelectField>
        <Field
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={initial.dueDate}
          state={state}
        />
      </div>
      <div className="sm:w-48">
        <SubmitButton pending={pending}>Save changes</SubmitButton>
      </div>
    </form>
  );
}
