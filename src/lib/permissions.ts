import { MembershipRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/lib/errors";

/**
 * Centralized RBAC policy. Pure and dependency-free so the server can enforce
 * it (`assertPermission`, used by the protected action/route wrappers) and UI
 * code can use `hasPermission` to hide actions. The server is always the
 * authority; hiding a button is never a security control.
 *
 * Permissions are named `<resource>:<action>`. Code checks permissions,
 * never `role === "ADMIN"`.
 */
export const PERMISSIONS = [
  // Organization management
  "organization:read",
  "organization:update",
  "organization:delete",
  // Member management
  "member:read",
  "member:invite",
  "member:update-role",
  "member:remove",
  // Client management
  "client:read",
  "client:create",
  "client:update",
  "client:delete",
  // Project management
  "project:read",
  "project:create",
  "project:update",
  "project:delete",
  // Task management
  "task:read",
  "task:create",
  "task:update",
  "task:delete",
  // Invoice management
  "invoice:read",
  "invoice:create",
  "invoice:update",
  "invoice:delete",
  "invoice:send",
  // Reports
  "report:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Role = MembershipRole;

export const ROLES = Object.values(MembershipRole) as Role[];

const MANAGER_PERMISSIONS = [
  "organization:read",
  "member:read",
  "client:read",
  "client:create",
  "client:update",
  "client:delete",
  "project:read",
  "project:create",
  "project:update",
  "project:delete",
  "task:read",
  "task:create",
  "task:update",
  "task:delete",
  "invoice:read",
  "invoice:create",
  "invoice:update",
  "invoice:send",
  "report:read",
] as const satisfies readonly Permission[];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  // Everything, including deleting the organization.
  OWNER: new Set(PERMISSIONS),
  // Everything except deleting the organization.
  ADMIN: new Set(PERMISSIONS.filter((permission) => permission !== "organization:delete")),
  // Day-to-day client, project, task and invoice work. No organization
  // settings, no member administration, no invoice deletion.
  MANAGER: new Set(MANAGER_PERMISSIONS),
  // Works on projects and tasks. No invoices, reports or administration.
  MEMBER: new Set([
    "organization:read",
    "member:read",
    "client:read",
    "project:read",
    "task:read",
    "task:create",
    "task:update",
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError();
  }
}

const ROLE_RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, MANAGER: 2, MEMBER: 1 };

/**
 * Role-change rules (prevent privilege escalation):
 * - requires `member:update-role`;
 * - nobody changes their own role;
 * - only an OWNER may grant OWNER or change an OWNER's role;
 * - otherwise an actor may only manage members ranked below them and may
 *   only grant roles up to their own rank.
 * "At least one OWNER" is additionally enforced by the database.
 */
export function canChangeRole(input: {
  actorRole: Role;
  actorIsTarget: boolean;
  targetCurrentRole: Role;
  newRole: Role;
}): boolean {
  const { actorRole, actorIsTarget, targetCurrentRole, newRole } = input;
  if (!hasPermission(actorRole, "member:update-role")) return false;
  if (actorIsTarget) return false;
  if (actorRole === "OWNER") return true;
  if (targetCurrentRole === "OWNER" || newRole === "OWNER") return false;
  return (
    ROLE_RANK[targetCurrentRole] < ROLE_RANK[actorRole] &&
    ROLE_RANK[newRole] <= ROLE_RANK[actorRole]
  );
}

export function assertCanChangeRole(input: Parameters<typeof canChangeRole>[0]): void {
  if (!canChangeRole(input)) {
    throw new ForbiddenError("You cannot assign this role");
  }
}
