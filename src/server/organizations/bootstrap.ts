import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  organizationNameSchema,
  organizationSlugSchema,
  slugify,
} from "@/lib/validation/organization";

/**
 * Input accepted from the browser. Unknown keys (e.g. `userId`, `role`,
 * `organizationId`) are stripped: ownership always comes from the session.
 */
export const createOrganizationInput = z.object({
  name: organizationNameSchema,
  slug: z
    .union([organizationSlugSchema, z.literal("")])
    .optional()
    .transform((value) => value || undefined),
});

export type CreateOrganizationInput = { name: string; slug?: string };

/**
 * Create an organization with `userId` as its OWNER, atomically: either both
 * rows exist or neither does. `userId` must come from the authenticated
 * session. Uses the unscoped client because the organization does not exist
 * yet (this module is on the ESLint raw-database allowlist).
 */
export async function createOrganization(userId: string, input: CreateOrganizationInput) {
  const slug = input.slug ?? slugify(input.name);
  const parsedSlug = organizationSlugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    throw new ValidationError("Choose a URL for your organization", {
      details: [{ path: "slug", message: parsedSlug.error.issues[0]?.message }],
    });
  }

  try {
    return await getDb().$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.name, slug: parsedSlug.data },
        select: { id: true, slug: true, name: true },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId, role: "OWNER" },
      });
      return organization;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("That organization URL is already taken", {
        details: [{ path: "slug", message: "Already taken" }],
        cause: error,
      });
    }
    throw error;
  }
}
