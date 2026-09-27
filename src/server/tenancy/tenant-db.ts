import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { TenantIsolationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { scopeArgs } from "@/server/tenancy/scope";

function rejectRawQuery(): never {
  throw new TenantIsolationError("Raw SQL is not allowed through the tenant client");
}

function tenantExtension(organizationId: string) {
  return Prisma.defineExtension({
    name: "tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          let scoped;
          try {
            scoped = scopeArgs({ model, operation, args, organizationId });
          } catch (error) {
            if (error instanceof TenantIsolationError) {
              logger.warn("Tenant isolation violation rejected", {
                organizationId,
                model,
                operation,
                reason: error.message,
              });
            }
            throw error;
          }
          return query(scoped as typeof args);
        },
      },
      $queryRaw: rejectRawQuery,
      $executeRaw: rejectRawQuery,
      $queryRawUnsafe: rejectRawQuery,
      $executeRawUnsafe: rejectRawQuery,
    },
  });
}

/** Wrap a Prisma client so every query is confined to one organization. */
export function createTenantDb(db: PrismaClient, organizationId: string) {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TenantIsolationError("A tenant client requires an organization id");
  }
  return db.$extends(tenantExtension(organizationId));
}

export type TenantDb = ReturnType<typeof createTenantDb>;

/**
 * Database access for one organization. This is the only way application
 * code should read or write tenant-owned data.
 *
 * `organizationId` must come from the server-resolved tenant context
 * (session + membership), never directly from request input.
 */
export function getTenantDb(organizationId: string): TenantDb {
  return createTenantDb(getDb(), organizationId);
}
