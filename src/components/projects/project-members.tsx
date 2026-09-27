"use client";

import { UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { type ActionResult } from "@/lib/errors";

type MemberAction = (
  organizationSlug: string,
  input: { projectId: string; userId: string },
) => Promise<ActionResult<unknown>>;

export type ProjectMemberItem = { userId: string; name: string; email: string; role: string };

/** The project's team, with add/remove controls for roles that may manage it. */
export function ProjectMembers({
  organizationSlug,
  projectId,
  members,
  addable,
  canManage,
  addAction,
  removeAction,
}: {
  organizationSlug: string;
  projectId: string;
  members: ProjectMemberItem[];
  addable: { userId: string; name: string; email: string }[];
  canManage: boolean;
  addAction: MemberAction;
  removeAction: MemberAction;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: MemberAction, userId: string) {
    setError(null);
    startTransition(async () => {
      const result = await action(organizationSlug, { projectId, userId });
      if (result.ok) {
        setSelected("");
        router.refresh();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="grid gap-4">
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one has been added to this project yet.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Project members">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email} · {member.role.toLowerCase()}
                </p>
              </div>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={`Remove ${member.name}`}
                  onClick={() => run(removeAction, member.userId)}
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && addable.length > 0 && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected) run(addAction, selected);
          }}
        >
          <NativeSelect
            aria-label="Person to add"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="flex-1"
          >
            <option value="">Add a person…</option>
            {addable.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name} ({person.email})
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline" disabled={!selected || pending}>
            <UserPlus aria-hidden />
            Add
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
