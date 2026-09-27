"use client";

import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { type ClientStatus } from "@/generated/prisma/enums";
import { type ClientSort, type ClientStatusFilter } from "@/lib/validation/client";

import { clientsListHref } from "./clients-url";

const SEARCH_DEBOUNCE_MS = 300;

export const STATUS_FILTER_LABELS: Record<ClientStatusFilter, string> = {
  current: "Active & inactive",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
  all: "All clients",
};

const SORT_LABELS: Record<ClientSort, string> = {
  name: "Name (A–Z)",
  updated: "Recently updated",
  created: "Recently added",
};

/**
 * Search, status filter and sort. State lives in the URL (shareable, works
 * with back/forward); changing anything returns to page 1. Without
 * JavaScript it is a plain GET form.
 */
export function ClientsToolbar({
  basePath,
  q,
  status,
  sort,
  statusCounts,
}: {
  basePath: string;
  q: string;
  status: ClientStatusFilter;
  sort: ClientSort;
  statusCounts: Record<ClientStatus, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow URL changes made elsewhere ("Clear filters", back/forward) without
  // overwriting what the user is typing (the URL holds the trimmed value).
  if (q !== lastQ) {
    setLastQ(q);
    if (q !== search.trim()) setSearch(q);
  }
  useEffect(() => () => clearTimeout(timer.current), []);

  function navigate(next: { q?: string; status?: ClientStatusFilter; sort?: ClientSort }) {
    clearTimeout(timer.current);
    const href = clientsListHref(basePath, {
      q: (next.q ?? search).trim(),
      status: next.status ?? status,
      sort: next.sort ?? sort,
    });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  const counts: Record<ClientStatusFilter, number> = {
    current: statusCounts.ACTIVE + statusCounts.INACTIVE,
    ACTIVE: statusCounts.ACTIVE,
    INACTIVE: statusCounts.INACTIVE,
    ARCHIVED: statusCounts.ARCHIVED,
    all: statusCounts.ACTIVE + statusCounts.INACTIVE + statusCounts.ARCHIVED,
  };

  return (
    <form
      role="search"
      action={basePath}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        navigate({});
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          aria-label="Search clients"
          placeholder="Search by name, company or email"
          value={search}
          maxLength={100}
          onChange={(event) => {
            const value = event.target.value;
            setSearch(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => navigate({ q: value }), SEARCH_DEBOUNCE_MS);
          }}
          className="pl-8"
        />
        {pending && (
          <Loader2
            className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-label="Updating results"
          />
        )}
      </div>
      <div className="flex gap-2">
        <NativeSelect
          name="status"
          aria-label="Filter by status"
          value={status}
          onChange={(event) => navigate({ status: event.target.value as ClientStatusFilter })}
          className="sm:w-48"
        >
          {(Object.keys(STATUS_FILTER_LABELS) as ClientStatusFilter[]).map((value) => (
            <option key={value} value={value}>
              {STATUS_FILTER_LABELS[value]} ({counts[value]})
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="sort"
          aria-label="Sort clients"
          value={sort}
          onChange={(event) => navigate({ sort: event.target.value as ClientSort })}
          className="sm:w-44"
        >
          {(Object.keys(SORT_LABELS) as ClientSort[]).map((value) => (
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
