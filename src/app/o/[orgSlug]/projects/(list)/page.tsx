import { Plus } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { PlanLimitNotice } from "@/components/billing/plan-limit-notice";
import { AccessDenied } from "@/components/layout/access-denied";
import { ProjectsEmptyState } from "@/components/projects/projects-empty-state";
import { ProjectsTable } from "@/components/projects/projects-table";
import { ProjectsToolbar } from "@/components/projects/projects-toolbar";
import { projectsListHref } from "@/components/projects/projects-url";
import { ListPagination } from "@/components/shared/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { hasPermission } from "@/lib/permissions";
import { parseListProjectsQuery } from "@/lib/validation/project";
import { getUsage } from "@/server/billing/limits";
import { listAssignableClients, listProjects } from "@/server/projects/service";
import { tenantPage } from "@/server/protected";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/projects">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "project:read");
  if (!access.allowed)
    return <AccessDenied message="Ask an owner or admin for access to projects." />;

  const query = parseListProjectsQuery(await searchParams);
  const [result, clients] = await Promise.all([
    listProjects(access.db, query),
    listAssignableClients(access.db, query.clientId),
  ]);
  const basePath = `/o/${access.ctx.organization.slug}/projects`;
  const canCreate = hasPermission(access.ctx.role, "project:create");
  const usage = canCreate ? await getUsage(access.db, "projects") : null;
  const billingPath = hasPermission(access.ctx.role, "billing:manage")
    ? `/o/${access.ctx.organization.slug}/billing`
    : undefined;
  const filtered = Boolean(query.q) || Boolean(query.clientId) || query.status !== "current";
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
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {result.total === 1 ? "1 project" : `${result.total} projects`}
            {filtered && " match your filters"}
          </p>
        </div>
        {canCreate && (
          <Link href={`${basePath}/new`} className={buttonVariants()}>
            <Plus aria-hidden />
            New project
          </Link>
        )}
      </div>

      {usage && <PlanLimitNotice resource="projects" usage={usage} billingPath={billingPath} />}

      <ProjectsToolbar
        basePath={basePath}
        q={query.q ?? ""}
        status={query.status}
        clientId={query.clientId ?? ""}
        sort={query.sort}
        clients={clients}
        statusCounts={result.statusCounts}
      />

      {result.items.length === 0 ? (
        <ProjectsEmptyState filtered={filtered} basePath={basePath} canCreate={canCreate} />
      ) : (
        <>
          <ProjectsTable projects={result.items} basePath={basePath} />
          <ListPagination
            page={result.page}
            pageCount={result.pageCount}
            pageSize={result.pageSize}
            total={result.total}
            hrefForPage={(page) => projectsListHref(basePath, { ...listParams, page })}
          />
        </>
      )}
    </div>
  );
}
