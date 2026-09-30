"use client";

import { ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { type ActionResult } from "@/lib/errors";

type NoInputAction = (organizationSlug: string, input: object) => Promise<ActionResult<unknown>>;

/** "Manage payment details" (Stripe portal) and "Keep my plan" (undo a scheduled cancellation). */
export function SubscriptionActions({
  organizationSlug,
  showPortal,
  showResume,
  portalAction,
  resumeAction,
}: {
  organizationSlug: string;
  showPortal: boolean;
  showResume: boolean;
  portalAction: NoInputAction;
  resumeAction: NoInputAction;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: "portal" | "resume") {
    setError(null);
    startTransition(async () => {
      const result = await (kind === "portal" ? portalAction : resumeAction)(organizationSlug, {});
      if (!result.ok) return setError(result.error.message);
      if (kind === "portal") window.location.assign((result.data as { url: string }).url);
      else router.refresh();
    });
  }

  if (!showPortal && !showResume) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {showResume && (
          <Button disabled={pending} onClick={() => run("resume")}>
            Keep my plan
          </Button>
        )}
        {showPortal && (
          <Button variant="outline" disabled={pending} onClick={() => run("portal")}>
            Payment details and invoices
            <ExternalLink aria-hidden />
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
