import "server-only";

import { type Prisma } from "@/generated/prisma/client";
import { AUDIT_ACTIONS, type AuditAction, sanitizeAuditMetadata } from "@/lib/audit";
import { type ListAuditLogQuery } from "@/lib/validation/audit";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * The one place audit records are built and written.
 *
 * - The actor is always the server-resolved identity (`ctx.userId` from the
 *   session), never a value from the request.
 * - The organization is stamped by the tenant-scoped client the caller
 *   passes in (resolved from the session and membership), so a record cannot
 *   be written for another organization.
 * - Business operations pass their transaction client, so the change and its
 *   audit record commit or roll back together.
 * - Metadata is sanitized: credential-like keys are dropped at any depth.
 *
 * No route or Server Action writes audit records directly, and records can
 * never be updated or deleted (tenant client + database trigger).
 */

/**
 * Where and by whom: the organization and the authenticated user, both from
 * the server-resolved tenant context. `actorUserId` is null only for events
 * without an authenticated actor (e.g. a failed sign-in).
 */
export type AuditContext = { organizationId: string; actorUserId: string | null };

export type AuditEvent = {
  action: AuditAction;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/** A tenant client or a transaction on one; only the audit table is used. */
type AuditWriter = { auditLog: Pick<TenantDb["auditLog"], "create"> };

/** The acting member of a request (tenant context) as an audit context. */
export function auditContextOf(ctx: TenantContext): AuditContext {
  return { organizationId: ctx.organization.id, actorUserId: ctx.userId };
}

/** Row data for one event. */
export function auditRecordData(context: AuditContext, event: AuditEvent) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.actorUserId,
    action: event.action,
    resourceType: AUDIT_ACTIONS[event.action].resourceType,
    resourceId: event.resourceId ?? null,
    metadata: sanitizeAuditMetadata(event.metadata) as Prisma.InputJsonObject,
  };
}

/**
 * Record an event inside the caller's transaction. With the tenant client, an
 * organization id that differs from the client's own is rejected.
 */
export async function recordAudit(
  db: AuditWriter,
  context: TenantContext | AuditContext,
  event: AuditEvent,
) {
  const resolved = "organization" in context ? auditContextOf(context) : context;
  await db.auditLog.create({ data: auditRecordData(resolved, event), select: { id: true } });
}

/** Filter value for events without an actor. */
export const NO_ACTOR = "none";

function where(query: ListAuditLogQuery): Prisma.AuditLogWhereInput {
  return {
    ...(query.actorId === NO_ACTOR
      ? { actorUserId: null }
      : query.actorId
        ? { actorUserId: query.actorId }
        : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            // `to` is an inclusive calendar day (UTC).
            ...(query.to ? { lt: new Date(query.to.getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
  };
}

export type AuditLogPage = Awaited<ReturnType<typeof listAuditLog>>;

/** Newest first, filtered and paginated in the database (actor names in the same round trip). */
/**
 * Counting (and paging) stops here. The audit log grows with every change and
 * sign-in, and an exact count or a deep OFFSET is linear in its size; beyond
 * this many matching events the page shows "10,000+" and the newest 10,000
 * (narrow the date range to reach older ones). Below it, behavior is exact.
 */
export const AUDIT_COUNT_LIMIT = 10_000;

const NEWEST_FIRST: Prisma.AuditLogOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

export async function listAuditLog(db: TenantDb, query: ListAuditLogQuery) {
  const filter = where(query);
  // Ordered like the page (Prisma otherwise orders a limited count by id): every
  // filter's (organizationId, …, createdAt) index then yields rows in this order,
  // so counting stops after LIMIT rows instead of sorting all matches first.
  const counted = await db.auditLog.count({
    where: filter,
    orderBy: NEWEST_FIRST,
    take: AUDIT_COUNT_LIMIT + 1,
  });
  const totalIsCapped = counted > AUDIT_COUNT_LIMIT;
  const total = Math.min(counted, AUDIT_COUNT_LIMIT);
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const items = await db.auditLog.findMany({
    where: filter,
    orderBy: NEWEST_FIRST,
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      metadata: true,
      createdAt: true,
      actorUserId: true,
      actor: { select: { name: true, email: true } },
    },
  });
  return { items, total, totalIsCapped, page, pageSize: query.pageSize, pageCount };
}

/** Current members, for the actor filter. */
export async function listAuditActors(db: TenantDb) {
  const memberships = await db.membership.findMany({
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return memberships.map(({ userId, user }) => ({ id: userId, ...user }));
}
