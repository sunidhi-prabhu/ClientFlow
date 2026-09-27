import "server-only";

import { type MembershipRole } from "@/generated/prisma/enums";
import { NotFoundError, OwnerRequiredError } from "@/lib/errors";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Membership changes that must keep at least one OWNER per organization.
 * Always change or remove memberships through these functions: they check in
 * the application first (clear 409) and the database trigger remains the
 * final backstop (also mapped to 409 by toAppError, e.g. for races).
 *
 * They take the tenant-scoped client, so a membership of another organization
 * is simply not found. Authorization (who may change whom) is the caller's
 * job: `member:update-role` / `member:remove` plus assertCanChangeRole.
 */

type MembershipDb = Pick<TenantDb, "membership">;

/**
 * Throws OwnerRequiredError if giving `membershipId` the role `newRole`
 * (or removing it, when `newRole` is null) would leave no OWNER.
 */
export async function assertOrganizationKeepsOwner(
  db: MembershipDb,
  membershipId: string,
  newRole: MembershipRole | null,
) {
  const membership = await db.membership.findUnique({
    where: { id: membershipId },
    select: { id: true, role: true },
  });
  if (!membership) throw new NotFoundError("Member not found");
  if (membership.role !== "OWNER" || newRole === "OWNER") return membership;

  const otherOwners = await db.membership.count({
    where: { role: "OWNER", id: { not: membership.id } },
  });
  if (otherOwners === 0) throw new OwnerRequiredError();
  return membership;
}

export async function changeMembershipRole(
  db: TenantDb,
  membershipId: string,
  role: MembershipRole,
) {
  return db.$transaction(async (tx) => {
    await assertOrganizationKeepsOwner(tx, membershipId, role);
    return tx.membership.update({ where: { id: membershipId }, data: { role } });
  });
}

export async function removeMembership(db: TenantDb, membershipId: string) {
  return db.$transaction(async (tx) => {
    await assertOrganizationKeepsOwner(tx, membershipId, null);
    return tx.membership.delete({ where: { id: membershipId } });
  });
}
