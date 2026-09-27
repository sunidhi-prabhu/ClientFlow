"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ListSearchInput, useListSearch } from "@/components/shared/list-search";
import { NativeSelect } from "@/components/ui/native-select";
import { type ProjectStatus } from "@/generated/prisma/enums";
import {
  NO_CLIENT_FILTER,
  type ProjectSort,
  type ProjectStatusFilter,
} from "@/lib/validation/project";

import { PROJECT_STATUS_LABELS } from "./project-labels";
import { projectsListHref } from "./projects-url";

const SORT_LABELS: Record<ProjectSort, string> = {
  name: "Name (A–Z)",
  due: "Due date",
  priority: "Priority",
  updated: "Recently updated",
  created: "Recently added",
};

type Next = { q?: string; status?: ProjectStatusFilter; clientId?: string; sort?: ProjectSort };

/**
 * Search, status and client filters, and sort, kept in the URL. Changing
 * anything returns to page 1. Without JavaScript it is a plain GET form.
 */
export function ProjectsToolbar({
  basePath,
  q,
  status,
  clientId,
  sort,
  clients,
  statusCounts,
}: {
  basePath: string;
  q: string;
  status: ProjectStatusFilter;
  clientId: string;
  sort: ProjectSort;
  clients: { id: string; name: string }[];
  statusCounts: Record<ProjectStatus, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const search = useListSearch(q, (value) => navigate({ q: value }));

  function navigate(next: Next) {
    search.cancel();
    const href = projectsListHref(basePath, {
      q: (next.q ?? search.value).trim(),
      status: next.status ?? status,
      clientId: next.clientId ?? clientId,
      sort: next.sort ?? sort,
    });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  const current = Object.entries(statusCounts)
    .filter(([key]) => key !== "ARCHIVED")
    .reduce((sum, [, count]) => sum + count, 0);
  const statusOptions: { value: ProjectStatusFilter; label: string; count: number }[] = [
    { value: "current", label: "All except archived", count: current },
    ...(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] as const).map((value) => ({
      value,
      label: PROJECT_STATUS_LABELS[value],
      count: statusCounts[value],
    })),
    { value: "all", label: "All projects", count: current + statusCounts.ARCHIVED },
  ];

  return (
    <form
      role="search"
      action={basePath}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        navigate({});
      }}
      className="flex flex-col gap-2 lg:flex-row lg:items-center"
    >
      <ListSearchInput
        label="Search projects"
        placeholder="Search by project, description or client"
        value={search.value}
        onChange={search.change}
        pending={pending}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
        <NativeSelect
          name="status"
          aria-label="Filter by status"
          value={status}
          onChange={(event) => navigate({ status: event.target.value as ProjectStatusFilter })}
          className="lg:w-48"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="clientId"
          aria-label="Filter by client"
          value={clientId}
          onChange={(event) => navigate({ clientId: event.target.value })}
          className="lg:w-48"
        >
          <option value="">All clients</option>
          <option value={NO_CLIENT_FILTER}>No client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="sort"
          aria-label="Sort projects"
          value={sort}
          onChange={(event) => navigate({ sort: event.target.value as ProjectSort })}
          className="lg:w-44"
        >
          {(Object.keys(SORT_LABELS) as ProjectSort[]).map((value) => (
            <option key={value} value={value}>
              {SORT_LABELS[value]}
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
