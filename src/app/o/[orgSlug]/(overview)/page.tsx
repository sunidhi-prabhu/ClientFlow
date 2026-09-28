import { type Metadata } from "next";

import { Dashboard } from "@/components/dashboard/dashboard";
import { AccessDenied } from "@/components/layout/access-denied";
import { Badge } from "@/components/ui/badge";
import { hasPermission } from "@/lib/permissions";
import { getDashboard } from "@/server/dashboard/service";
import { tenantPage } from "@/server/protected";

export const metadata: Metadata = { title: "Overview" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" });

export default async function OverviewPage({ params }: PageProps<"/o/[orgSlug]">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "organization:read");
  if (!access.allowed) return <AccessDenied message="Ask an owner or admin for access." />;

  const { ctx, db } = access;
  const now = new Date();
  // Scoped by the membership resolved on the server; the role decides which sections load.
  const data = await getDashboard(db, ctx.role, now);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{ctx.organization.name}</h1>
          <Badge variant="secondary">{ctx.role}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Overview for {dateFormat.format(now)} (UTC)</p>
      </div>
      <Dashboard
        data={data}
        basePath={`/o/${ctx.organization.slug}`}
        canCreateClient={hasPermission(ctx.role, "client:create")}
        canCreateProject={hasPermission(ctx.role, "project:create")}
        now={now}
      />
    </div>
  );
}
