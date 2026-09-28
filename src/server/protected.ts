import "server-only";

import { unstable_rethrow } from "next/navigation";
import { type z } from "zod";

import { toActionError, withErrorHandling } from "@/lib/api/handle-error";
import { BadRequestError, type ActionResult } from "@/lib/errors";
import { assertPermission, hasPermission, type Permission } from "@/lib/permissions";
import { requireSession, type AuthSession } from "@/server/auth/session";
import {
  getTenantContext,
  getTenantContextForPage,
  type TenantContext,
} from "@/server/tenancy/context";
import { getTenantDb, type TenantDb } from "@/server/tenancy/tenant-db";

/**
 * The one request pipeline for protected Server Actions and Route Handlers:
 *
 *   authenticated session → tenant context → permission check
 *   → input validation → business operation → error handling
 *
 * Handlers receive only server-derived identity (`ctx`) and an
 * organization-scoped database client (`db`). User id, organization id and
 * role are never read from input; schemas strip unknown keys, so values like
 * `{ role: "OWNER", organizationId: "…" }` in a request have no effect.
 */

type TenantHandlerArgs<Input> = { ctx: TenantContext; db: TenantDb; input: Input };

type TenantOptions<Schema extends z.ZodType> = {
  permission: Permission;
  input: Schema;
};

/** The shared pipeline. Input is read only after authorization succeeds. */
async function runTenantPipeline<Schema extends z.ZodType, Result>(
  organizationSlug: string,
  options: TenantOptions<Schema>,
  readInput: () => unknown,
  handler: (args: TenantHandlerArgs<z.infer<Schema>>) => Promise<Result>,
): Promise<Result> {
  const ctx = await getTenantContext(organizationSlug);
  assertPermission(ctx.role, options.permission);
  const input = options.input.parse(await readInput());
  return handler({ ctx, db: getTenantDb(ctx.organization.id), input });
}

/**
 * Server Action acting inside an organization. The returned action takes the
 * organization slug (a selector, verified against the user's membership) and
 * the raw input. Expected failures come back as `ActionResult` errors;
 * `redirect()`/`notFound()` from the handler work as usual.
 */
export function tenantAction<Schema extends z.ZodType, Result>(
  options: TenantOptions<Schema>,
  handler: (args: TenantHandlerArgs<z.infer<Schema>>) => Promise<Result>,
) {
  return async (organizationSlug: string, rawInput: unknown): Promise<ActionResult<Result>> => {
    try {
      const data = await runTenantPipeline(organizationSlug, options, () => rawInput, handler);
      return { ok: true, data };
    } catch (error) {
      unstable_rethrow(error);
      return toActionError(error);
    }
  };
}

/**
 * Server Action that needs a signed-in user but no organization yet
 * (e.g. creating the first organization).
 */
export function authenticatedAction<Schema extends z.ZodType, Result>(
  options: { input: Schema },
  handler: (args: { session: AuthSession; input: z.infer<Schema> }) => Promise<Result>,
) {
  return async (rawInput: unknown): Promise<ActionResult<Result>> => {
    try {
      const session = await requireSession();
      const input = options.input.parse(rawInput);
      return { ok: true, data: await handler({ session, input }) };
    } catch (error) {
      unstable_rethrow(error);
      return toActionError(error);
    }
  };
}

type OrganizationRouteContext = { params: Promise<{ orgSlug: string }> };

async function readRequestInput(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") {
    return Object.fromEntries(new URL(request.url).searchParams);
  }
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }
}

/**
 * Route Handler under `/api/o/[orgSlug]/…`. Errors become the standard JSON
 * error response via `withErrorHandling`.
 */
export function tenantRoute<Schema extends z.ZodType, Context extends OrganizationRouteContext>(
  options: TenantOptions<Schema>,
  handler: (
    args: TenantHandlerArgs<z.infer<Schema>> & {
      request: Request;
      /** All route params (e.g. `invoiceId`); ids in them must be looked up via `db`. */
      params: Awaited<Context["params"]>;
    },
  ) => Promise<Response>,
) {
  return withErrorHandling(async (request: Request, context: Context) => {
    const params = (await context.params) as Awaited<Context["params"]>;
    return runTenantPipeline(
      params.orgSlug,
      options,
      () => readRequestInput(request),
      (args) => handler({ ...args, request, params }),
    );
  });
}

export type TenantPageAccess =
  { allowed: true; ctx: TenantContext; db: TenantDb } | { allowed: false; ctx: TenantContext };

/**
 * Pages (Server Components) inside `/o/[orgSlug]`: signed-out visitors are
 * redirected to sign-in, non-members get the 404 page, and members whose role
 * lacks `permission` get `{ allowed: false }` so the page can render a
 * "no access" state (Next.js `forbidden()` is still experimental). The
 * database client is only handed out when access is allowed.
 */
export async function tenantPage(
  organizationSlug: string,
  permission: Permission,
): Promise<TenantPageAccess> {
  const ctx = await getTenantContextForPage(organizationSlug);
  if (!hasPermission(ctx.role, permission)) return { allowed: false, ctx };
  return { allowed: true, ctx, db: getTenantDb(ctx.organization.id) };
}
