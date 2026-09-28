import { z } from "zod";

import { AUDIT_ACTION_NAMES, AUDIT_RESOURCE_TYPES } from "@/lib/audit";

export const DEFAULT_AUDIT_PAGE_SIZE = 25;

/** `YYYY-MM-DD` → UTC midnight; anything else is ignored. */
const day = z.iso
  .date()
  .optional()
  .catch(undefined)
  .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : undefined));

const optionalId = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9_-]*$/)
  .optional()
  .catch(undefined)
  .transform((value) => (value ? value : undefined));

/**
 * Audit log filters from the URL. Invalid values fall back to "no filter" so
 * a hand-edited URL still renders. Nothing here selects the organization.
 */
export const listAuditLogQuery = z.object({
  from: day,
  to: day,
  actorId: optionalId,
  action: z.enum(AUDIT_ACTION_NAMES).optional().catch(undefined),
  resourceType: z.enum(AUDIT_RESOURCE_TYPES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .catch(DEFAULT_AUDIT_PAGE_SIZE)
    .default(DEFAULT_AUDIT_PAGE_SIZE),
});

export type ListAuditLogQuery = z.infer<typeof listAuditLogQuery>;

export function parseListAuditLogQuery(
  searchParams: Record<string, string | string[] | undefined>,
): ListAuditLogQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return listAuditLogQuery.parse({
    from: first(searchParams.from),
    to: first(searchParams.to),
    actorId: first(searchParams.actorId),
    action: first(searchParams.action),
    resourceType: first(searchParams.resourceType),
    page: first(searchParams.page),
    pageSize: first(searchParams.pageSize),
  });
}
