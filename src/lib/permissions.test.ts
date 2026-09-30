import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import {
  assertCanChangeRole,
  assertPermission,
  canChangeRole,
  canRemoveMember,
  hasPermission,
  PERMISSIONS,
  permissionsFor,
  ROLES,
  type Role,
} from "@/lib/permissions";

describe("role permissions", () => {
  it("OWNER has every permission", () => {
    expect(permissionsFor("OWNER")).toEqual([...PERMISSIONS]);
  });

  it("ADMIN has everything except deleting the organization", () => {
    expect(permissionsFor("ADMIN")).toEqual(
      PERMISSIONS.filter((permission) => permission !== "organization:delete"),
    );
  });

  it("MANAGER runs clients, projects, tasks and invoices but not the organization or members", () => {
    for (const permission of [
      "client:create",
      "client:delete",
      "project:create",
      "project:delete",
      "task:delete",
      "invoice:create",
      "invoice:send",
      "report:read",
    ] as const) {
      expect(hasPermission("MANAGER", permission)).toBe(true);
    }
    for (const permission of [
      "organization:update",
      "organization:delete",
      "member:invite",
      "member:update-role",
      "member:remove",
      "invoice:delete",
    ] as const) {
      expect(hasPermission("MANAGER", permission)).toBe(false);
    }
  });

  it("MEMBER can read and work on tasks only", () => {
    expect(permissionsFor("MEMBER")).toEqual([
      "organization:read",
      "member:read",
      "client:read",
      "project:read",
      "task:read",
      "task:create",
      "task:update",
    ]);
  });

  it("roles are strictly nested: each role has everything the role below has", () => {
    const order: Role[] = ["MEMBER", "MANAGER", "ADMIN", "OWNER"];
    for (let index = 1; index < order.length; index++) {
      const lower = new Set(permissionsFor(order[index - 1]));
      const higher = new Set(permissionsFor(order[index]));
      expect([...lower].filter((permission) => !higher.has(permission))).toEqual([]);
    }
  });

  it("covers every role in the database enum", () => {
    expect([...ROLES].sort()).toEqual(["ADMIN", "MANAGER", "MEMBER", "OWNER"]);
  });

  it("denies unknown roles and permissions (fail closed)", () => {
    expect(hasPermission("SUPERUSER" as Role, "client:read")).toBe(false);
    expect(hasPermission("OWNER", "client:hack" as never)).toBe(false);
  });

  it("assertPermission throws ForbiddenError when denied", () => {
    expect(() => assertPermission("MEMBER", "invoice:read")).toThrow(ForbiddenError);
    expect(() => assertPermission("MANAGER", "invoice:read")).not.toThrow();
  });
});

describe("role changes (escalation rules)", () => {
  const change = (actorRole: Role, targetCurrentRole: Role, newRole: Role, actorIsTarget = false) =>
    canChangeRole({ actorRole, targetCurrentRole, newRole, actorIsTarget });

  it("roles without member:update-role cannot change any role", () => {
    for (const actor of ["MANAGER", "MEMBER"] as const) {
      for (const target of ROLES) {
        for (const role of ROLES) expect(change(actor, target, role)).toBe(false);
      }
    }
  });

  it("nobody can change their own role", () => {
    for (const role of ROLES) {
      for (const newRole of ROLES) expect(change(role, role, newRole, true)).toBe(false);
    }
  });

  it("ADMIN cannot grant OWNER or change an OWNER", () => {
    expect(change("ADMIN", "MEMBER", "OWNER")).toBe(false);
    expect(change("ADMIN", "OWNER", "MEMBER")).toBe(false);
    expect(change("ADMIN", "OWNER", "ADMIN")).toBe(false);
  });

  it("ADMIN cannot change another ADMIN", () => {
    expect(change("ADMIN", "ADMIN", "MEMBER")).toBe(false);
  });

  it("ADMIN manages MANAGER and MEMBER up to ADMIN", () => {
    expect(change("ADMIN", "MEMBER", "MANAGER")).toBe(true);
    expect(change("ADMIN", "MANAGER", "MEMBER")).toBe(true);
    expect(change("ADMIN", "MEMBER", "ADMIN")).toBe(true);
  });

  it("OWNER can assign any role to others, including OWNER", () => {
    for (const target of ROLES) {
      for (const role of ROLES) expect(change("OWNER", target, role)).toBe(true);
    }
  });

  it("assertCanChangeRole throws ForbiddenError", () => {
    expect(() =>
      assertCanChangeRole({
        actorRole: "ADMIN",
        actorIsTarget: false,
        targetCurrentRole: "MEMBER",
        newRole: "OWNER",
      }),
    ).toThrow(ForbiddenError);
  });
});

describe("audit log access", () => {
  it("only OWNER and ADMIN can read the audit log", () => {
    expect(ROLES.filter((role) => hasPermission(role, "audit:read")).sort()).toEqual([
      "ADMIN",
      "OWNER",
    ]);
  });
});

describe("billing access", () => {
  it("only OWNER and ADMIN can see or change the organization's plan", () => {
    for (const permission of ["billing:read", "billing:manage"] as const) {
      expect(hasPermission("OWNER", permission)).toBe(true);
      expect(hasPermission("ADMIN", permission)).toBe(true);
      expect(hasPermission("MANAGER", permission)).toBe(false);
      expect(hasPermission("MEMBER", permission)).toBe(false);
    }
  });

  it("MANAGER keeps creating clients and projects (limits are enforced by plan, not role)", () => {
    expect(hasPermission("MANAGER", "client:create")).toBe(true);
    expect(hasPermission("MANAGER", "project:create")).toBe(true);
  });
});

describe("canRemoveMember", () => {
  const remove = (actorRole: Role, targetRole: Role, actorIsTarget = false) =>
    canRemoveMember({ actorRole, targetRole, actorIsTarget });

  it("requires member:remove", () => {
    expect(remove("MANAGER", "MEMBER")).toBe(false);
    expect(remove("MEMBER", "MEMBER")).toBe(false);
  });

  it("never removes oneself through this path", () => {
    expect(remove("OWNER", "OWNER", true)).toBe(false);
    expect(remove("ADMIN", "ADMIN", true)).toBe(false);
  });

  it("lets OWNER remove anyone and ADMIN only lower ranks", () => {
    expect(remove("OWNER", "OWNER")).toBe(true);
    expect(remove("OWNER", "ADMIN")).toBe(true);
    expect(remove("ADMIN", "MANAGER")).toBe(true);
    expect(remove("ADMIN", "MEMBER")).toBe(true);
    expect(remove("ADMIN", "ADMIN")).toBe(false);
    expect(remove("ADMIN", "OWNER")).toBe(false);
  });
});
