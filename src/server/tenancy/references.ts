import "server-only";

import { ReferenceNotFoundError } from "@/lib/errors";
import { type ModelName, type modelPolicies } from "@/server/tenancy/models";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/** Client delegate names of tenant-owned models, e.g. "client" | "project". */
export type TenantModelKey = {
  [K in ModelName]: (typeof modelPolicies)[K]["scope"] extends "tenant" ? Uncapitalize<K> : never;
}[ModelName];

type IdLookup = {
  findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null>;
};

/**
 * Resolve a caller-supplied foreign id through the tenant-scoped client before
 * using it in a write, e.g. `await requireTenantRecord(db, "client", input.clientId)`
 * before creating a Project.
 *
 * Ids that do not exist and ids owned by another organization both throw the
 * same `ReferenceNotFoundError` (404), so responses never reveal other
 * tenants' data. The composite foreign keys still guard the write itself; if
 * the row disappears between this check and the write, the resulting P2003 is
 * mapped to the same error by `toAppError`.
 */
export async function requireTenantRecord(
  db: TenantDb,
  model: TenantModelKey,
  id: string,
): Promise<void> {
  if (typeof id !== "string" || id.length === 0) throw new ReferenceNotFoundError();

  const delegate = db[model] as unknown as IdLookup;
  const record = await delegate.findUnique({ where: { id }, select: { id: true } });
  if (!record) throw new ReferenceNotFoundError();
}
