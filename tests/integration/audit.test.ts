import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveClientAction,
  createClientAction,
  updateClientAction,
} from "@/app/o/[orgSlug]/clients/actions";
import {
  cancelInvoiceAction,
  createInvoiceAction,
  issueInvoiceAction,
  markInvoicePaidAction,
} from "@/app/o/[orgSlug]/invoices/actions";
import {
  addProjectMemberAction,
  createProjectAction,
  setProjectStatusAction,
  updateProjectAction,
} from "@/app/o/[orgSlug]/projects/actions";
import {
  assignTaskAction,
  createTaskAction,
} from "@/app/o/[orgSlug]/projects/[projectId]/tasks/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { TenantIsolationError } from "@/lib/errors";
import { parseListAuditLogQuery } from "@/lib/validation/audit";
import { listAuditLog, recordAudit } from "@/server/audit/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import {
  changeMembershipRole,
  removeMembership,
  SYSTEM_ACTOR,
} from "@/server/organizations/ownership";
import { tenantPage } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";
import { resolveTenantContext } from "@/server/tenancy/context";

import { authFetch, createVerifiedUser, PASSWORD, sessionCookie, signIn } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

type Member = { userId: string; cookie: string; membershipId: string };

let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: { userId: string; cookie: string };

const as = (role: MembershipRole) => actAs(members[role].cookie);

/** The server-resolved tenant context of a member of Acme. */
const contextOf = (role: MembershipRole) => resolveTenantContext(members[role].userId, "acme");

async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

const idFrom = async (action: Promise<unknown>) => {
  const { redirectedTo, result } = await runRedirecting(action);
  if (!redirectedTo) throw new Error(`action failed: ${JSON.stringify(result)}`);
  return redirectedTo.split("/").at(-1)!;
};

/** Audit rows of an organization (raw client: the test inspects everything). */
const rows = (organizationId: string, action?: string) =>
  getDb().auditLog.findMany({
    where: { organizationId, ...(action ? { action } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

const future = () => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

beforeEach(async () => {
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
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
  outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
});

describe("authentication events", () => {
  it("records a sign-in in every organization of the user, with the server-side identity", async () => {
    await getDb().membership.create({
      data: { organizationId: globex.id, userId: members.MANAGER.userId, role: "MEMBER" },
    });
    const response = await signIn("manager@example.com");
    expect(response.status).toBe(200);

    for (const organizationId of [acme.id, globex.id]) {
      const [login] = await rows(organizationId, "auth.login");
      expect(login).toMatchObject({
        actorUserId: members.MANAGER.userId,
        resourceType: "user",
        resourceId: members.MANAGER.userId,
        metadata: expect.objectContaining({ method: "password" }),
      });
    }
    const stored = JSON.stringify(await getDb().auditLog.findMany());
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(sessionCookie(response)!.split("=")[1].split(".")[0]);
  });

  it("records sign-out for the signed-in user", async () => {
    const response = await signIn("admin@example.com");
    const cookie = sessionCookie(response)!;
    expect((await authFetch("/sign-out", { cookie })).status).toBe(200);
    const [logout] = await rows(acme.id, "auth.logout");
    expect(logout).toMatchObject({
      actorUserId: members.ADMIN.userId,
      resourceId: members.ADMIN.userId,
    });
  });

  it("records failed sign-ins without an actor and never stores the attempted password", async () => {
    const response = await signIn("member@example.com", "wrong-password-attempt-42");
    expect(response.status).toBe(401);
    const [failed] = await rows(acme.id, "auth.login_failed");
    expect(failed).toMatchObject({
      actorUserId: null,
      resourceId: members.MEMBER.userId,
      metadata: expect.objectContaining({
        email: "member@example.com",
        reason: "INVALID_EMAIL_OR_PASSWORD",
      }),
    });
    expect(JSON.stringify(await getDb().auditLog.findMany())).not.toContain(
      "wrong-password-attempt-42",
    );
    expect(await rows(acme.id, "auth.login")).toEqual([]);
  });

  it("records nothing tenant-visible for a failed sign-in with an unknown address", async () => {
    const before = await getDb().auditLog.count();
    expect((await signIn("nobody@example.com", "whatever-password")).status).toBe(401);
    expect(await getDb().auditLog.count()).toBe(before);
  });

  it("records password changes (not as a new sign-in) without storing either password", async () => {
    const response = await authFetch("/change-password", {
      cookie: members.OWNER.cookie,
      body: { currentPassword: PASSWORD, newPassword: "brand-new-password-99" },
    });
    expect(response.status).toBe(200);
    const [changed] = await rows(acme.id, "auth.password_changed");
    expect(changed).toMatchObject({
      actorUserId: members.OWNER.userId,
      resourceId: members.OWNER.userId,
    });
    expect(await rows(acme.id, "auth.login")).toEqual([]);
    const stored = JSON.stringify(await getDb().auditLog.findMany());
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain("brand-new-password-99");
  });
});

describe("business events", () => {
  it("records client creation, update and archive with the acting member", async () => {
    as("MANAGER");
    const clientId = await idFrom(createClientAction("acme", { name: "Wayne", email: "w@x.com" }));
    await runRedirecting(
      updateClientAction("acme", { id: clientId, name: "Wayne Ent.", email: "w@x.com" }),
    );
    await expect(archiveClientAction("acme", { id: clientId })).resolves.toMatchObject({
      ok: true,
    });

    const events = (await rows(acme.id)).filter((row) => row.resourceType === "client");
    expect(events.map((row) => [row.action, row.actorUserId, row.resourceId])).toEqual([
      ["client.created", members.MANAGER.userId, clientId],
      ["client.updated", members.MANAGER.userId, clientId],
      ["client.archived", members.MANAGER.userId, clientId],
    ]);
    expect(events[1].metadata).toMatchObject({
      name: "Wayne Ent.",
      changes: { name: { from: "Wayne", to: "Wayne Ent." } },
    });
  });

  it("records project creation, updates, status changes and membership", async () => {
    as("OWNER");
    const projectId = await idFrom(createProjectAction("acme", { name: "Website" }));
    await runRedirecting(updateProjectAction("acme", { id: projectId, name: "Website v2" }));
    await setProjectStatusAction("acme", { id: projectId, status: "ACTIVE" });
    await addProjectMemberAction("acme", { projectId, userId: members.MEMBER.userId });

    const events = (await rows(acme.id)).filter((row) => row.resourceType === "project");
    expect(events.map((row) => row.action)).toEqual([
      "project.created",
      "project.updated",
      "project.status_changed",
      "project.member_added",
    ]);
    expect(events.every((row) => row.actorUserId === members.OWNER.userId)).toBe(true);
    expect(events[2].metadata).toMatchObject({ status: { from: "PLANNING", to: "ACTIVE" } });
  });

  it("records task assignment and unassignment, including assignment on creation", async () => {
    as("OWNER");
    const projectId = await idFrom(createProjectAction("acme", { name: "Website" }));
    await addProjectMemberAction("acme", { projectId, userId: members.MEMBER.userId });
    const created = await createTaskAction("acme", {
      projectId,
      title: "Wireframes",
      assigneeUserId: members.MEMBER.userId,
    });
    if (!created.ok) throw new Error(JSON.stringify(created));
    as("MANAGER");
    await assignTaskAction("acme", { id: created.data.id, assigneeUserId: null });

    const events = await rows(acme.id);
    const taskEvents = events.filter((row) => row.resourceType === "task");
    expect(taskEvents.map((row) => [row.action, row.actorUserId])).toEqual([
      ["task.assigned", members.OWNER.userId],
      ["task.unassigned", members.MANAGER.userId],
    ]);
    expect(taskEvents[1].metadata).toMatchObject({
      title: "Wireframes",
      projectId,
      assignee: { from: { userId: members.MEMBER.userId }, to: null },
    });
  });

  it("records invoice creation and every status change, including derived OVERDUE", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    as("OWNER");
    const invoiceId = await idFrom(
      createInvoiceAction("acme", {
        clientId: client.id,
        dueDate: future(),
        items: [{ description: "Design", quantity: "1", unitPrice: "100.00" }],
      }),
    );
    await expect(issueInvoiceAction("acme", { id: invoiceId })).resolves.toMatchObject({
      ok: true,
    });
    await expect(markInvoicePaidAction("acme", { id: invoiceId })).resolves.toMatchObject({
      ok: true,
    });
    const draftId = await idFrom(
      createInvoiceAction("acme", { clientId: client.id, dueDate: future() }),
    );
    await expect(cancelInvoiceAction("acme", { id: draftId })).resolves.toMatchObject({ ok: true });
    // An issued invoice past its due date (inserted in its final state).
    const overdue = await getDb().invoice.create({
      data: {
        organizationId: acme.id,
        clientId: client.id,
        status: "ISSUED",
        number: 99,
        issueDate: new Date("2020-01-01T00:00:00Z"),
        issuedAt: new Date("2020-01-01T00:00:00Z"),
        dueDate: new Date("2020-01-31T00:00:00Z"),
        subtotalCents: 500,
        totalCents: 500,
      },
    });
    await expect(markInvoicePaidAction("acme", { id: overdue.id })).resolves.toMatchObject({
      ok: true,
    });

    const events = (await rows(acme.id)).filter((row) => row.resourceType === "invoice");
    expect(events.map((row) => [row.action, row.resourceId])).toEqual([
      ["invoice.created", invoiceId],
      ["invoice.issued", invoiceId],
      ["invoice.paid", invoiceId],
      ["invoice.created", draftId],
      ["invoice.cancelled", draftId],
      ["invoice.paid", overdue.id],
    ]);
    expect(events.every((row) => row.actorUserId === members.OWNER.userId)).toBe(true);
    expect(events[0].metadata).toMatchObject({ totalCents: 10_000, currency: "USD", itemCount: 1 });
    expect(events[1].metadata).toMatchObject({
      label: "INV-0001",
      status: { from: "DRAFT", to: "ISSUED" },
    });
    expect(events[2].metadata).toMatchObject({ status: { from: "ISSUED", to: "PAID" } });
    expect(events[4].metadata).toMatchObject({ status: { from: "DRAFT", to: "CANCELLED" } });
    expect(events[5].metadata).toMatchObject({
      label: "INV-0099",
      status: { from: "OVERDUE", to: "PAID" },
    });
  });

  it("writes no audit record when the operation fails (same transaction)", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    as("OWNER");
    const draftId = await idFrom(
      createInvoiceAction("acme", { clientId: client.id, dueDate: future() }),
    );
    // An empty draft cannot be issued.
    await expect(issueInvoiceAction("acme", { id: draftId })).resolves.toMatchObject({ ok: false });
    await expect(archiveClientAction("acme", { id: client.id })).resolves.toMatchObject({
      ok: true,
    });
    await expect(archiveClientAction("acme", { id: client.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await rows(acme.id, "invoice.issued")).toEqual([]);
    expect(await rows(acme.id, "client.archived")).toHaveLength(1);
  });

  it("records nothing when a role is not allowed to act", async () => {
    as("MEMBER");
    await expect(
      runRedirecting(createClientAction("acme", { name: "Nope" })),
    ).resolves.toMatchObject({
      result: { ok: false, error: { code: "FORBIDDEN" } },
    });
    expect(await rows(acme.id, "client.created")).toEqual([]);
  });
});

describe("organization, member, role and permission events", () => {
  it("records organization creation and its first owner", async () => {
    const events = await rows(acme.id);
    expect(events.map((row) => [row.action, row.actorUserId])).toEqual([
      ["organization.created", members.OWNER.userId],
      ["member.added", members.OWNER.userId],
    ]);
    expect(events[1]).toMatchObject({
      resourceType: "membership",
      resourceId: members.OWNER.membershipId,
      metadata: expect.objectContaining({ role: "OWNER" }),
    });
  });

  it("records role changes with the exact permissions granted and revoked", async () => {
    await changeMembershipRole(
      getTenantDb(acme.id),
      members.MEMBER.membershipId,
      "MANAGER",
      await contextOf("OWNER"),
    );
    const [change] = await rows(acme.id, "member.role_changed");
    expect(change).toMatchObject({
      actorUserId: members.OWNER.userId,
      resourceType: "membership",
      resourceId: members.MEMBER.membershipId,
      metadata: {
        member: { userId: members.MEMBER.userId, email: "member@example.com" },
        role: { from: "MEMBER", to: "MANAGER" },
      },
    });
    const { permissions } = change.metadata as {
      permissions: { granted: string[]; revoked: string[] };
    };
    expect(permissions.granted).toEqual(expect.arrayContaining(["client:create", "invoice:read"]));
    expect(permissions.granted).not.toContain("audit:read");
    expect(permissions.revoked).toEqual([]);

    await changeMembershipRole(
      getTenantDb(acme.id),
      members.MEMBER.membershipId,
      "MEMBER",
      await contextOf("OWNER"),
    );
    const [, demotion] = await rows(acme.id, "member.role_changed");
    expect(
      (demotion.metadata as { permissions: { revoked: string[] } }).permissions.revoked,
    ).toEqual(expect.arrayContaining(["client:create", "invoice:read"]));
  });

  it("does not record a role change that is refused or that changes nothing", async () => {
    await expect(
      changeMembershipRole(getTenantDb(acme.id), members.OWNER.membershipId, "ADMIN", SYSTEM_ACTOR),
    ).rejects.toThrow();
    await changeMembershipRole(
      getTenantDb(acme.id),
      members.MANAGER.membershipId,
      "MANAGER",
      await contextOf("ADMIN"),
    );
    expect(await rows(acme.id, "member.role_changed")).toEqual([]);
  });

  it("enforces the role-change rules inside the service, and records nothing when refused", async () => {
    const db = getTenantDb(acme.id);
    // MANAGER lacks member:update-role.
    await expect(
      changeMembershipRole(db, members.MEMBER.membershipId, "MANAGER", await contextOf("MANAGER")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // ADMIN cannot grant OWNER, change an OWNER, change another ADMIN or themselves.
    const admin = await contextOf("ADMIN");
    await expect(
      changeMembershipRole(db, members.MEMBER.membershipId, "OWNER", admin),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      changeMembershipRole(db, members.OWNER.membershipId, "MEMBER", admin),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      changeMembershipRole(db, members.ADMIN.membershipId, "OWNER", admin),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // MEMBER cannot promote themselves.
    await expect(
      changeMembershipRole(db, members.MEMBER.membershipId, "ADMIN", await contextOf("MEMBER")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await rows(acme.id, "member.role_changed")).toEqual([]);
    const roles = await getDb().membership.findMany({ where: { organizationId: acme.id } });
    expect(Object.fromEntries(roles.map((m) => [m.id, m.role]))).toMatchObject({
      [members.MEMBER.membershipId]: "MEMBER",
      [members.ADMIN.membershipId]: "ADMIN",
      [members.OWNER.membershipId]: "OWNER",
    });
  });

  it("enforces the removal rules inside the service", async () => {
    const db = getTenantDb(acme.id);
    await expect(
      removeMembership(db, members.MEMBER.membershipId, await contextOf("MANAGER")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      removeMembership(db, members.OWNER.membershipId, await contextOf("ADMIN")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      removeMembership(db, members.ADMIN.membershipId, await contextOf("ADMIN")),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await rows(acme.id, "member.removed")).toEqual([]);
    expect(await getDb().membership.count({ where: { organizationId: acme.id } })).toBe(4);
  });

  it("records maintenance changes as system changes", async () => {
    await changeMembershipRole(
      getTenantDb(acme.id),
      members.MEMBER.membershipId,
      "MANAGER",
      SYSTEM_ACTOR,
    );
    const [change] = await rows(acme.id, "member.role_changed");
    expect(change).toMatchObject({
      actorUserId: null,
      metadata: expect.objectContaining({ via: "system" }),
    });
  });

  it("records member removal", async () => {
    await removeMembership(
      getTenantDb(acme.id),
      members.MANAGER.membershipId,
      await contextOf("ADMIN"),
    );
    const [removed] = await rows(acme.id, "member.removed");
    expect(removed).toMatchObject({
      actorUserId: members.ADMIN.userId,
      metadata: expect.objectContaining({ role: "MANAGER" }),
    });
  });
});

describe("forged identity", () => {
  it("ignores actor and organization ids supplied in action input", async () => {
    as("MANAGER");
    const clientId = await idFrom(
      createClientAction("acme", {
        name: "Forged",
        organizationId: globex.id,
        actorUserId: outsider.userId,
        actorId: outsider.userId,
        userId: outsider.userId,
      }),
    );
    const [created] = await rows(acme.id, "client.created");
    expect(created).toMatchObject({
      organizationId: acme.id,
      actorUserId: members.MANAGER.userId,
      resourceId: clientId,
    });
    expect(await rows(globex.id, "client.created")).toEqual([]);
  });

  it("the tenant client refuses audit records for another organization", async () => {
    await expect(
      recordAudit(
        getTenantDb(acme.id),
        { organizationId: globex.id, actorUserId: members.OWNER.userId },
        { action: "client.created", resourceId: "x" },
      ),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    expect(await rows(globex.id, "client.created")).toEqual([]);
  });

  it("no route or Server Action writes audit records directly", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(process.cwd(), "src/app"));
    const writers = files.filter((file) =>
      /recordAudit|auditRecordData|auditLog\.(create|update|upsert|delete)/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(writers).toEqual([]);
  });
});

describe("immutability", () => {
  async function seedRecord() {
    await recordAudit(
      getTenantDb(acme.id),
      { organizationId: acme.id, actorUserId: members.OWNER.userId },
      {
        action: "client.created",
        resourceId: "c1",
        metadata: { name: "Original" },
      },
    );
    return (await rows(acme.id, "client.created"))[0];
  }

  it("the tenant client cannot update or delete audit records", async () => {
    const record = await seedRecord();
    const db = getTenantDb(acme.id);
    await expect(
      db.auditLog.update({ where: { id: record.id }, data: { action: "client.updated" } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(db.auditLog.updateMany({ data: { actorUserId: null } })).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    await expect(db.auditLog.delete({ where: { id: record.id } })).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    await expect(db.auditLog.deleteMany({})).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      db.auditLog.upsert({
        where: { id: record.id },
        create: { action: "client.created", resourceType: "client", organizationId: acme.id },
        update: { action: "x.y" },
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    expect(await rows(acme.id, "client.created")).toEqual([record]);
  });

  it("the database rejects updates and deletes even from the unscoped client", async () => {
    const record = await seedRecord();
    await expect(
      getDb().auditLog.update({
        where: { id: record.id },
        data: { metadata: { name: "Tampered" } },
      }),
    ).rejects.toThrow();
    await expect(
      getDb().auditLog.update({ where: { id: record.id }, data: { actorUserId: null } }),
    ).rejects.toThrow();
    await expect(getDb().auditLog.delete({ where: { id: record.id } })).rejects.toThrow();
    await expect(
      getDb().auditLog.deleteMany({ where: { organizationId: acme.id } }),
    ).rejects.toThrow();
    expect(await rows(acme.id, "client.created")).toEqual([record]);
  });

  it("the database rejects invalid actions, resource types and non-object metadata", async () => {
    const base = {
      organizationId: acme.id,
      resourceType: "client",
      action: "client.created",
      metadata: {},
    };
    await expect(
      getDb().auditLog.create({ data: { ...base, action: "DROP TABLE" } }),
    ).rejects.toThrow();
    await expect(
      getDb().auditLog.create({ data: { ...base, resourceType: "session" } }),
    ).rejects.toThrow();
    await expect(getDb().auditLog.create({ data: { ...base, metadata: ["x"] } })).rejects.toThrow();
  });

  it("deleting a user keeps their records (actor cleared); deleting the organization removes its log", async () => {
    await seedRecord();
    const user = await createVerifiedUser("leaver@example.com");
    const membership = await getDb().membership.create({
      data: { organizationId: acme.id, userId: user.userId, role: "MEMBER" },
    });
    await recordAudit(
      getTenantDb(acme.id),
      { organizationId: acme.id, actorUserId: user.userId },
      {
        action: "client.updated",
        resourceId: "c1",
      },
    );
    await getDb().membership.delete({ where: { id: membership.id } });
    await getDb().user.delete({ where: { id: user.userId } });
    const [updated] = await rows(acme.id, "client.updated");
    expect(updated.actorUserId).toBeNull();

    await getDb().organization.delete({ where: { id: globex.id } });
    expect(await rows(globex.id)).toEqual([]);
    expect((await rows(acme.id)).length).toBeGreaterThan(0);
  });
});

describe("visibility", () => {
  it("only OWNER and ADMIN may open the audit log", async () => {
    for (const [role, allowed] of [
      ["OWNER", true],
      ["ADMIN", true],
      ["MANAGER", false],
      ["MEMBER", false],
    ] as const) {
      as(role);
      const access = await tenantPage("acme", "audit:read");
      expect({ role, allowed: access.allowed }).toEqual({ role, allowed });
      expect("db" in access).toBe(allowed);
    }
  });

  it("members of another organization and signed-out visitors are turned away", async () => {
    actAs(outsider.cookie);
    await expect(tenantPage("acme", "audit:read")).rejects.toThrow();
    actAs(undefined);
    const error = await tenantPage("acme", "audit:read").catch((caught: unknown) => caught);
    expect((error as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;.*;\/sign-in/);
  });

  it("an organization's log never contains another organization's records", async () => {
    actAs(outsider.cookie);
    await idFrom(createClientAction("globex", { name: "Secret Globex client" }));

    as("OWNER");
    const access = await tenantPage("acme", "audit:read");
    if (!access.allowed) throw new Error("expected access");
    const page = await listAuditLog(access.db, parseListAuditLogQuery({}));
    expect(page.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(page.items)).not.toContain("Globex");
    // Even filtering by a Globex actor shows nothing from Globex.
    const filtered = await listAuditLog(
      access.db,
      parseListAuditLogQuery({ actorId: outsider.userId }),
    );
    expect(filtered.total).toBe(0);
  });
});

describe("pagination and filters", () => {
  const day = (iso: string, hour = 12) =>
    new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00Z`);

  async function seed() {
    const data = [];
    for (let index = 0; index < 30; index++) {
      data.push({
        organizationId: acme.id,
        actorUserId: index % 3 === 0 ? members.ADMIN.userId : members.MANAGER.userId,
        action: index % 2 === 0 ? "client.created" : "project.updated",
        resourceType: index % 2 === 0 ? "client" : "project",
        resourceId: `r${index}`,
        metadata: { name: `Item ${index}` },
        createdAt: day(`2026-09-${String(1 + (index % 10)).padStart(2, "0")}`, index % 24),
      });
    }
    data.push({
      organizationId: acme.id,
      actorUserId: null,
      action: "auth.login_failed",
      resourceType: "user",
      resourceId: members.MEMBER.userId,
      metadata: { email: "member@example.com" },
      createdAt: day("2026-09-05"),
    });
    await getDb().auditLog.createMany({ data });
    // Noise in another organization.
    await getDb().auditLog.createMany({
      data: Array.from({ length: 5 }, () => ({
        organizationId: globex.id,
        actorUserId: outsider.userId,
        action: "client.created",
        resourceType: "client",
        createdAt: day("2026-09-05"),
      })),
    });
  }

  const list = (params: Record<string, string>) =>
    listAuditLog(getTenantDb(acme.id), parseListAuditLogQuery(params));

  it("paginates newest first and clamps pages past the end", async () => {
    await seed();
    const first = await list({ pageSize: "10" });
    expect(first.total).toBe(33); // 31 seeded + organization.created + member.added
    expect(first.pageCount).toBe(4);
    expect(first.items).toHaveLength(10);
    const times = first.items.map((item) => item.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => list({ pageSize: "10", page: String(page) })),
    );
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(33);
    await expect(list({ pageSize: "10", page: "99" })).resolves.toMatchObject({ page: 4 });
  });

  it("filters by actor, including events without an actor", async () => {
    await seed();
    const admin = await list({ actorId: members.ADMIN.userId, pageSize: "100" });
    expect(admin.total).toBe(10);
    expect(admin.items.every((item) => item.actorUserId === members.ADMIN.userId)).toBe(true);
    expect(admin.items[0].actor).toEqual({ name: "Test User", email: "admin@example.com" });
    const anonymous = await list({ actorId: "none" });
    expect(anonymous.items.map((item) => item.action)).toEqual(["auth.login_failed"]);
  });

  it("filters by action and resource type", async () => {
    await seed();
    await expect(list({ action: "project.updated" })).resolves.toMatchObject({ total: 15 });
    await expect(list({ resourceType: "client" })).resolves.toMatchObject({ total: 15 });
    await expect(list({ resourceType: "membership" })).resolves.toMatchObject({ total: 1 });
    await expect(
      list({ action: "client.created", resourceType: "project" }),
    ).resolves.toMatchObject({ total: 0 });
  });

  it("filters by an inclusive UTC date range", async () => {
    await seed();
    // Days 2026-09-03..05 hold indexes 2,3,4 (+10, +20) and the failed sign-in.
    const range = await list({ from: "2026-09-03", to: "2026-09-05", pageSize: "100" });
    expect(range.total).toBe(10);
    expect(
      range.items.every(
        (item) => item.createdAt >= day("2026-09-03", 0) && item.createdAt < day("2026-09-06", 0),
      ),
    ).toBe(true);
    await expect(list({ from: "2026-09-10", to: "2026-09-10" })).resolves.toMatchObject({
      total: 3,
    });
    await expect(list({ to: "2026-08-31" })).resolves.toMatchObject({ total: 0 });
  });

  it("combines filters", async () => {
    await seed();
    const combined = await list({
      actorId: members.MANAGER.userId,
      resourceType: "project",
      from: "2026-09-01",
      to: "2026-09-02",
    });
    // Indexes on 09-01/09-02: 0,1,10,11,20,21 → project (odd) by MANAGER (not %3): 1, 11.
    expect(combined.items.map((item) => item.resourceId).sort()).toEqual(["r1", "r11"]);
  });
});
