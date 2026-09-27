"use client";

import { type ReactNode, useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { type ActionResult } from "@/lib/errors";

type Result = ActionResult<unknown> | undefined | void;
export type FormState = ActionResult<unknown> | null;

/** Wrap a Server Action taking a plain object for use with a <form>. */
export function useActionForm(
  action: (input: Record<string, FormDataEntryValue>) => Promise<Result>,
) {
  return useActionState<FormState, FormData>(
    async (_previous, formData) => (await action(Object.fromEntries(formData))) ?? null,
    null,
  );
}

/** Message for one field from a VALIDATION_ERROR result, if any. */
export function fieldError(state: FormState, field: string): string | undefined {
  if (!state || state.ok || !Array.isArray(state.error.details)) return undefined;
  const issue = (state.error.details as { path?: string; message?: string }[]).find(
    (detail) => detail.path === field,
  );
  return issue?.message;
}

/** Form-level error (everything except per-field validation messages). */
export function FormError({ state }: { state: FormState }) {
  if (!state || state.ok) return null;
  if (state.error.code === "VALIDATION_ERROR" && Array.isArray(state.error.details)) return null;
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {state.error.message}
    </p>
  );
}

export function Field({
  label,
  name,
  state,
  hint,
  ...props
}: React.ComponentProps<"input"> & {
  label: string;
  name: string;
  state: FormState;
  hint?: ReactNode;
}) {
  const error = fieldError(state, name);
  const id = `field-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** Label, control, and error/hint wiring shared by the field components. */
function FieldShell({
  label,
  name,
  state,
  hint,
  children,
}: {
  label: string;
  name: string;
  state: FormState;
  hint?: ReactNode;
  children: (props: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const error = fieldError(state, name);
  const id = `field-${name}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? `${id}-error` : undefined,
      })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function TextareaField({
  label,
  name,
  state,
  hint,
  ...props
}: React.ComponentProps<"textarea"> & {
  label: string;
  name: string;
  state: FormState;
  hint?: ReactNode;
}) {
  return (
    <FieldShell label={label} name={name} state={state} hint={hint}>
      {(control) => <Textarea name={name} {...control} {...props} />}
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  state,
  hint,
  ...props
}: React.ComponentProps<"select"> & {
  label: string;
  name: string;
  state: FormState;
  hint?: ReactNode;
}) {
  return (
    <FieldShell label={label} name={name} state={state} hint={hint}>
      {(control) => <NativeSelect name={name} {...control} {...props} />}
    </FieldShell>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Please wait…" : children}
    </Button>
  );
}
