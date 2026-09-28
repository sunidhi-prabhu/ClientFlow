"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import { PRIORITY_LABELS } from "@/components/shared/priority-indicator";
import { ListSearchInput, useListSearch } from "@/components/shared/list-search";
import { NativeSelect } from "@/components/ui/native-select";
import { TASK_PRIORITIES, UNASSIGNED_FILTER } from "@/lib/validation/task";

type Filters = { q: string; assignee: string; priority: string };

/** Board search, assignee and priority filters, kept in the URL of the project page. */
export function TaskBoardToolbar({
  q,
  assignee,
  priority,
  members,
}: Filters & { members: { userId: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const search = useListSearch(q, (value) => navigate({ q: value }));

  function navigate(next: Partial<Filters>) {
    search.cancel();
    const params = new URLSearchParams();
    const values = { q: (next.q ?? search.value).trim(), assignee, priority, ...next };
    if (values.q) params.set("q", values.q.trim());
    if (values.assignee) params.set("assignee", values.assignee);
    if (values.priority) params.set("priority", values.priority);
    const query = params.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    );
  }

  return (
    <form
      role="search"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        navigate({});
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <ListSearchInput
        label="Search tasks"
        placeholder="Search tasks"
        value={search.value}
        onChange={search.change}
        pending={pending}
      />
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <NativeSelect
          name="assignee"
          aria-label="Filter by assignee"
          value={assignee}
          onChange={(event) => navigate({ assignee: event.target.value })}
          className="sm:w-44"
        >
          <option value="">Everyone</option>
          <option value={UNASSIGNED_FILTER}>Unassigned</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="priority"
          aria-label="Filter by priority"
          value={priority}
          onChange={(event) => navigate({ priority: event.target.value })}
          className="sm:w-36"
        >
          <option value="">Any priority</option>
          {TASK_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {PRIORITY_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <button type="submit" className="sr-only">
        Search
      </button>
    </form>
  );
}
