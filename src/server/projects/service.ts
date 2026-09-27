import "server-only";

import { type Prisma } from "@/generated/prisma/client";
import { type ProjectActivityType, type ProjectStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ReferenceNotFoundError } from "@/lib/errors";
import {
  NO_CLIENT_FILTER,
  type ListProjectsQuery,
  type ProjectFields,
} from "@/lib/validation/project";
import { escapeLikePattern } from "@/server/search";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Project management. Same pattern as the client service: every function
 * takes the tenant-scoped database client, so all reads and writes are
 * confined to the caller's organization and another organization's project,
 * client or member id behaves exactly like a nonexistent one. Authorization
 * (project:read / create / update / delete) is enforced by the callers
 * through the request pipeline. Composite foreign keys are the database
 * backstop for client and member assignments.
 */

type Deps = { ctx: TenantContext; db: TenantDb };
/** The transaction client handed to `db.$transaction(async (tx) => …)`. */
type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

const MUTABLE_STATUSES: ProjectStatus[] = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"];

/** Fields whose previous and new values are recorded in the activity history. */
const TRACKED_FIELDS = [
  "name",
  "clientId",
  "status",
  "priority",
  "startDate",
  "dueDate",
  "progress",
] as const;
type TrackedField = (typeof TRACKED_FIELDS)[number];

type ChangeValue = string | number | null;
export type ProjectChanges = Partial<
  Record<TrackedField | "description", { from: ChangeValue; to: ChangeValue }>
>;

function notFound(): never {
  throw new NotFoundError("Project not found");
}

/** Dates are stored as calendar days; record them as `YYYY-MM-DD`. */
function toChangeValue(value: string | number | Date | null): ChangeValue {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return a === b;
}

async function recordActivity(
  tx: Tx,
  { ctx }: Pick<Deps, "ctx">,
  projectId: string,
  type: ProjectActivityType,
  changes?: Prisma.InputJsonValue,
) {
  await tx.projectActivity.create({
    data: {
      organizationId: ctx.organization.id,
      projectId,
      actorUserId: ctx.userId,
      type,
      changes,
    },
  });
}

/**
 * A client may be assigned only if it belongs to this organization (checked
 * through the tenant client: foreign and nonexistent ids are the same 404)
 * and is not archived.
 */
async function assertAssignableClient(tx: Tx, clientId: string) {
  const client = await tx.client.findUnique({
    where: { id: clientId },
    select: { status: true },
  });
  if (!client) throw new ReferenceNotFoundError();
  if (client.status === "ARCHIVED") {
    throw new ConflictError("Archived clients cannot be assigned to projects");
  }
}

async function findEditable(tx: Tx, id: string) {
  const project = (await tx.project.findUnique({ where: { id } })) ?? notFound();
  if (project.status === "ARCHIVED") {
    throw new ConflictError("Restore this project before changing it");
  }
  return project;
}

/**
 * Apply a set of field values to an existing (non-archived) project and
 * record what changed: STATUS_CHANGED for a status change, UPDATED for the
 * other fields. No-op if nothing changed.
 */
async function applyChanges(
  tx: Tx,
  deps: Deps,
  existing: Awaited<ReturnType<typeof findEditable>>,
  next: Partial<ProjectFields>,
) {
  if (next.clientId && next.clientId !== existing.clientId) {
    await assertAssignableClient(tx, next.clientId);
  }

  const statusChange: ProjectChanges = {};
  const otherChanges: ProjectChanges = {};
  for (const field of TRACKED_FIELDS) {
    if (!(field in next) || sameValue(existing[field], next[field])) continue;
    const change = {
      from: toChangeValue(existing[field]),
      to: toChangeValue(next[field] as string | number | Date | null),
    };
    if (field === "status") statusChange.status = change;
    else otherChanges[field] = change;
  }
  // Descriptions can be long; record that they changed, not their content.
  if ("description" in next && existing.description !== next.description) {
    otherChanges.description = { from: null, to: null };
  }
  if (!statusChange.status && Object.keys(otherChanges).length === 0) return existing;

  const project = await tx.project.update({ where: { id: existing.id }, data: next });
  if (statusChange.status) {
    await recordActivity(tx, deps, existing.id, "STATUS_CHANGED", statusChange);
  }
  if (Object.keys(otherChanges).length > 0) {
    await recordActivity(tx, deps, existing.id, "UPDATED", otherChanges);
  }
  return project;
}

export async function createProject(deps: Deps, input: ProjectFields) {
  const { ctx, db } = deps;
  return db.$transaction(async (tx) => {
    if (input.clientId) await assertAssignableClient(tx, input.clientId);
    const project = await tx.project.create({
      data: { ...input, organizationId: ctx.organization.id },
    });
    await recordActivity(tx, deps, project.id, "CREATED");
    return project;
  });
}

/** Replace a project's editable fields. Archived projects must be restored first. */
export async function updateProject(deps: Deps, id: string, input: ProjectFields) {
  return deps.db.$transaction(async (tx) =>
    applyChanges(tx, deps, await findEditable(tx, id), input),
  );
}

export async function setProjectStatus(deps: Deps, id: string, status: ProjectStatus) {
  if (!MUTABLE_STATUSES.includes(status))
    throw new ConflictError("Use archive to archive a project");
  return deps.db.$transaction(async (tx) =>
    applyChanges(tx, deps, await findEditable(tx, id), {
      status: status as ProjectFields["status"],
    }),
  );
}

export async function setProjectProgress(deps: Deps, id: string, progress: number) {
  return deps.db.$transaction(async (tx) =>
    applyChanges(tx, deps, await findEditable(tx, id), { progress }),
  );
}

/** Archive: hidden from the default list and read-only; its status is remembered. */
export async function archiveProject(deps: Deps, id: string) {
  return deps.db.$transaction(async (tx) => {
    const existing = (await tx.project.findUnique({ where: { id } })) ?? notFound();
    if (existing.status === "ARCHIVED") throw new ConflictError("This project is already archived");
    const project = await tx.project.update({
      where: { id },
      data: { status: "ARCHIVED", statusBeforeArchive: existing.status, archivedAt: new Date() },
    });
    await recordActivity(tx, deps, id, "ARCHIVED", {
      status: { from: existing.status, to: "ARCHIVED" },
    });
    return project;
  });
}

/** Undo an archive, returning the project to the status it had before. */
export async function restoreProject(deps: Deps, id: string) {
  return deps.db.$transaction(async (tx) => {
    const existing = (await tx.project.findUnique({ where: { id } })) ?? notFound();
    if (existing.status !== "ARCHIVED") throw new ConflictError("This project is not archived");
    const status = existing.statusBeforeArchive ?? "ACTIVE";
    const project = await tx.project.update({
      where: { id },
      data: { status, statusBeforeArchive: null, archivedAt: null },
    });
    await recordActivity(tx, deps, id, "RESTORED", { status: { from: "ARCHIVED", to: status } });
    return project;
  });
}

/**
 * Add an organization member to a project. The person must be a member of
 * this organization (checked through the tenant client, and guaranteed by
 * the composite foreign key to Membership).
 */
export async function addProjectMember(deps: Deps, projectId: string, userId: string) {
  return deps.db.$transaction(async (tx) => {
    await findEditable(tx, projectId);
    const membership = await tx.membership.findFirst({
      where: { userId },
      select: { user: { select: { name: true } } },
    });
    if (!membership) throw new ReferenceNotFoundError();

    const existing = await tx.projectMember.findFirst({ where: { projectId, userId } });
    if (existing) throw new ConflictError("This person is already a member of the project");

    const member = await tx.projectMember.create({
      data: { organizationId: deps.ctx.organization.id, projectId, userId },
    });
    await recordActivity(tx, deps, projectId, "MEMBER_ADDED", {
      member: { userId, name: membership.user.name },
    });
    return member;
  });
}

export async function removeProjectMember(deps: Deps, projectId: string, userId: string) {
  return deps.db.$transaction(async (tx) => {
    await findEditable(tx, projectId);
    const member = await tx.projectMember.findFirst({
      where: { projectId, userId },
      select: { id: true, membership: { select: { user: { select: { name: true } } } } },
    });
    if (!member) throw new NotFoundError("Project member not found");

    await tx.projectMember.delete({ where: { id: member.id } });
    await recordActivity(tx, deps, projectId, "MEMBER_REMOVED", {
      member: { userId, name: member.membership.user.name },
    });
  });
}

/** Project with its client and members (one query per relation, no N+1). */
export async function getProject(db: TenantDb, id: string) {
  const project = await db.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, status: true } },
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          createdAt: true,
          membership: {
            select: { role: true, user: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  return project ?? notFound();
}

function statusWhere(status: ListProjectsQuery["status"]): Prisma.ProjectWhereInput {
  switch (status) {
    case "current":
      return { status: { not: "ARCHIVED" } };
    case "all":
      return {};
    default:
      return { status };
  }
}

function clientWhere(clientId: string | undefined): Prisma.ProjectWhereInput {
  if (!clientId) return {};
  return clientId === NO_CLIENT_FILTER ? { clientId: null } : { clientId };
}

function searchWhere(q: string | undefined): Prisma.ProjectWhereInput {
  if (!q) return {};
  const term = { contains: escapeLikePattern(q), mode: "insensitive" as const };
  return { OR: [{ name: term }, { description: term }, { client: { name: term } }] };
}

const ORDER_BY: Record<ListProjectsQuery["sort"], Prisma.ProjectOrderByWithRelationInput[]> = {
  name: [{ name: "asc" }, { id: "asc" }],
  due: [{ dueDate: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }],
  priority: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  updated: [{ updatedAt: "desc" }, { id: "asc" }],
  created: [{ createdAt: "desc" }, { id: "asc" }],
};

export type ProjectListResult = Awaited<ReturnType<typeof listProjects>>;

/**
 * Search, filter (status, client), sort and paginate the organization's
 * projects in the database. Client names and member counts are loaded with
 * the page (no N+1). Pages past the end are clamped to the last page.
 */
export async function listProjects(db: TenantDb, query: ListProjectsQuery) {
  const scopeFilters = { AND: [clientWhere(query.clientId), searchWhere(query.q)] };
  const where = { AND: [statusWhere(query.status), scopeFilters] };

  const [total, statusGroups] = await Promise.all([
    db.project.count({ where }),
    db.project.groupBy({ by: ["status"], _count: { _all: true }, where: scopeFilters }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const items = await db.project.findMany({
    where,
    orderBy: ORDER_BY[query.sort],
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      name: true,
      status: true,
      priority: true,
      progress: true,
      startDate: true,
      dueDate: true,
      updatedAt: true,
      client: { select: { id: true, name: true } },
      _count: { select: { members: true } },
    },
  });

  const statusCounts: Record<ProjectStatus, number> = {
    PLANNING: 0,
    ACTIVE: 0,
    ON_HOLD: 0,
    COMPLETED: 0,
    ARCHIVED: 0,
  };
  for (const group of statusGroups) statusCounts[group.status] = group._count._all;

  return { items, total, page, pageSize: query.pageSize, pageCount, statusCounts };
}

/** Most recent first. 404 if the project is not in this organization. */
export async function listProjectActivity(db: TenantDb, projectId: string, limit = 20) {
  const exists = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) notFound();
  return db.projectActivity.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      changes: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
}

/** Clients that can be chosen for a project (plus the current one, even if archived). */
export async function listAssignableClients(db: TenantDb, currentClientId?: string | null) {
  return db.client.findMany({
    where: currentClientId
      ? { OR: [{ status: { not: "ARCHIVED" } }, { id: currentClientId }] }
      : { status: { not: "ARCHIVED" } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, name: true },
  });
}

/** Organization members not yet on the project. */
export async function listAddableMembers(db: TenantDb, projectId: string) {
  const memberships = await db.membership.findMany({
    where: { projectMembers: { none: { projectId } } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, role: true, user: { select: { name: true, email: true } } },
  });
  return memberships.map(({ userId, role, user }) => ({ userId, role, ...user }));
}
