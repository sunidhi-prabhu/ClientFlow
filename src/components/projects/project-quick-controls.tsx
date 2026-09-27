"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionResult } from "@/lib/errors";
import { EDITABLE_PROJECT_STATUSES } from "@/lib/validation/project";

import { PROJECT_STATUS_LABELS } from "./project-labels";

type EditableStatus = (typeof EDITABLE_PROJECT_STATUSES)[number];

type StatusAction = (
  organizationSlug: string,
  input: { id: string; status: EditableStatus },
) => Promise<ActionResult<unknown>>;
type ProgressAction = (
  organizationSlug: string,
  input: { id: string; progress: number },
) => Promise<ActionResult<unknown>>;

/** Change the status and progress from the details page, without opening the edit form. */
export function ProjectQuickControls({
  organizationSlug,
  projectId,
  status,
  progress,
  statusAction,
  progressAction,
}: {
  organizationSlug: string;
  projectId: string;
  status: EditableStatus;
  progress: number;
  statusAction: StatusAction;
  progressAction: ProgressAction;
}) {
  const router = useRouter();
  const [draftProgress, setDraftProgress] = useState(progress);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(call: () => Promise<ActionResult<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) router.refresh();
      else setError(result.error.message);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="project-status">Status</Label>
        <NativeSelect
          id="project-status"
          value={status}
          disabled={pending}
          onChange={(event) =>
            run(() =>
              statusAction(organizationSlug, {
                id: projectId,
                status: event.target.value as EditableStatus,
              }),
            )
          }
        >
          {EDITABLE_PROJECT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PROJECT_STATUS_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <form
        className="grid gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => progressAction(organizationSlug, { id: projectId, progress: draftProgress }));
        }}
      >
        <Label htmlFor="project-progress">Progress: {draftProgress}%</Label>
        <div className="flex items-center gap-3">
          <input
            id="project-progress"
            type="range"
            min={0}
            max={100}
            step={5}
            value={draftProgress}
            onChange={(event) => setDraftProgress(Number(event.target.value))}
            className="flex-1 accent-primary"
          />
          <Button type="submit" size="sm" disabled={pending || draftProgress === progress}>
            Save
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
