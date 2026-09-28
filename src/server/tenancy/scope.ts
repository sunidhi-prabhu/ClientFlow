import { TenantIsolationError } from "@/lib/errors";
import { getModelPolicy, USER_RELATION_FIELDS, USER_SCALAR_FIELDS } from "@/server/tenancy/models";

/**
 * Pure argument rewriting for the tenant-scoped Prisma client. Kept free of
 * Prisma runtime so the rules can be unit-tested without a database.
 *
 * Rules:
 * - `where` (and `cursor`) always gets `organizationId = <current org>`.
 * - `create` data always gets `organizationId = <current org>`.
 * - A caller-supplied organization id that differs is rejected, never
 *   overwritten, so bugs surface instead of being masked.
 * - Write `data` may contain scalar columns only. Nested relation writes
 *   (`connect`, `create`, …) are rejected because they can re-parent rows
 *   across organizations; set foreign key columns (e.g. `clientId`) instead,
 *   which the composite foreign keys then verify.
 * - Append-only models (the audit log) reject every update, delete and upsert.
 * - Nested reads (`include` / `select`) may reach the global `User` model only
 *   for its own columns, never its sessions, accounts or other organizations'
 *   memberships and activity.
 * - Unknown models and operations are rejected (fail closed).
 */

type Args = Record<string, unknown>;

type ScopeInput = {
  model: string;
  operation: string;
  args: unknown;
  organizationId: string;
};

const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);
const UPDATE_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);
const DELETE_OPERATIONS = new Set(["delete", "deleteMany"]);
const CREATE_MANY_OPERATIONS = new Set(["createMany", "createManyAndReturn"]);

function isPlainObject(value: unknown): value is Args {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function reject(message: string): never {
  throw new TenantIsolationError(message);
}

/** A caller may name the scope column only with the current organization's id. */
function assertSameOrganization(value: unknown, organizationId: string, allowed: string[]) {
  if (value === organizationId) return;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && allowed.includes(keys[0]) && value[keys[0]] === organizationId) {
      return;
    }
  }
  reject("Query references a different organization");
}

function scopeWhere(where: unknown, field: string, organizationId: string): Args {
  if (where === undefined) return { [field]: organizationId };
  if (!isPlainObject(where)) reject("Invalid where clause");

  for (const [key, value] of Object.entries(where)) {
    if (key === field) {
      assertSameOrganization(value, organizationId, ["equals"]);
    } else if (key.split("_").includes(field) && isPlainObject(value) && field in value) {
      // Compound unique selector, e.g. `organizationId_id: { organizationId, id }`.
      assertSameOrganization(value[field], organizationId, []);
    }
  }
  return { ...where, [field]: organizationId };
}

function checkWriteData(
  data: unknown,
  field: string,
  organizationId: string,
  scalarFields: Readonly<Record<string, string>>,
): Args {
  if (!isPlainObject(data)) reject("Invalid data");

  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(scalarFields, key)) {
      reject(
        `Nested relation writes ("${key}") are not allowed through the tenant client; set foreign key columns instead`,
      );
    }
    if (key === field) assertSameOrganization(value, organizationId, ["set"]);
  }
  return data;
}

/** A relation to `User`: `true`, or `{ select: { <user column>: boolean } }`. */
function checkUserSelection(field: string, selection: unknown) {
  if (typeof selection === "boolean") return;
  if (isPlainObject(selection)) {
    const keys = Object.keys(selection);
    const columns = selection.select;
    if (
      keys.every((key) => key === "select") &&
      isPlainObject(columns) &&
      Object.entries(columns).every(
        ([column, value]) => USER_SCALAR_FIELDS.has(column) && typeof value === "boolean",
      )
    ) {
      return;
    }
  }
  reject(`Only user columns can be read through "${field}" with the tenant client`);
}

/** Walk `include` / `select` trees (including `_count`) and check every relation to `User`. */
function checkNestedReads(args: unknown) {
  if (!isPlainObject(args)) return;
  for (const key of ["include", "select"] as const) {
    const selection = args[key];
    if (!isPlainObject(selection)) continue;
    for (const [field, nested] of Object.entries(selection)) {
      if (USER_RELATION_FIELDS.has(field)) checkUserSelection(field, nested);
      else checkNestedReads(nested);
    }
  }
}

export function scopeArgs({ model, operation, args, organizationId }: ScopeInput): Args {
  const policy = getModelPolicy(model);
  if (!policy || policy.scope === "global") {
    reject(`Model "${model}" is not accessible through the tenant client`);
  }
  if (args !== undefined && !isPlainObject(args)) reject("Invalid query arguments");

  if (
    "appendOnly" in policy &&
    policy.appendOnly &&
    (UPDATE_OPERATIONS.has(operation) || DELETE_OPERATIONS.has(operation) || operation === "upsert")
  ) {
    reject(`${model} records cannot be modified or deleted`);
  }

  const input: Args = args ?? {};
  checkNestedReads(input);
  const isRoot = policy.scope === "organization";
  // The organization root is matched on its own id; tenant models on organizationId.
  const field = isRoot ? "id" : "organizationId";
  const { scalarFields } = policy;

  if (READ_OPERATIONS.has(operation) || DELETE_OPERATIONS.has(operation)) {
    if (isRoot && DELETE_OPERATIONS.has(operation)) {
      reject("Organizations cannot be deleted through the tenant client");
    }
    const scoped: Args = { ...input, where: scopeWhere(input.where, field, organizationId) };
    if (input.cursor !== undefined) {
      scoped.cursor = scopeWhere(input.cursor, field, organizationId);
    }
    return scoped;
  }

  if (UPDATE_OPERATIONS.has(operation)) {
    return {
      ...input,
      where: scopeWhere(input.where, field, organizationId),
      data: checkWriteData(input.data, field, organizationId, scalarFields),
    };
  }

  if (isRoot) {
    reject("Organizations cannot be created through the tenant client");
  }

  if (operation === "create") {
    const data = checkWriteData(input.data, field, organizationId, scalarFields);
    return { ...input, data: { ...data, organizationId } };
  }

  if (CREATE_MANY_OPERATIONS.has(operation)) {
    const rows = Array.isArray(input.data) ? input.data : [input.data];
    return {
      ...input,
      data: rows.map((row) => ({
        ...checkWriteData(row, field, organizationId, scalarFields),
        organizationId,
      })),
    };
  }

  if (operation === "upsert") {
    const create = checkWriteData(input.create, field, organizationId, scalarFields);
    return {
      ...input,
      where: scopeWhere(input.where, field, organizationId),
      create: { ...create, organizationId },
      update: checkWriteData(input.update, field, organizationId, scalarFields),
    };
  }

  reject(`Operation "${operation}" is not supported by the tenant client`);
}
