import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import { organizationSlugSchema } from "@/lib/validation/organization";
import { requireSession } from "@/server/auth/session";

export type TenantContext = {
  userId: string;
  organization: { id: string; slug: string; name: string };
  membership: { id: string; role: MembershipRole };
  /** Shorthand for `membership.role`. Always read from the database. */
  role: MembershipRole;
};

/**
 * Resolve which organization a user is acting in, from the database.
 *
 * `organizationSlug` is only a *selector* (from the URL); it grants nothing
 * by itself. Unknown organizations and organizations the user does not
 * belong to both yield the same 404, so other tenants cannot be discovered.
 */
export async function resolveTenantContext(
  userId: string,
  organizationSlug: unknown,
): Promise<TenantContext> {
  const slug = organizationSlugSchema.safeParse(organizationSlug);
  if (!slug.success) throw new NotFoundError("Organization not found");

  const membership = await getDb().membership.findFirst({
    where: { userId, organization: { slug: slug.data } },
    select: {
      id: true,
      role: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!membership) throw new NotFoundError("Organization not found");

  return {
    userId,
    organization: membership.organization,
    membership: { id: membership.id, role: membership.role },
    role: membership.role,
  };
}

/**
 * Tenant context for the current request: authenticated session (401 if
 * missing) → membership in the selected organization (404 if none). User id,
 * organization id and role all come from the server-side session and the
 * database, never from request data. Cached for the duration of a request.
 */
export const getTenantContext = cache(async (organizationSlug: string): Promise<TenantContext> => {
  const session = await requireSession();
  return resolveTenantContext(session.user.id, organizationSlug);
});

/**
 * `getTenantContext` for pages and layouts: signed-out visitors are sent to
 * sign-in; unknown or inaccessible organizations render the 404 page.
 */
export async function getTenantContextForPage(organizationSlug: string): Promise<TenantContext> {
  try {
    return await getTenantContext(organizationSlug);
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect("/sign-in");
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
