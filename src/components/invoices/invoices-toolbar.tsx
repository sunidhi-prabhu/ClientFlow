"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ListSearchInput, useListSearch } from "@/components/shared/list-search";
import { NativeSelect } from "@/components/ui/native-select";
import { type InvoiceSort, type InvoiceStatusFilter } from "@/lib/validation/invoice";

import { INVOICE_STATUS_LABELS } from "./invoice-status-badge";
import { invoicesListHref } from "./invoices-url";

const SORT_LABELS: Record<InvoiceSort, string> = {
  newest: "Newest first",
  due: "Due date",
  number: "Invoice number",
  amount: "Amount",
};

type Counts = Record<Exclude<InvoiceStatusFilter, "all">, number>;
type Next = { q?: string; status?: InvoiceStatusFilter; clientId?: string; sort?: InvoiceSort };

/** Search, status and client filters, and sort, kept in the URL. */
export function InvoicesToolbar({
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
  status: InvoiceStatusFilter;
  clientId: string;
  sort: InvoiceSort;
  clients: { id: string; name: string }[];
  statusCounts: Counts;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const search = useListSearch(q, (value) => navigate({ q: value }));

  function navigate(next: Next) {
    search.cancel();
    const href = invoicesListHref(basePath, {
      q: (next.q ?? search.value).trim(),
      status: next.status ?? status,
      clientId: next.clientId ?? clientId,
      sort: next.sort ?? sort,
    });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  const all = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);

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
        label="Search invoices"
        placeholder="Search by invoice number or client"
        value={search.value}
        onChange={search.change}
        pending={pending}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
        <NativeSelect
          name="status"
          aria-label="Filter by status"
          value={status}
          onChange={(event) => navigate({ status: event.target.value as InvoiceStatusFilter })}
          className="lg:w-44"
        >
          <option value="all">All statuses ({all})</option>
          {(Object.keys(statusCounts) as (keyof Counts)[]).map((value) => (
            <option key={value} value={value}>
              {INVOICE_STATUS_LABELS[value]} ({statusCounts[value]})
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
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="sort"
          aria-label="Sort invoices"
          value={sort}
          onChange={(event) => navigate({ sort: event.target.value as InvoiceSort })}
          className="lg:w-40"
        >
          {(Object.keys(SORT_LABELS) as InvoiceSort[]).map((value) => (
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
