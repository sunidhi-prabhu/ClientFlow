"use client";

import { Ban, CheckCircle2, Printer, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { type ActionResult } from "@/lib/errors";

type StateAction = (
  organizationSlug: string,
  input: { id: string },
) => Promise<ActionResult<unknown>>;

type Kind = "issue" | "pay" | "cancel";

const COPY: Record<
  Kind,
  {
    label: string;
    confirm: string;
    icon: typeof Send;
    variant: "default" | "outline" | "destructive";
  }
> = {
  issue: {
    label: "Issue invoice",
    confirm: "Issue now (locks the invoice)",
    icon: Send,
    variant: "default",
  },
  pay: {
    label: "Mark as paid",
    confirm: "Confirm payment received",
    icon: CheckCircle2,
    variant: "default",
  },
  cancel: {
    label: "Cancel invoice",
    confirm: "Confirm cancellation",
    icon: Ban,
    variant: "destructive",
  },
};

/**
 * Issue / mark paid / cancel with a confirmation step. Which buttons appear is
 * decided on the server (state + permissions); the server re-checks both.
 */
export function InvoiceActions({
  organizationSlug,
  invoiceId,
  allowed,
  actions,
}: {
  organizationSlug: string;
  invoiceId: string;
  allowed: Record<Kind, boolean>;
  actions: Record<Kind, StateAction>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const triggers = useRef(new Map<Kind, HTMLButtonElement>());
  const confirm = useRef<HTMLButtonElement>(null);
  const lastConfirmed = useRef<Kind | null>(null);

  // Keyboard focus follows the confirmation step: to the confirm button when
  // it appears, back to the action that opened it when the user steps back.
  useEffect(() => {
    if (confirming) {
      lastConfirmed.current = confirming;
      confirm.current?.focus();
    } else if (lastConfirmed.current) {
      triggers.current.get(lastConfirmed.current)?.focus();
      lastConfirmed.current = null;
    }
  }, [confirming]);

  function run(kind: Kind) {
    setError(null);
    startTransition(async () => {
      const result = await actions[kind](organizationSlug, { id: invoiceId });
      setConfirming(null);
      if (result.ok) router.refresh();
      else {
        const details = Array.isArray(result.error.details)
          ? (result.error.details as { message?: string }[])
              .map((detail) => detail.message)
              .filter(Boolean)
          : [];
        setError(
          details.length > 0
            ? `${result.error.message}: ${details.join(" · ")}`
            : result.error.message,
        );
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end print:hidden">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {confirming ? (
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirming(null)}>
              Back
            </Button>
            <Button
              ref={confirm}
              variant={COPY[confirming].variant}
              disabled={pending}
              onClick={() => run(confirming)}
            >
              {pending ? "Working…" : COPY[confirming].confirm}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden />
              Print
            </Button>
            {(Object.keys(COPY) as Kind[])
              .filter((kind) => allowed[kind])
              .map((kind) => {
                const Icon = COPY[kind].icon;
                return (
                  <Button
                    key={kind}
                    ref={(element) => {
                      if (element) triggers.current.set(kind, element);
                      else triggers.current.delete(kind);
                    }}
                    variant={kind === "cancel" ? "outline" : COPY[kind].variant}
                    onClick={() => setConfirming(kind)}
                  >
                    <Icon aria-hidden />
                    {COPY[kind].label}
                  </Button>
                );
              })}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="max-w-md text-sm text-destructive sm:text-right">
          {error}
        </p>
      )}
    </div>
  );
}
