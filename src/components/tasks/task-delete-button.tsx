"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { type ActionResult } from "@/lib/errors";

type DeleteAction = (
  organizationSlug: string,
  input: { id: string },
) => Promise<ActionResult<unknown> | undefined | void>;

/** Two-step delete. On success the action redirects back to the project. */
export function TaskDeleteButton({
  organizationSlug,
  taskId,
  action,
}: {
  organizationSlug: string;
  taskId: string;
  action: DeleteAction;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await action(organizationSlug, { id: taskId });
                if (result && !result.ok) setError(result.error.message);
              })
            }
          >
            {pending ? "Deleting…" : "Confirm delete"}
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden />
          Delete
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
