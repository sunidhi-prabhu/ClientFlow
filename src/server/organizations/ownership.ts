import "server-only";

import { type MembershipRole } from "@/generated/prisma/enums";
import { NotFoundError, OwnerRequiredError } from "@/lib/errors";
import { assertCanChangeRole, assertCanRemoveMember, permissionsFor } from "@/lib/permissions";
import { recordAudit } from "@/server/audit/service";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Membership changes that must keep at least one OWNER per organization.
 * Always change or remove memberships through these functions: they check in
 * the application first (clear 409) and the database trigger remains the
 * final backstop (also mapped to 409 by toAppError, e.g. for races).
 *
 * They take the tenant-scoped client, so a membership of another organization
 * is simply not found.
 *
 * `actor` is required. For a member (a request's tenant context), the
 * escalation rules are enforced here, so no caller can forget them:
 * `member:update-role` + assertCanChangeRole, `member:remove` +
 * assertCanRemoveMember. `SYSTEM_ACTOR` is for maintenance code only (no
 * request, no role checks) and is recorded as such.
 *
 * Every change is audited in the same transaction (member.role_changed with
 * the permissions granted and revoked, member.removed).
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

/** Maintenance code (scripts, migrations): no request and no role to check. */
export const SYSTEM_ACTOR = { system: true } as const;

export type MembershipActor =
  Pick<TenantContext, "userId" | "role" | "membership"> | typeof SYSTEM_ACTOR;

function isMember(
  actor: MembershipActor,
): actor is Pick<TenantContext, "userId" | "role" | "membership"> {
  return !("system" in actor);
}

function auditContext(organizationId: string, actor: MembershipActor) {
  return { organizationId, actorUserId: isMember(actor) ? actor.userId : null };
}
type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/** The member as recorded in the audit log (name and email at the time of the change). */
async function auditedMember(tx: Tx, membershipId: string) {
  const member = await tx.membership.findUnique({
    where: { id: membershipId },
    select: {
      organizationId: true,
      userId: true,
      role: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!member) throw new NotFoundError("Member not found");
  return member;
}

export async function changeMembershipRole(
  db: TenantDb,
  membershipId: string,
  role: MembershipRole,
  actor: MembershipActor,
) {
  return db.$transaction(async (tx) => {
    const before = await auditedMember(tx, membershipId);
    if (isMember(actor)) {
      assertCanChangeRole({
        actorRole: actor.role,
        actorIsTarget: actor.membership.id === membershipId,
        targetCurrentRole: before.role,
        newRole: role,
      });
    }
    await assertOrganizationKeepsOwner(tx, membershipId, role);
    const updated = await tx.membership.update({ where: { id: membershipId }, data: { role } });
    if (before.role !== role) {
      const previous = new Set(permissionsFor(before.role));
      const next = new Set(permissionsFor(role));
      await recordAudit(tx, auditContext(before.organizationId, actor), {
        action: "member.role_changed",
        resourceId: membershipId,
        metadata: {
          member: { userId: before.userId, ...before.user },
          role: { from: before.role, to: role },
          // A role is the member's set of permissions; record exactly what changed.
          permissions: {
            granted: [...next].filter((permission) => !previous.has(permission)),
            revoked: [...previous].filter((permission) => !next.has(permission)),
          },
          ...(isMember(actor) ? {} : { via: "system" }),
        },
      });
    }
    return updated;
  });
}

export async function removeMembership(db: TenantDb, membershipId: string, actor: MembershipActor) {
  return db.$transaction(async (tx) => {
    const member = await auditedMember(tx, membershipId);
    if (isMember(actor)) {
      assertCanRemoveMember({
        actorRole: actor.role,
        actorIsTarget: actor.membership.id === membershipId,
        targetRole: member.role,
      });
    }
    await assertOrganizationKeepsOwner(tx, membershipId, null);
    const removed = await tx.membership.delete({ where: { id: membershipId } });
    await recordAudit(tx, auditContext(member.organizationId, actor), {
      action: "member.removed",
      resourceId: membershipId,
      metadata: {
        member: { userId: member.userId, ...member.user },
        role: member.role,
        permissionsRevoked: permissionsFor(member.role),
        ...(isMember(actor) ? {} : { via: "system" }),
      },
    });
    return removed;
  });
}
