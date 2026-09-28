import "server-only";

import { type Prisma } from "@/generated/prisma/client";
import { type ProjectActivityType, type TaskStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { type TaskBoardQuery, type TaskFields, UNASSIGNED_FILTER } from "@/lib/validation/task";
import { recordAudit } from "@/server/audit/service";
import { escapeLikePattern } from "@/server/search";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Task management. Same pattern as clients and projects: every function takes
 * the tenant-scoped database client, so a task or project of another
 * organization behaves exactly like a nonexistent one (404). For existing
 * tasks the project is always read from the task itself, never from input.
 * Assignees are checked against the task's project (and the composite
 * foreign key to ProjectMember enforces it in the database). Every change and
 * its activity row are written in one transaction.
 *
 * Authorization (task:read / create / update / delete) is enforced by the
 * callers through the request pipeline.
 */

type Deps = { ctx: TenantContext; db: TenantDb };
type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Person = { userId: string; name: string } | null;

/** Board card fields: the assignee's name is loaded in the same round trip (no N+1). */
const cardSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  assigneeUserId: true,
  updatedAt: true,
  assignee: { select: { membership: { select: { user: { select: { name: true } } } } } },
} as const;

/** Maximum cards loaded for one board. */
export const BOARD_TASK_LIMIT = 500;

function taskNotFound(): never {
  throw new NotFoundError("Task not found");
}

function toChangeValue(value: string | Date | null): string | null {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function sameValue(a: string | Date | null, b: string | Date | null) {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return a === b;
}

async function record(
  tx: Tx,
  { ctx }: Pick<Deps, "ctx">,
  task: { id: string; projectId: string },
  type: ProjectActivityType,
  changes: Prisma.InputJsonValue,
) {
  await tx.projectActivity.create({
    data: {
      organizationId: ctx.organization.id,
      projectId: task.projectId,
      taskId: task.id,
      actorUserId: ctx.userId,
      type,
      changes,
    },
  });
}

/** The project (of this organization) that tasks are created in or changed under. */
async function findProject(tx: Tx, projectId: string, { editable }: { editable: boolean }) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true },
  });
  if (!project) throw new NotFoundError("Project not found");
  if (editable && project.status === "ARCHIVED") {
    throw new ConflictError("Restore this project before changing its tasks");
  }
  return project;
}

async function findTaskForChange(tx: Tx, id: string) {
  const task =
    (await tx.task.findUnique({
      where: { id },
      include: {
        assignee: { select: { membership: { select: { user: { select: { name: true } } } } } },
      },
    })) ?? taskNotFound();
  await findProject(tx, task.projectId, { editable: true });
  return task;
}

/**
 * The assignee must be a member of this task's project. Unknown users, users
 * of other organizations and organization members who are not on the project
 * all get the same validation error.
 */
async function assigneeOf(tx: Tx, projectId: string, userId: string): Promise<Person> {
  const member = await tx.projectMember.findFirst({
    where: { projectId, userId },
    select: { membership: { select: { user: { select: { name: true } } } } },
  });
  if (!member) {
    const message = "The assignee must be a member of this project";
    throw new ValidationError(message, { details: [{ path: "assigneeUserId", message }] });
  }
  return { userId, name: member.membership.user.name };
}

type ExistingTask = Awaited<ReturnType<typeof findTaskForChange>>;

/**
 * Apply field values to an existing task and record what changed: status,
 * priority and assignment each get their own event; title, due date and
 * description changes are grouped as TASK_UPDATED. No-op if nothing changed.
 */
async function applyChanges(tx: Tx, deps: Deps, existing: ExistingTask, next: Partial<TaskFields>) {
  const title = next.title ?? existing.title;
  const events: { type: ProjectActivityType; changes: Prisma.InputJsonValue }[] = [];

  if (next.status !== undefined && next.status !== existing.status) {
    events.push({
      type: "TASK_STATUS_CHANGED",
      changes: { task: { title }, status: { from: existing.status, to: next.status } },
    });
  }
  if (next.priority !== undefined && next.priority !== existing.priority) {
    events.push({
      type: "TASK_PRIORITY_CHANGED",
      changes: { task: { title }, priority: { from: existing.priority, to: next.priority } },
    });
  }
  if (next.assigneeUserId !== undefined && next.assigneeUserId !== existing.assigneeUserId) {
    const from: Person = existing.assigneeUserId
      ? { userId: existing.assigneeUserId, name: existing.assignee?.membership.user.name ?? "" }
      : null;
    const to = next.assigneeUserId
      ? await assigneeOf(tx, existing.projectId, next.assigneeUserId)
      : null;
    events.push({
      type: "TASK_ASSIGNMENT_CHANGED",
      changes: { task: { title }, assignee: { from, to } },
    });
  }

  const updated: Record<string, { from: string | null; to: string | null }> = {};
  for (const field of ["title", "dueDate"] as const) {
    if (next[field] !== undefined && !sameValue(existing[field], next[field])) {
      updated[field] = { from: toChangeValue(existing[field]), to: toChangeValue(next[field]) };
    }
  }
  // Descriptions may contain anything; record that they changed, never their content.
  if (next.description !== undefined && next.description !== existing.description) {
    updated.description = { from: null, to: null };
  }
  if (Object.keys(updated).length > 0) {
    events.push({ type: "TASK_UPDATED", changes: { task: { title }, ...updated } });
  }

  if (events.length === 0) return existing;
  const task = await tx.task.update({ where: { id: existing.id }, data: next });
  for (const event of events) await record(tx, deps, task, event.type, event.changes);
  const assignment = (
    events.find((event) => event.type === "TASK_ASSIGNMENT_CHANGED")?.changes as
      { assignee: { from: Person; to: Person } } | undefined
  )?.assignee;
  if (assignment) {
    await recordAudit(tx, deps.ctx, {
      action: assignment.to ? "task.assigned" : "task.unassigned",
      resourceId: task.id,
      metadata: { title: task.title, projectId: task.projectId, assignee: assignment },
    });
  }
  return task;
}

export async function createTask(deps: Deps, projectId: string, input: TaskFields) {
  const { ctx, db } = deps;
  return db.$transaction(async (tx) => {
    await findProject(tx, projectId, { editable: true });
    const assignee = input.assigneeUserId
      ? await assigneeOf(tx, projectId, input.assigneeUserId)
      : null;
    const task = await tx.task.create({
      data: { ...input, projectId, organizationId: ctx.organization.id },
    });
    await record(tx, deps, task, "TASK_CREATED", { task: { title: task.title }, assignee });
    if (assignee) {
      await recordAudit(tx, ctx, {
        action: "task.assigned",
        resourceId: task.id,
        metadata: {
          title: task.title,
          projectId,
          assignee: { from: null, to: assignee },
          onCreate: true,
        },
      });
    }
    return task;
  });
}

/** Replace a task's editable fields (the edit form sends all of them). */
export async function updateTask(deps: Deps, id: string, input: TaskFields) {
  return deps.db.$transaction(async (tx) =>
    applyChanges(tx, deps, await findTaskForChange(tx, id), input),
  );
}

/**
 * Move a task to another column, atomically. With `fromStatus` this is a
 * compare-and-set: if the task is no longer in that column (someone else
 * moved it), nothing changes and the caller gets a 409 to roll back.
 */
export async function moveTask(
  deps: Deps,
  id: string,
  status: TaskStatus,
  fromStatus?: TaskStatus,
) {
  return deps.db.$transaction(async (tx) => {
    const existing = await findTaskForChange(tx, id);
    const conflict = () =>
      new ConflictError("This task was moved by someone else. Refresh to see its current column.");
    if (fromStatus && existing.status !== fromStatus) throw conflict();
    if (existing.status === status) return existing;

    const { count } = await tx.task.updateMany({
      where: { id, status: existing.status },
      data: { status },
    });
    if (count === 0) throw conflict();
    await record(tx, deps, existing, "TASK_STATUS_CHANGED", {
      task: { title: existing.title },
      status: { from: existing.status, to: status },
    });
    return { ...existing, status };
  });
}

/** Assign to a member of the task's project, or unassign with null. */
export async function assignTask(deps: Deps, id: string, assigneeUserId: string | null) {
  return deps.db.$transaction(async (tx) =>
    applyChanges(tx, deps, await findTaskForChange(tx, id), { assigneeUserId }),
  );
}

export async function setTaskPriority(deps: Deps, id: string, priority: TaskFields["priority"]) {
  return deps.db.$transaction(async (tx) =>
    applyChanges(tx, deps, await findTaskForChange(tx, id), { priority }),
  );
}

/**
 * Delete a task. Its history stays in the project activity (TASK_* rows keep
 * the task id and title), including a TASK_DELETED entry.
 */
export async function deleteTask(deps: Deps, id: string) {
  return deps.db.$transaction(async (tx) => {
    const existing = await findTaskForChange(tx, id);
    await tx.task.delete({ where: { id } });
    await record(tx, deps, existing, "TASK_DELETED", { task: { title: existing.title } });
    await recordAudit(tx, deps.ctx, {
      action: "task.deleted",
      resourceId: id,
      metadata: { title: existing.title, projectId: existing.projectId, status: existing.status },
    });
    return { id, projectId: existing.projectId };
  });
}

/** Task with its project and assignee. 404 if not in this organization. */
export async function getTask(db: TenantDb, id: string) {
  const task = await db.task.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true, status: true } },
      assignee: {
        select: { membership: { select: { user: { select: { name: true, email: true } } } } },
      },
    },
  });
  return task ?? taskNotFound();
}

function boardWhere(projectId: string, query: Partial<TaskBoardQuery>): Prisma.TaskWhereInput {
  const filters: Prisma.TaskWhereInput[] = [{ projectId }];
  if (query.q) {
    const term = { contains: escapeLikePattern(query.q), mode: "insensitive" as const };
    filters.push({ OR: [{ title: term }, { description: term }] });
  }
  if (query.assignee) {
    filters.push({
      assigneeUserId: query.assignee === UNASSIGNED_FILTER ? null : query.assignee,
    });
  }
  if (query.priority) filters.push({ priority: query.priority });
  return { AND: filters };
}

export type BoardTask = Awaited<ReturnType<typeof listProjectTasks>>["tasks"][number];

/**
 * All (filtered) tasks of a project for the Kanban board, in a constant number
 * of queries. Within a column: most urgent first, then earliest due date.
 */
export async function listProjectTasks(
  db: TenantDb,
  projectId: string,
  query: Partial<TaskBoardQuery> = {},
) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new NotFoundError("Project not found");

  const tasks = await db.task.findMany({
    where: boardWhere(projectId, query),
    orderBy: [
      { priority: "desc" },
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    take: BOARD_TASK_LIMIT + 1,
    select: cardSelect,
  });
  const truncated = tasks.length > BOARD_TASK_LIMIT;
  return { tasks: truncated ? tasks.slice(0, BOARD_TASK_LIMIT) : tasks, truncated };
}

/** A task's history (most recent first). 404 if the task is not in this organization. */
export async function listTaskActivity(db: TenantDb, taskId: string, limit = 30) {
  // Existence check only (the page has already loaded the task with its relations).
  const task = await db.task.findUnique({ where: { id: taskId }, select: { id: true } });
  if (!task) taskNotFound();
  return db.projectActivity.findMany({
    where: { taskId },
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
