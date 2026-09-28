import { Plus } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { InvoicesEmptyState } from "@/components/invoices/invoices-empty-state";
import { InvoicesTable } from "@/components/invoices/invoices-table";
import { InvoicesToolbar } from "@/components/invoices/invoices-toolbar";
import { invoicesListHref } from "@/components/invoices/invoices-url";
import { AccessDenied } from "@/components/layout/access-denied";
import { ListPagination } from "@/components/shared/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";
import { parseListInvoicesQuery } from "@/lib/validation/invoice";
import { listInvoiceableClients, listInvoices } from "@/server/invoices/service";
import { tenantPage } from "@/server/protected";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/invoices">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "invoice:read");
  if (!access.allowed)
    return <AccessDenied message="Ask an owner or admin for access to invoices." />;

  const query = parseListInvoicesQuery(await searchParams);
  const [result, clients] = await Promise.all([
    listInvoices(access.db, query),
    listInvoiceableClients(access.db, query.clientId),
  ]);
  const basePath = `/o/${access.ctx.organization.slug}/invoices`;
  const canCreate = hasPermission(access.ctx.role, "invoice:create");
  const filtered = Boolean(query.q) || Boolean(query.clientId) || query.status !== "all";
  const listParams = {
    q: query.q,
    status: query.status,
    clientId: query.clientId,
    sort: query.sort,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total === 1 ? "1 invoice" : `${result.total} invoices`}
            {filtered && " match your filters"}
          </p>
        </div>
        {canCreate && (
          <Link href={`${basePath}/new`} className={buttonVariants()}>
            <Plus aria-hidden />
            New invoice
          </Link>
        )}
      </div>
      <InvoicesToolbar
        basePath={basePath}
        q={query.q ?? ""}
        status={query.status}
        clientId={query.clientId ?? ""}
        sort={query.sort}
        clients={clients}
        statusCounts={result.statusCounts}
      />
      {result.items.length === 0 ? (
        <InvoicesEmptyState filtered={filtered} basePath={basePath} canCreate={canCreate} />
      ) : (
        <>
          <InvoicesTable invoices={result.items} basePath={basePath} />
          <ListPagination
            page={result.page}
            pageCount={result.pageCount}
            pageSize={result.pageSize}
            total={result.total}
            hrefForPage={(page) => invoicesListHref(basePath, { ...listParams, page })}
          />
        </>
      )}
    </div>
  );
}
