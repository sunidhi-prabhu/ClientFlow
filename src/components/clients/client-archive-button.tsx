"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { type ActionResult } from "@/lib/errors";

type ArchiveAction = (
  organizationSlug: string,
  input: { id: string },
) => Promise<ActionResult<unknown>>;

/**
 * Archive (two-step confirm) or restore a client, then refresh the page's
 * server data.
 */
export function ClientArchiveButton({
  organizationSlug,
  clientId,
  archived,
  archiveAction,
  restoreAction,
}: {
  organizationSlug: string;
  clientId: string;
  archived: boolean;
  archiveAction: ArchiveAction;
  restoreAction: ArchiveAction;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: ArchiveAction) {
    setError(null);
    startTransition(async () => {
      const result = await action(organizationSlug, { id: clientId });
      if (result.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {archived ? (
        <Button variant="outline" disabled={pending} onClick={() => run(restoreAction)}>
          <ArchiveRestore aria-hidden />
          Restore
        </Button>
      ) : confirming ? (
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => run(archiveAction)}>
            {pending ? "Archiving…" : "Confirm archive"}
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <Archive aria-hidden />
          Archive
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
