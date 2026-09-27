import "server-only";

import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";

export type UserOrganization = {
  id: string;
  slug: string;
  name: string;
  role: MembershipRole;
};

/**
 * The organizations a user belongs to (for the organization switcher and
 * post-sign-in routing). Inherently cross-organization, so it uses the
 * unscoped client, filtered by the user id from the server-side session.
 */
export async function listUserOrganizations(userId: string): Promise<UserOrganization[]> {
  const memberships = await getDb().membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
  });
  return memberships.map(({ role, organization }) => ({ ...organization, role }));
}
