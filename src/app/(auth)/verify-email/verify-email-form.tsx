"use client";

import { useActionState, useEffect, useRef } from "react";

import {
  Field,
  FormError,
  type FormState,
  SubmitButton,
  useActionForm,
} from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";

import { resendVerificationCodeAction, verifyEmailAction } from "../actions";

export function VerifyEmailForm({ email, resend }: { email: string; resend: boolean }) {
  const [state, formAction, pending] = useActionForm(verifyEmailAction);
  const [resendState, resendAction, resending] = useActionState<FormState>(
    async () => resendVerificationCodeAction({ email }),
    null,
  );

  // Arriving from a sign-in attempt on an unverified account: send a fresh code once.
  const sent = useRef(false);
  const resendForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resend && !sent.current) {
      sent.current = true;
      resendForm.current?.requestSubmit();
    }
  }, [resend]);

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4">
        <FormError state={state} />
        <input type="hidden" name="email" value={email} />
        <Field
          label="Verification code"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          state={state}
          className="text-center text-lg tracking-[0.5em]"
        />
        <SubmitButton pending={pending}>Verify email</SubmitButton>
      </form>
      <form ref={resendForm} action={resendAction} className="text-center">
        <Button type="submit" variant="ghost" size="sm" disabled={resending}>
          {resending ? "Sending…" : "Send a new code"}
        </Button>
        {resendState?.ok && (
          <p className="text-sm text-muted-foreground">
            If this address needs verifying, a new code is on its way.
          </p>
        )}
        <FormError state={resendState} />
      </form>
    </div>
  );
}
