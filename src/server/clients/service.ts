import "server-only";

import { type ClientStatus } from "@/generated/prisma/enums";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { type ClientFields, type ListClientsQuery } from "@/lib/validation/client";
import { recordAudit } from "@/server/audit/service";
import { assertWithinPlanLimit } from "@/server/billing/limits";
import { escapeLikePattern } from "@/server/search";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Client management. Every function takes the tenant-scoped database client
 * (and, for writes, the tenant context for the acting user), so all queries
 * are confined to the caller's organization: another organization's client id
 * is indistinguishable from a nonexistent one (404).
 *
 * Authorization (client:read / create / update / delete) is enforced by the
 * callers through the request pipeline (tenantAction / tenantPage).
 */

type Deps = { ctx: TenantContext; db: TenantDb };

/** Fields shown in the client list. */
const listSelect = {
  id: true,
  name: true,
  company: true,
  email: true,
  phone: true,
  status: true,
  updatedAt: true,
} as const;

/** Fields whose previous and new values are recorded in the activity history. */
const TRACKED_FIELDS = ["name", "company", "email", "phone", "address", "status"] as const;

/** Recorded values are the field's string value or null (notes: always null). */
export type ClientChanges = Partial<
  Record<(typeof TRACKED_FIELDS)[number] | "notes", { from: string | null; to: string | null }>
>;

function notFound(): never {
  throw new NotFoundError("Client not found");
}

export async function getClient(db: TenantDb, id: string) {
  const client = await db.client.findUnique({ where: { id } });
  return client ?? notFound();
}

export async function createClient({ ctx, db }: Deps, input: ClientFields) {
  return db.$transaction(async (tx) => {
    await assertWithinPlanLimit(tx, ctx, "clients");
    const client = await tx.client.create({
      data: { ...input, organizationId: ctx.organization.id },
    });
    await tx.clientActivity.create({
      data: {
        organizationId: ctx.organization.id,
        clientId: client.id,
        actorUserId: ctx.userId,
        type: "CREATED",
      },
    });
    await recordAudit(tx, ctx, {
      action: "client.created",
      resourceId: client.id,
      metadata: { name: client.name, status: client.status },
    });
    return client;
  });
}

/** Replace a client's editable fields. Archived clients must be restored first. */
export async function updateClient({ ctx, db }: Deps, id: string, input: ClientFields) {
  return db.$transaction(async (tx) => {
    const existing = (await tx.client.findUnique({ where: { id } })) ?? notFound();
    if (existing.status === "ARCHIVED") {
      throw new ConflictError("Restore this client before editing it");
    }

    const changes: ClientChanges = {};
    for (const field of TRACKED_FIELDS) {
      if (existing[field] !== input[field])
        changes[field] = { from: existing[field], to: input[field] };
    }
    // Notes can be long; record that they changed, not their content.
    if (existing.notes !== input.notes) changes.notes = { from: null, to: null };
    if (Object.keys(changes).length === 0) return existing;

    // Compare-and-set: an archive committed meanwhile makes the client read-only.
    const { count } = await tx.client.updateMany({
      where: { id, status: { not: "ARCHIVED" } },
      data: input,
    });
    if (count === 0) throw new ConflictError("Restore this client before editing it");
    const client = await tx.client.findUniqueOrThrow({ where: { id } });
    await tx.clientActivity.create({
      data: {
        organizationId: ctx.organization.id,
        clientId: id,
        actorUserId: ctx.userId,
        type: "UPDATED",
        changes,
      },
    });
    await recordAudit(tx, ctx, {
      action: "client.updated",
      resourceId: id,
      metadata: { name: client.name, changes },
    });
    return client;
  });
}

async function setArchived({ ctx, db }: Deps, id: string, archive: boolean) {
  return db.$transaction(async (tx) => {
    const existing = (await tx.client.findUnique({ where: { id } })) ?? notFound();
    const isArchived = existing.status === "ARCHIVED";
    if (archive && isArchived) throw new ConflictError("This client is already archived");
    if (!archive && !isArchived) throw new ConflictError("This client is not archived");
    // A restored client is active again, so it counts toward the plan limit.
    if (!archive) await assertWithinPlanLimit(tx, ctx, "clients", "restore");

    const status: ClientStatus = archive ? "ARCHIVED" : "ACTIVE";
    // Compare-and-set on the status just read: a concurrent archive/restore wins, this one is a 409.
    const { count } = await tx.client.updateMany({
      where: { id, status: existing.status },
      data: { status, archivedAt: archive ? new Date() : null },
    });
    if (count === 0) {
      throw new ConflictError(
        archive ? "This client is already archived" : "This client is not archived",
      );
    }
    const client = await tx.client.findUniqueOrThrow({ where: { id } });
    await tx.clientActivity.create({
      data: {
        organizationId: ctx.organization.id,
        clientId: id,
        actorUserId: ctx.userId,
        type: archive ? "ARCHIVED" : "RESTORED",
        changes: { status: { from: existing.status, to: status } },
      },
    });
    await recordAudit(tx, ctx, {
      action: archive ? "client.archived" : "client.restored",
      resourceId: id,
      metadata: { name: client.name, status: { from: existing.status, to: status } },
    });
    return client;
  });
}

/** Archive (soft-delete) a client: hidden from the default list, kept for history. */
export function archiveClient(deps: Deps, id: string) {
  return setArchived(deps, id, true);
}

/** Undo an archive; the client becomes ACTIVE again. */
export function restoreClient(deps: Deps, id: string) {
  return setArchived(deps, id, false);
}

function statusWhere(status: ListClientsQuery["status"]) {
  switch (status) {
    case "current":
      return { status: { in: ["ACTIVE", "INACTIVE"] as ClientStatus[] } };
    case "all":
      return {};
    default:
      return { status };
  }
}

function searchWhere(q: string | undefined) {
  if (!q) return {};
  const term = escapeLikePattern(q);
  return {
    OR: (["name", "company", "email"] as const).map((field) => ({
      [field]: { contains: term, mode: "insensitive" as const },
    })),
  };
}

const ORDER_BY = {
  name: [{ name: "asc" }, { id: "asc" }],
  updated: [{ updatedAt: "desc" }, { id: "asc" }],
  created: [{ createdAt: "desc" }, { id: "asc" }],
} as const;

export type ClientListResult = Awaited<ReturnType<typeof listClients>>;

/**
 * Search, filter, sort and paginate the organization's clients. Pages beyond
 * the last one are clamped to the last page.
 */
export async function listClients(db: TenantDb, query: ListClientsQuery) {
  const where = { AND: [statusWhere(query.status), searchWhere(query.q)] };

  // One aggregate for both the per-status counts and the total (no separate COUNT).
  const statusGroups = await db.client.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: searchWhere(query.q),
  });
  const statusCounts: Record<ClientStatus, number> = { ACTIVE: 0, INACTIVE: 0, ARCHIVED: 0 };
  for (const group of statusGroups) statusCounts[group.status] = group._count._all;
  const total =
    query.status === "all"
      ? statusCounts.ACTIVE + statusCounts.INACTIVE + statusCounts.ARCHIVED
      : query.status === "current"
        ? statusCounts.ACTIVE + statusCounts.INACTIVE
        : statusCounts[query.status];

  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const items = await db.client.findMany({
    where,
    select: listSelect,
    orderBy: [...ORDER_BY[query.sort]],
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
  });

  return { items, total, page, pageSize: query.pageSize, pageCount, statusCounts };
}

/** Most recent first. 404 if the client is not in this organization. */
export async function listClientActivity(db: TenantDb, clientId: string, limit = 20) {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) notFound();
  return db.clientActivity.findMany({
    where: { clientId },
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

/** The client's projects (read-only; project management is a later module). */
export async function listClientProjects(db: TenantDb, clientId: string) {
  return db.project.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true },
  });
}
