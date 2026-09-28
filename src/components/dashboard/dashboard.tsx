import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  FolderKanban,
  ListTodo,
  Plus,
  Receipt,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";

import {
  type ClientActivityItem,
  describeClientActivity,
} from "@/components/clients/client-activity-list";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { invoicesListHref } from "@/components/invoices/invoices-url";
import {
  type ProjectActivityItem,
  describeProjectActivity,
} from "@/components/projects/project-activity-list";
import { formatProjectDate, isOverdue } from "@/components/projects/project-labels";
import { EmptyState } from "@/components/shared/empty-state";
import { ProgressBar } from "@/components/shared/progress-bar";
import { TASK_COLUMNS, TASK_STATUS_LABELS } from "@/components/tasks/task-labels";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type ClientStatus, type ProjectStatus, type TaskStatus } from "@/generated/prisma/enums";
import { type CurrencyAmount, INVOICE_SUMMARY_ORDER, type InvoiceSummary } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

import { ActivityFeed } from "./activity-feed";
import { MetricCard } from "./metric-card";
import { StatusBreakdown } from "./status-breakdown";

/** What the dashboard service returns; sections the role cannot read are null. */
export type DashboardData = {
  clients: { total: number; byStatus: Record<ClientStatus, number> } | null;
  projects: {
    active: number;
    byStatus: Record<ProjectStatus, number>;
    activeProjects: {
      id: string;
      name: string;
      status: ProjectStatus;
      progress: number;
      dueDate: Date | null;
      client: { id: string; name: string } | null;
      /** null when the role cannot read tasks. */
      openTasks: number | null;
    }[];
  } | null;
  tasks: { total: number; open: number; byStatus: Record<TaskStatus, number> } | null;
  invoices: InvoiceSummary | null;
  projectActivity: (ProjectActivityItem & { project: { id: string; name: string } })[] | null;
  clientActivity: (ClientActivityItem & { client: { id: string; name: string } })[] | null;
};

const TASK_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-muted-foreground/50",
  IN_PROGRESS: "bg-sky-500",
  REVIEW: "bg-amber-500",
  DONE: "bg-emerald-500",
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Amounts in each currency, one per line (currencies are never added together). */
function MoneyLines({
  amounts,
  empty = "—",
  headline = false,
}: {
  amounts: CurrencyAmount[];
  empty?: string;
  /** Metric-card value: several currencies are shown slightly smaller to fit. */
  headline?: boolean;
}) {
  if (amounts.length === 0) return <span>{empty}</span>;
  return (
    <span className={cn("grid", headline && amounts.length > 1 && "text-lg")}>
      {amounts.map((amount) => (
        <span key={amount.currency}>{formatMoney(amount.cents, amount.currency)}</span>
      ))}
    </span>
  );
}

function moneyText(amounts: CurrencyAmount[]) {
  return amounts.map((amount) => formatMoney(amount.cents, amount.currency)).join(" + ");
}

function outstandingText(invoices: InvoiceSummary) {
  if (invoices.invoiced.length === 0) return "No invoices issued yet";
  const unpaid = invoices.outstanding.filter((amount) => amount.cents > 0);
  return unpaid.length > 0 ? `${moneyText(unpaid)} outstanding` : "Nothing outstanding";
}

export function Dashboard({
  data,
  basePath,
  canCreateClient,
  canCreateProject,
  now = new Date(),
}: {
  data: DashboardData;
  /** `/o/[orgSlug]` */
  basePath: string;
  canCreateClient: boolean;
  canCreateProject: boolean;
  now?: Date;
}) {
  const { clients, projects, tasks, invoices } = data;
  const invoicesPath = `${basePath}/invoices`;
  const isEmpty =
    (clients?.total ?? 0) + (clients?.byStatus.ARCHIVED ?? 0) === 0 &&
    Object.values(projects?.byStatus ?? {}).every((count) => count === 0) &&
    (invoices?.total ?? 0) === 0;

  return (
    <div className="space-y-6">
      {isEmpty && (
        <EmptyState
          icon={Sparkles}
          title="Nothing to report yet"
          description="Add your first client and project; this overview fills in as your team works."
          action={
            (canCreateClient || canCreateProject) && (
              <div className="flex flex-wrap justify-center gap-2">
                {canCreateClient && (
                  <Link href={`${basePath}/clients/new`} className={buttonVariants()}>
                    <Plus aria-hidden />
                    Add a client
                  </Link>
                )}
                {canCreateProject && (
                  <Link
                    href={`${basePath}/projects/new`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <Plus aria-hidden />
                    New project
                  </Link>
                )}
              </div>
            )
          }
        />
      )}

      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
      >
        {clients && (
          <MetricCard
            title="Total clients"
            icon={Users}
            href={`${basePath}/clients`}
            value={clients.total}
            detail={`${clients.byStatus.ACTIVE} active · ${clients.byStatus.INACTIVE} inactive`}
          />
        )}
        {projects && (
          <MetricCard
            title="Active projects"
            icon={FolderKanban}
            href={`${basePath}/projects?status=ACTIVE`}
            value={projects.active}
            detail={`${projects.byStatus.PLANNING} planning · ${projects.byStatus.ON_HOLD} on hold`}
          />
        )}
        {tasks && (
          <MetricCard
            title="Open tasks"
            icon={ListTodo}
            value={tasks.open}
            detail={`${tasks.byStatus.DONE} of ${plural(tasks.total, "task")} done`}
          />
        )}
        {invoices && (
          <>
            <MetricCard
              title="Overdue invoices"
              icon={AlertTriangle}
              href={invoicesListHref(invoicesPath, { status: "OVERDUE" })}
              value={invoices.overdueCount}
              tone={invoices.overdueCount > 0 ? "alert" : "default"}
              detail={
                invoices.overdueCount > 0 ? `${moneyText(invoices.overdue)} due` : "Nothing overdue"
              }
            />
            <MetricCard
              title="Total invoiced"
              icon={Receipt}
              href={invoicesPath}
              value={<MoneyLines headline amounts={invoices.invoiced} />}
              detail={outstandingText(invoices)}
            />
            <MetricCard
              title="Total paid"
              icon={Banknote}
              href={invoicesListHref(invoicesPath, { status: "PAID" })}
              value={<MoneyLines headline amounts={invoices.paid} />}
              detail={plural(invoices.byStatus.PAID.count, "paid invoice")}
            />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {projects && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                <h2>Project progress</h2>
              </CardTitle>
              <CardDescription>Active projects, soonest due first.</CardDescription>
              {projects.active > 0 && (
                <CardAction>
                  <Link
                    href={`${basePath}/projects?status=ACTIVE`}
                    className="text-sm font-medium hover:underline"
                  >
                    View all
                  </Link>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {projects.activeProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No active projects.{" "}
                  {canCreateProject && (
                    <Link href={`${basePath}/projects/new`} className="font-medium underline">
                      Start one
                    </Link>
                  )}
                </p>
              ) : (
                <ul aria-label="Active projects" className="divide-y">
                  {projects.activeProjects.map((project) => {
                    const overdue = isOverdue(project, now);
                    return (
                      <li
                        key={project.id}
                        className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center sm:gap-4"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <Link
                            href={`${basePath}/projects/${project.id}`}
                            className="block truncate font-medium hover:underline"
                          >
                            {project.name}
                          </Link>
                          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            <span>{project.client?.name ?? "No client"}</span>
                            {project.dueDate && (
                              <span className={cn(overdue && "font-medium text-destructive")}>
                                Due {formatProjectDate(project.dueDate)}
                                {overdue && " · overdue"}
                              </span>
                            )}
                            {project.openTasks !== null && (
                              <span>{plural(project.openTasks, "open task")}</span>
                            )}
                          </p>
                        </div>
                        <ProgressBar value={project.progress} label={`${project.name} progress`} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {projects.active > projects.activeProjects.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Showing {projects.activeProjects.length} of {projects.active} active projects.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {tasks && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Tasks by status</h2>
              </CardTitle>
              <CardDescription>Across all projects that are not archived.</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusBreakdown
                label="Tasks by status"
                emptyText="No tasks yet."
                segments={TASK_COLUMNS.map((status) => ({
                  key: status,
                  label: TASK_STATUS_LABELS[status],
                  count: tasks.byStatus[status],
                  color: TASK_COLORS[status],
                }))}
              />
            </CardContent>
          </Card>
        )}
      </div>

      <div className={cn("grid gap-6", invoices ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {invoices && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Invoices</h2>
              </CardTitle>
              <CardDescription>Status summary; amounts are invoice totals.</CardDescription>
            </CardHeader>
            <CardContent>
              {invoices.total === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <ul aria-label="Invoice status summary" className="grid gap-2">
                  {INVOICE_SUMMARY_ORDER.map((status) => {
                    const summary = invoices.byStatus[status];
                    return (
                      <li key={status}>
                        <Link
                          href={invoicesListHref(invoicesPath, { status })}
                          className="-mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted/60"
                        >
                          <span className="flex items-center gap-2">
                            <InvoiceStatusBadge status={status} />
                            <span className="text-sm tabular-nums">{summary.count}</span>
                          </span>
                          <span className="text-right text-sm text-muted-foreground tabular-nums">
                            <MoneyLines amounts={summary.amounts} />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {invoices.overdueCount === 0 && invoices.total > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 aria-hidden className="size-3.5 text-emerald-600" />
                  No overdue invoices.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {data.projectActivity && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Recent activity</h2>
              </CardTitle>
              <CardDescription>Latest project and task changes.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed
                label="Recent project activity"
                emptyText="No project activity yet."
                items={data.projectActivity.map((item) => ({
                  id: item.id,
                  actorName: item.actor?.name ?? null,
                  description: describeProjectActivity(item),
                  createdAt: item.createdAt,
                  subject: {
                    name: item.project.name,
                    href: `${basePath}/projects/${item.project.id}`,
                  },
                }))}
              />
            </CardContent>
          </Card>
        )}

        {data.clientActivity && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Recent client activity</h2>
              </CardTitle>
              <CardDescription>Clients added and updated.</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityFeed
                label="Recent client activity"
                emptyText="No client activity yet."
                items={data.clientActivity.map((item) => ({
                  id: item.id,
                  actorName: item.actor?.name ?? null,
                  description: describeClientActivity(item),
                  createdAt: item.createdAt,
                  subject: {
                    name: item.client.name,
                    href: `${basePath}/clients/${item.client.id}`,
                  },
                }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
