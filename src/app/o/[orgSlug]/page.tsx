import { CheckCircle2, CircleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getHealthReport } from "@/server/health";
import { getTenantContextForPage } from "@/server/tenancy/context";

export default async function OverviewPage({ params }: PageProps<"/o/[orgSlug]">) {
  const { orgSlug } = await params;
  const ctx = await getTenantContextForPage(orgSlug);
  const { checks } = await getHealthReport();
  const databaseOk = checks.database.status === "ok";

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{ctx.organization.name}</h1>
          <Badge variant="secondary">{ctx.role}</Badge>
        </div>
        <p className="text-muted-foreground">Features will appear here as they ship.</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Live check of the services ClientFlow depends on.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              {databaseOk ? (
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
              ) : (
                <CircleAlert className="size-4 text-destructive" aria-hidden />
              )}
              PostgreSQL
            </div>
            {databaseOk ? (
              <Badge variant="secondary">
                Connected
                {checks.database.latencyMs !== undefined && ` · ${checks.database.latencyMs} ms`}
              </Badge>
            ) : (
              <Badge variant="destructive">Unreachable</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
