import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { TenantIsolationError } from "@/lib/errors";
import {
  assertCanChangeRole,
  hasPermission,
  PERMISSIONS,
  type Permission,
} from "@/lib/permissions";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantAction, tenantRoute } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

/*
 * Test-only actions built with the real wrappers. They exercise the pipeline
 * (session → tenant context → permission → validation → handler); they are
 * not application features.
 */

const handlerCalls: unknown[] = [];

/** An action requiring `permission` that records what the handler received. */
function probeAction(permission: Permission) {
  return tenantAction(
    { permission, input: z.object({ note: z.string().min(1) }) },
    async ({ ctx, input }) => {
      handlerCalls.push({ ctx, input });
      return { role: ctx.role, organizationId: ctx.organization.id, input };
    },
  );
}

const createClient = tenantAction(
  { permission: "client:create", input: z.object({ name: z.string().min(1) }) },
  async ({ ctx, db, input }) =>
    db.client.create({ data: { organizationId: ctx.organization.id, name: input.name } }),
);

/** A handler that (wrongly) trusts an organizationId from the request body. */
const naiveCreateClient = tenantAction(
  {
    permission: "client:create",
    input: z.object({ name: z.string(), organizationId: z.string() }),
  },
  async ({ db, input }) => db.client.create({ data: input }),
);

/** Role change, applying the escalation rules to server-derived roles only. */
const changeRole = tenantAction(
  {
    permission: "member:update-role",
    input: z.object({
      membershipId: z.string(),
      role: z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER"]),
    }),
  },
  async ({ ctx, db, input }) => {
    const target = await db.membership.findUniqueOrThrow({ where: { id: input.membershipId } });
    assertCanChangeRole({
      actorRole: ctx.role,
      actorIsTarget: target.userId === ctx.userId,
      targetCurrentRole: target.role,
      newRole: input.role,
    });
    return db.membership.update({ where: { id: target.id }, data: { role: input.role } });
  },
);

let owner: Awaited<ReturnType<typeof createVerifiedUser>>;
let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<
  MembershipRole,
  { userId: string; cookie: string; membershipId: string }
>;

beforeEach(async () => {
  handlerCalls.length = 0;
  owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
  const outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });

  const ownerMembership = await getDb().membership.findFirstOrThrow({
    where: { organizationId: acme.id, userId: owner.userId },
  });
  members.OWNER = { ...owner, membershipId: ownerMembership.id };
  for (const role of ["ADMIN", "MANAGER", "MEMBER"] as const) {
    const user = await createVerifiedUser(`${role.toLowerCase()}@example.com`);
    const membership = await getDb().membership.create({
      data: { organizationId: acme.id, userId: user.userId, role },
    });
    members[role] = { ...user, membershipId: membership.id };
  }
});

describe("permission enforcement through the pipeline", () => {
  const roles = ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const;

  it.each(roles)("%s gets exactly the permissions of its role", async (role) => {
    actAs(members[role].cookie);
    for (const permission of PERMISSIONS) {
      const result = await probeAction(permission)("acme", { note: "x" });
      expect({ permission, ok: result.ok }).toEqual({
        permission,
        ok: hasPermission(role, permission),
      });
      if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  it("MEMBER cannot create clients; MANAGER can", async () => {
    actAs(members.MEMBER.cookie);
    await expect(createClient("acme", { name: "Nope" })).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    actAs(members.MANAGER.cookie);
    await expect(createClient("acme", { name: "Yes" })).resolves.toMatchObject({ ok: true });
    await expect(getDb().client.findMany()).resolves.toEqual([
      expect.objectContaining({ organizationId: acme.id, name: "Yes" }),
    ]);
  });

  it("rejects unauthenticated users before anything else runs", async () => {
    actAs(undefined);
    await expect(probeAction("organization:read")("acme", { note: "x" })).resolves.toEqual({
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    });
    expect(handlerCalls).toHaveLength(0);
  });

  it("checks permission before validating input, and never runs the handler on failure", async () => {
    actAs(members.MEMBER.cookie);
    await expect(probeAction("client:create")("acme", { invalid: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    actAs(members.OWNER.cookie);
    await expect(probeAction("client:create")("acme", { invalid: true })).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(handlerCalls).toHaveLength(0);
  });
});

describe("role and identity come from the server, not the request", () => {
  it("role, user and organization supplied in input are ignored", async () => {
    actAs(members.MEMBER.cookie);
    const result = await probeAction("task:create")("acme", {
      note: "hello",
      role: "OWNER",
      userId: owner.userId,
      organizationId: globex.id,
    });

    expect(result).toEqual({
      ok: true,
      data: { role: "MEMBER", organizationId: acme.id, input: { note: "hello" } },
    });
  });

  it("claiming OWNER in the request does not unlock owner-only permissions", async () => {
    actAs(members.MEMBER.cookie);
    await expect(
      probeAction("organization:delete")("acme", { note: "x", role: "OWNER" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("a supplied organization selector the user does not belong to is rejected (404)", async () => {
    actAs(members.OWNER.cookie);
    await expect(probeAction("organization:read")("globex", { note: "x" })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(handlerCalls).toHaveLength(0);
  });

  it("a handler that passes a foreign organizationId through is stopped by the tenant client", async () => {
    actAs(members.OWNER.cookie);
    await expect(
      naiveCreateClient("acme", { name: "Planted", organizationId: globex.id }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    await expect(getDb().client.count({ where: { organizationId: globex.id } })).resolves.toBe(0);
  });
});

describe("role escalation", () => {
  const change = (actor: MembershipRole, target: MembershipRole, role: MembershipRole) => {
    actAs(members[actor].cookie);
    return changeRole("acme", { membershipId: members[target].membershipId, role });
  };

  it("MEMBER and MANAGER cannot change roles at all", async () => {
    await expect(change("MEMBER", "MEMBER", "OWNER")).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    await expect(change("MANAGER", "MEMBER", "MANAGER")).resolves.toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("ADMIN cannot promote themselves, grant OWNER, or change an OWNER", async () => {
    await expect(change("ADMIN", "ADMIN", "OWNER")).resolves.toMatchObject({ ok: false });
    await expect(change("ADMIN", "MEMBER", "OWNER")).resolves.toMatchObject({ ok: false });
    await expect(change("ADMIN", "OWNER", "MEMBER")).resolves.toMatchObject({ ok: false });
    const roles = await getDb().membership.findMany({ where: { organizationId: acme.id } });
    expect(roles.map((membership) => membership.role).sort()).toEqual(
      ["ADMIN", "MANAGER", "MEMBER", "OWNER"].sort(),
    );
  });

  it("ADMIN can promote a MEMBER to MANAGER; OWNER can grant OWNER", async () => {
    await expect(change("ADMIN", "MEMBER", "MANAGER")).resolves.toMatchObject({
      ok: true,
      data: { role: "MANAGER" },
    });
    await expect(change("OWNER", "ADMIN", "OWNER")).resolves.toMatchObject({
      ok: true,
      data: { role: "OWNER" },
    });
  });

  it("a membership in another organization cannot be targeted", async () => {
    const outsiderMembership = await getDb().membership.findFirstOrThrow({
      where: { organizationId: globex.id },
    });
    actAs(members.OWNER.cookie);
    await expect(
      changeRole("acme", { membershipId: outsiderMembership.id, role: "MEMBER" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(
      getDb().membership.findUniqueOrThrow({ where: { id: outsiderMembership.id } }),
    ).resolves.toMatchObject({ role: "OWNER" });
  });
});

describe("tenantRoute", () => {
  const route = tenantRoute(
    { permission: "client:read", input: z.object({ q: z.string().optional() }) },
    async ({ ctx, db }) =>
      Response.json({ organization: ctx.organization.slug, clients: await db.client.count() }),
  );
  const call = (slug: string, init: RequestInit = {}) =>
    route(new Request(`http://localhost:3000/api/o/${slug}/clients`, init), {
      params: Promise.resolve({ orgSlug: slug }),
    });

  it("responds 401 without a session, even for a malformed body", async () => {
    actAs(undefined);
    const response = await call("acme", { method: "POST", body: "{not json" });
    expect(response.status).toBe(401);
  });

  it("responds 404 for an organization the user does not belong to", async () => {
    actAs(members.MEMBER.cookie);
    expect((await call("globex")).status).toBe(404);
  });

  it("responds 403 when the role lacks the permission", async () => {
    const reports = tenantRoute({ permission: "report:read", input: z.object({}) }, async () =>
      Response.json({ ok: true }),
    );
    actAs(members.MEMBER.cookie);
    const response = await reports(new Request("http://localhost:3000/api/o/acme/reports"), {
      params: Promise.resolve({ orgSlug: "acme" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to perform this action",
      },
    });
  });

  it("responds 200 with organization-scoped data when authorized", async () => {
    await getTenantDb(globex.id).client.create({
      data: { organizationId: globex.id, name: "Globex client" },
    });
    actAs(members.MEMBER.cookie);
    const response = await call("acme");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ organization: "acme", clients: 0 });
  });
});

describe("membership data stays organization-scoped", () => {
  it("the tenant client lists only the current organization's memberships", async () => {
    await getDb().membership.create({
      data: { organizationId: globex.id, userId: members.MEMBER.userId, role: "MEMBER" },
    });
    const acmeMemberships = await getTenantDb(acme.id).membership.findMany();

    expect(acmeMemberships).toHaveLength(4);
    expect(acmeMemberships.every((membership) => membership.organizationId === acme.id)).toBe(true);
  });

  it("cannot modify another organization's membership", async () => {
    const foreign = await getDb().membership.findFirstOrThrow({
      where: { organizationId: globex.id },
    });
    await expect(
      getTenantDb(acme.id).membership.update({
        where: { id: foreign.id },
        data: { role: "MEMBER" },
      }),
    ).rejects.toMatchObject({ code: "P2025" });
  });

  it("cannot create a membership in another organization", async () => {
    await expect(
      getTenantDb(acme.id).membership.create({
        data: { organizationId: globex.id, userId: members.MEMBER.userId, role: "OWNER" },
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it.each(["user", "session", "account", "verification"] as const)(
    "global auth model %s is not reachable through the tenant client",
    async (model) => {
      const delegate = getTenantDb(acme.id)[model] as unknown as {
        findMany: () => Promise<unknown>;
      };
      await expect(delegate.findMany()).rejects.toBeInstanceOf(TenantIsolationError);
    },
  );
});
