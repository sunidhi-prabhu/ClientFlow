import "server-only";

import {
  type BillingState,
  entitlementsFor,
  type LimitedResource,
  limitReachedMessage,
  usageOf,
} from "@/lib/billing";
import { PlanLimitError } from "@/lib/errors";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Plan limits (tenant client only, no billing provider). The limits come from
 * the organization's stored billing state (written by ./sync.ts from
 * subscription data read back from the payment provider), never from a request. Archived clients and projects do not
 * count; existing records are never blocked, only additions.
 */

/** The tenant client or a transaction on it. */
type Db = Pick<TenantDb, "subscription" | "client" | "project" | "organization">;

export async function getBillingState(db: Pick<TenantDb, "subscription">) {
  return db.subscription.findFirst();
}

/** Active = not archived (archived records never count toward a limit). */
export async function countActive(db: Pick<Db, "client" | "project">) {
  const [clients, projects] = await Promise.all([
    db.client.count({ where: { status: { not: "ARCHIVED" } } }),
    db.project.count({ where: { status: { not: "ARCHIVED" } } }),
  ]);
  return { clients, projects };
}

/** Usage of one resource (list and form pages). */
export async function getUsage(db: TenantDb, resource: LimitedResource) {
  const [state, counts] = await Promise.all([getBillingState(db), countActive(db)]);
  const entitlements = entitlementsFor(state as BillingState);
  return { plan: entitlements.plan, ...usageOf(counts[resource], entitlements.limits[resource]) };
}

/**
 * Throw `PlanLimitError` if adding one more active `resource` would exceed the
 * organization's plan. Call inside the transaction that adds (or restores) the
 * record: it locks the organization row first, so concurrent additions are
 * checked one after another and cannot both slip under the limit.
 */
export async function assertWithinPlanLimit(
  tx: Db,
  ctx: TenantContext,
  resource: LimitedResource,
  operation: "add" | "restore" = "add",
) {
  await tx.organization.update({
    where: { id: ctx.organization.id },
    data: { updatedAt: new Date() },
    select: { id: true },
  });
  const state = await tx.subscription.findFirst({ select: { plan: true, status: true } });
  const limit = entitlementsFor(state).limits[resource];
  const used = await (resource === "clients"
    ? tx.client.count({ where: { status: { not: "ARCHIVED" } } })
    : tx.project.count({ where: { status: { not: "ARCHIVED" } } }));
  if (used >= limit) {
    throw new PlanLimitError(limitReachedMessage(resource, limit, operation), {
      resource,
      limit,
      used,
    });
  }
}
