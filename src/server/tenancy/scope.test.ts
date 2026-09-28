import { describe, expect, it } from "vitest";

import { TenantIsolationError } from "@/lib/errors";
import { scopeArgs } from "@/server/tenancy/scope";

const ORG = "org_a";
const OTHER = "org_b";

const scope = (model: string, operation: string, args?: unknown) =>
  scopeArgs({ model, operation, args, organizationId: ORG });

const rejects = (model: string, operation: string, args?: unknown) =>
  expect(() => scope(model, operation, args)).toThrow(TenantIsolationError);

describe("scopeArgs: tenant models", () => {
  it.each(["findMany", "findFirst", "count", "aggregate", "groupBy", "deleteMany"])(
    "adds organizationId to %s where clauses",
    (operation) => {
      expect(scope("Client", operation, { where: { name: "Acme" } }).where).toEqual({
        name: "Acme",
        organizationId: ORG,
      });
    },
  );

  it("scopes queries that have no where clause", () => {
    expect(scope("Client", "findMany")).toEqual({ where: { organizationId: ORG } });
  });

  it("scopes unique lookups, updates and deletes by id", () => {
    for (const operation of ["findUnique", "findUniqueOrThrow", "update", "delete"]) {
      const args =
        operation === "update" ? { where: { id: "c1" }, data: {} } : { where: { id: "c1" } };
      expect(scope("Client", operation, args).where).toEqual({ id: "c1", organizationId: ORG });
    }
  });

  it("scopes pagination cursors", () => {
    expect(scope("Client", "findMany", { cursor: { id: "c1" } }).cursor).toEqual({
      id: "c1",
      organizationId: ORG,
    });
  });

  it("accepts the current organization id when given explicitly", () => {
    expect(scope("Client", "findMany", { where: { organizationId: ORG } }).where).toEqual({
      organizationId: ORG,
    });
    expect(
      scope("Client", "findMany", { where: { organizationId: { equals: ORG } } }).where,
    ).toEqual({ organizationId: ORG });
  });

  it("rejects a different organization id instead of overriding it", () => {
    rejects("Client", "findMany", { where: { organizationId: OTHER } });
    rejects("Client", "findMany", { where: { organizationId: { equals: OTHER } } });
    rejects("Client", "findMany", { where: { organizationId: { in: [ORG, OTHER] } } });
    rejects("Client", "findMany", { where: { organizationId: { not: ORG } } });
    rejects("Client", "findUnique", {
      where: { organizationId_id: { organizationId: OTHER, id: "c1" } },
    });
    rejects("Client", "findMany", { cursor: { id: "c1", organizationId: OTHER } });
  });

  it("stamps organizationId on create and createMany", () => {
    expect(scope("Client", "create", { data: { name: "Acme" } }).data).toEqual({
      name: "Acme",
      organizationId: ORG,
    });
    expect(
      scope("Client", "createMany", { data: [{ name: "A" }, { name: "B", organizationId: ORG }] })
        .data,
    ).toEqual([
      { name: "A", organizationId: ORG },
      { name: "B", organizationId: ORG },
    ]);
  });

  it("rejects creating rows for another organization", () => {
    rejects("Client", "create", { data: { name: "Acme", organizationId: OTHER } });
    rejects("Client", "createManyAndReturn", { data: [{ name: "A", organizationId: OTHER }] });
    rejects("Client", "upsert", {
      where: { id: "c1" },
      create: { name: "A", organizationId: OTHER },
      update: {},
    });
  });

  it("rejects moving rows to another organization on update", () => {
    rejects("Client", "update", { where: { id: "c1" }, data: { organizationId: OTHER } });
    rejects("Client", "updateMany", { where: {}, data: { organizationId: { set: OTHER } } });
    rejects("Client", "upsert", {
      where: { id: "c1" },
      create: { name: "A" },
      update: { organizationId: OTHER },
    });
  });

  it("scopes all three parts of an upsert", () => {
    expect(
      scope("Client", "upsert", {
        where: { id: "c1" },
        create: { name: "A" },
        update: { name: "B" },
      }),
    ).toEqual({
      where: { id: "c1", organizationId: ORG },
      create: { name: "A", organizationId: ORG },
      update: { name: "B" },
    });
  });

  it("rejects nested relation writes, which could re-parent rows across organizations", () => {
    rejects("Client", "update", {
      where: { id: "c1" },
      data: { projects: { connect: { id: "p_of_other_org" } } },
    });
    rejects("Project", "create", {
      data: { name: "P", client: { connect: { id: "c1" } } },
    });
    rejects("Client", "create", {
      data: { name: "A", organization: { connect: { id: OTHER } } },
    });
  });

  it("allows setting foreign key columns directly (verified by composite FKs)", () => {
    expect(scope("Project", "create", { data: { name: "P", clientId: "c1" } }).data).toEqual({
      name: "P",
      clientId: "c1",
      organizationId: ORG,
    });
  });
});

describe("scopeArgs: organization root", () => {
  it("confines reads and updates to the current organization's own row", () => {
    expect(scope("Organization", "findMany").where).toEqual({ id: ORG });
    expect(scope("Organization", "findUnique", { where: { slug: "acme" } }).where).toEqual({
      slug: "acme",
      id: ORG,
    });
    expect(
      scope("Organization", "update", { where: { id: ORG }, data: { name: "New" } }).where,
    ).toEqual({ id: ORG });
  });

  it("rejects access to other organizations", () => {
    rejects("Organization", "findUnique", { where: { id: OTHER } });
    rejects("Organization", "update", { where: { id: ORG }, data: { id: OTHER } });
  });

  it("rejects organization lifecycle operations", () => {
    rejects("Organization", "create", { data: { name: "X", slug: "x" } });
    rejects("Organization", "delete", { where: { id: ORG } });
    rejects("Organization", "deleteMany");
    rejects("Organization", "upsert", { where: { id: ORG }, create: {}, update: {} });
  });
});

describe("scopeArgs: fail closed", () => {
  it("rejects unclassified models and unknown operations", () => {
    rejects("User", "findMany");
    rejects("Client", "somethingNew", {});
  });
});

describe("scopeArgs: append-only models", () => {
  it.each(["update", "updateMany", "updateManyAndReturn", "delete", "deleteMany", "upsert"])(
    "rejects %s on the audit log",
    (operation) => {
      rejects("AuditLog", operation, { where: { id: "a1" }, data: {}, create: {}, update: {} });
    },
  );

  it("still scopes creates and reads of the audit log", () => {
    expect(scope("AuditLog", "create", { data: { action: "client.created" } }).data).toEqual({
      action: "client.created",
      organizationId: ORG,
    });
    expect(scope("AuditLog", "findMany").where).toEqual({ organizationId: ORG });
  });

  it("rejects audit records written for another organization", () => {
    rejects("AuditLog", "create", { data: { action: "client.created", organizationId: OTHER } });
  });
});

describe("scopeArgs: nested reads into the global User model", () => {
  it("allows reading a member's or actor's own columns", () => {
    expect(() =>
      scope("Membership", "findMany", {
        select: { user: { select: { name: true, email: true } } },
      }),
    ).not.toThrow();
    expect(() => scope("AuditLog", "findMany", { include: { actor: true } })).not.toThrow();
    expect(() =>
      scope("ProjectMember", "findMany", {
        select: { membership: { select: { user: { select: { name: true } } } } },
      }),
    ).not.toThrow();
  });

  it.each([
    ["sessions (credentials)", { include: { user: { include: { sessions: true } } } }],
    ["accounts (password hashes)", { select: { user: { select: { accounts: true } } } }],
    ["the user's other organizations", { include: { user: { select: { memberships: true } } } }],
    ["activity in other organizations", { include: { actor: { include: { auditLogs: true } } } }],
    [
      "a nested path",
      {
        include: {
          organization: {
            include: { memberships: { include: { user: { include: { sessions: true } } } } },
          },
        },
      },
    ],
    ["relation counts", { select: { user: { select: { _count: true } } } }],
  ])("rejects %s", (_label, args) => {
    rejects("Membership", "findMany", args);
  });

  it("applies to writes that return relations, too", () => {
    rejects("Membership", "update", {
      where: { id: "m1" },
      data: { role: "ADMIN" },
      include: { user: { include: { accounts: true } } },
    });
  });
});
