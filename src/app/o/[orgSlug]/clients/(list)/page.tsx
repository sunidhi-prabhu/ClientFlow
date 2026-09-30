import { Plus } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { PlanLimitNotice } from "@/components/billing/plan-limit-notice";
import { ClientsEmptyState } from "@/components/clients/clients-empty-state";
import { ClientsPagination } from "@/components/clients/clients-pagination";
import { ClientsTable } from "@/components/clients/clients-table";
import { ClientsToolbar } from "@/components/clients/clients-toolbar";
import { AccessDenied } from "@/components/layout/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";
import { parseListClientsQuery } from "@/lib/validation/client";
import { getUsage } from "@/server/billing/limits";
import { listClients } from "@/server/clients/service";
import { tenantPage } from "@/server/protected";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/clients">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "client:read");
  if (!access.allowed)
    return <AccessDenied message="Ask an owner or admin for access to clients." />;

  const query = parseListClientsQuery(await searchParams);
  const result = await listClients(access.db, query);
  const basePath = `/o/${access.ctx.organization.slug}/clients`;
  const canCreate = hasPermission(access.ctx.role, "client:create");
  const usage = canCreate ? await getUsage(access.db, "clients") : null;
  const billingPath = hasPermission(access.ctx.role, "billing:manage")
    ? `/o/${access.ctx.organization.slug}/billing`
    : undefined;
  const filtered = Boolean(query.q) || query.status !== "current";
  const listParams = { q: query.q, status: query.status, sort: query.sort };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total === 1 ? "1 client" : `${result.total} clients`}
            {filtered && " match your filters"}
          </p>
        </div>
        {canCreate && (
          <Link href={`${basePath}/new`} className={buttonVariants()}>
            <Plus aria-hidden />
            New client
          </Link>
        )}
      </div>

      {usage && <PlanLimitNotice resource="clients" usage={usage} billingPath={billingPath} />}

      <ClientsToolbar
        basePath={basePath}
        q={query.q ?? ""}
        status={query.status}
        sort={query.sort}
        statusCounts={result.statusCounts}
      />

      {result.items.length === 0 ? (
        <ClientsEmptyState filtered={filtered} basePath={basePath} canCreate={canCreate} />
      ) : (
        <>
          <ClientsTable clients={result.items} basePath={basePath} />
          <ClientsPagination
            basePath={basePath}
            params={listParams}
            page={result.page}
            pageCount={result.pageCount}
            pageSize={result.pageSize}
            total={result.total}
          />
        </>
      )}
    </div>
  );
}
