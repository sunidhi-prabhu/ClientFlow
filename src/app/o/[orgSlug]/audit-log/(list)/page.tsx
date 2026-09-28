import { ScrollText } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { AuditLogList } from "@/components/audit/audit-log-list";
import { AuditLogToolbar } from "@/components/audit/audit-log-toolbar";
import { auditLogHref } from "@/components/audit/audit-url";
import { AccessDenied } from "@/components/layout/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { ListPagination } from "@/components/shared/list-pagination";
import { buttonVariants } from "@/components/ui/button";
import { parseListAuditLogQuery } from "@/lib/validation/audit";
import { AUDIT_COUNT_LIMIT, listAuditActors, listAuditLog, NO_ACTOR } from "@/server/audit/service";
import { tenantPage } from "@/server/protected";

export const metadata: Metadata = { title: "Audit log" };

const day = (date: Date | undefined) => (date ? date.toISOString().slice(0, 10) : "");

export default async function AuditLogPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/audit-log">) {
  const { orgSlug } = await params;
  // The organization comes from the session's membership; audit:read is OWNER/ADMIN only.
  const access = await tenantPage(orgSlug, "audit:read");
  if (!access.allowed) {
    return <AccessDenied message="Only owners and admins can view the audit log." />;
  }

  const query = parseListAuditLogQuery(await searchParams);
  const [result, actors] = await Promise.all([
    listAuditLog(access.db, query),
    listAuditActors(access.db),
  ]);
  const basePath = `/o/${access.ctx.organization.slug}/audit-log`;
  const filters = {
    from: day(query.from),
    to: day(query.to),
    actorId: query.actorId ?? "",
    action: query.action ?? "",
    resourceType: query.resourceType ?? "",
  };
  const filtered = Object.values(filters).some(Boolean);
  const totalLabel = `${AUDIT_COUNT_LIMIT.toLocaleString("en")}+`;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {result.totalIsCapped
            ? `${totalLabel} events`
            : result.total === 1
              ? "1 event"
              : `${result.total} events`}
          {filtered && " match your filters"} · Sign-ins, member and role changes, and changes to
          clients, projects, tasks and invoices. Times are UTC.
        </p>
      </div>
      <AuditLogToolbar
        basePath={basePath}
        filters={filters}
        actors={actors}
        noActorValue={NO_ACTOR}
      />
      {result.items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? "No events match these filters" : "No audit events yet"}
          description={
            filtered
              ? "Try a wider date range or clear the filters."
              : "Sign-ins and changes in this organization will be recorded here."
          }
          action={
            filtered && (
              <Link href={basePath} className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            )
          }
        />
      ) : (
        <>
          <AuditLogList entries={result.items} basePath={`/o/${access.ctx.organization.slug}`} />
          <ListPagination
            page={result.page}
            pageCount={result.pageCount}
            pageSize={result.pageSize}
            total={result.total}
            totalLabel={result.totalIsCapped ? totalLabel : undefined}
            hrefForPage={(page) => auditLogHref(basePath, { ...filters, page })}
          />
          {result.totalIsCapped && result.page === result.pageCount && (
            <p className="text-sm text-muted-foreground">
              Showing the newest {AUDIT_COUNT_LIMIT.toLocaleString("en")} matching events. Narrow
              the date range to see older ones.
            </p>
          )}
        </>
      )}
    </div>
  );
}
