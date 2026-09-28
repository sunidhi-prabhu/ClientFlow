import "server-only";

import {
  type ClientStatus,
  type MembershipRole,
  type ProjectStatus,
  type TaskStatus,
} from "@/generated/prisma/enums";
import { summarizeInvoices } from "@/lib/dashboard";
import { todayUtc } from "@/lib/invoices";
import { hasPermission } from "@/lib/permissions";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Organization dashboard. Every metric is computed in the database with
 * aggregate queries (count / groupBy / _sum) through the tenant-scoped client,
 * so it only ever sees the caller's organization. All queries are independent
 * and run concurrently in one batch; their number does not depend on how much
 * data the organization has (no N+1).
 *
 * Sections the caller's role may not read (e.g. invoices for MEMBER) are
 * returned as null and never queried.
 */

/** Active projects shown with their progress. */
export const DASHBOARD_PROJECT_LIMIT = 5;
/** Items in each activity feed. */
export const DASHBOARD_ACTIVITY_LIMIT = 8;

const activitySelect = {
  id: true,
  type: true,
  changes: true,
  createdAt: true,
  actor: { select: { name: true, email: true } },
} as const;

function countByStatus<S extends string>(
  statuses: readonly S[],
  groups: { status: S; _count: { _all: number } }[],
): Record<S, number> {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0])) as Record<S, number>;
  for (const group of groups) counts[group.status] += group._count._all;
  return counts;
}

const CLIENT_STATUSES: ClientStatus[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];
const PROJECT_STATUSES: ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
];
const TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];

const skip = Promise.resolve(null);

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getDashboard(db: TenantDb, role: MembershipRole, now = new Date()) {
  const can = {
    clients: hasPermission(role, "client:read"),
    projects: hasPermission(role, "project:read"),
    tasks: hasPermission(role, "task:read"),
    invoices: hasPermission(role, "invoice:read"),
  };
  const today = todayUtc(now);

  const [
    clientGroups,
    projectGroups,
    taskGroups,
    invoiceGroups,
    overdueGroups,
    activeProjects,
    projectActivity,
    clientActivity,
  ] = await Promise.all([
    can.clients ? db.client.groupBy({ by: ["status"], _count: { _all: true } }) : skip,
    can.projects ? db.project.groupBy({ by: ["status"], _count: { _all: true } }) : skip,
    // Tasks of archived projects are out of play and not counted.
    can.tasks
      ? db.task.groupBy({
          by: ["status"],
          _count: { _all: true },
          where: { project: { status: { not: "ARCHIVED" } } },
        })
      : skip,
    can.invoices
      ? db.invoice.groupBy({
          by: ["status", "currency"],
          _count: { _all: true },
          _sum: { totalCents: true },
        })
      : skip,
    // Derived OVERDUE: issued with a due date before today (UTC), as in the invoice list.
    can.invoices
      ? db.invoice.groupBy({
          by: ["currency"],
          _count: { _all: true },
          _sum: { totalCents: true },
          where: { status: "ISSUED", dueDate: { lt: today } },
        })
      : skip,
    can.projects
      ? db.project.findMany({
          where: { status: "ACTIVE" },
          orderBy: [
            { dueDate: { sort: "asc", nulls: "last" } },
            { updatedAt: "desc" },
            { id: "asc" },
          ],
          take: DASHBOARD_PROJECT_LIMIT,
          select: {
            id: true,
            name: true,
            status: true,
            progress: true,
            dueDate: true,
            client: { select: { id: true, name: true } },
            // Open tasks per project, counted in the same statement.
            _count: { select: { tasks: { where: { status: { not: "DONE" } } } } },
          },
        })
      : skip,
    can.projects
      ? db.projectActivity.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: DASHBOARD_ACTIVITY_LIMIT,
          select: {
            ...activitySelect,
            taskId: true,
            project: { select: { id: true, name: true } },
          },
        })
      : skip,
    can.clients
      ? db.clientActivity.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: DASHBOARD_ACTIVITY_LIMIT,
          select: { ...activitySelect, client: { select: { id: true, name: true } } },
        })
      : skip,
  ]);

  let clients = null;
  if (clientGroups) {
    const byStatus = countByStatus(CLIENT_STATUSES, clientGroups);
    // Archived clients are no longer part of the book of business.
    clients = { byStatus, total: byStatus.ACTIVE + byStatus.INACTIVE };
  }

  let projects = null;
  if (projectGroups) {
    const byStatus = countByStatus(PROJECT_STATUSES, projectGroups);
    projects = {
      byStatus,
      active: byStatus.ACTIVE,
      activeProjects: (activeProjects ?? []).map(({ _count, ...project }) => ({
        ...project,
        openTasks: can.tasks ? _count.tasks : null,
      })),
    };
  }

  let tasks = null;
  if (taskGroups) {
    const byStatus = countByStatus(TASK_STATUSES, taskGroups);
    tasks = {
      byStatus,
      total: TASK_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
      open: byStatus.TODO + byStatus.IN_PROGRESS + byStatus.REVIEW,
    };
  }

  const invoices =
    invoiceGroups && overdueGroups
      ? summarizeInvoices(
          invoiceGroups.map((group) => ({
            status: group.status,
            currency: group.currency,
            count: group._count._all,
            cents: group._sum.totalCents ?? 0,
          })),
          overdueGroups.map((group) => ({
            currency: group.currency,
            count: group._count._all,
            cents: group._sum.totalCents ?? 0,
          })),
        )
      : null;

  return { clients, projects, tasks, invoices, projectActivity, clientActivity };
}
