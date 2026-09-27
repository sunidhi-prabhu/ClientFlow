"use client";

import { useActionState } from "react";

import { FormError, type FormState } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";

import { signInWithGoogleAction } from "./actions";

export function GoogleButton() {
  const [state, formAction, pending] = useActionState<FormState>(
    async () => (await signInWithGoogleAction()) ?? null,
    null,
  );
  return (
    <form action={formAction} className="grid gap-3">
      <FormError state={state} />
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        Continue with Google
      </Button>
    </form>
  );
}

export function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground uppercase">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
