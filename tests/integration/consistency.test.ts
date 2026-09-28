import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveClientAction,
  createClientAction,
  restoreClientAction,
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
  archiveProjectAction,
  setProjectStatusAction,
  updateProjectAction,
} from "@/app/o/[orgSlug]/projects/actions";
import {
  createTaskAction,
  deleteTaskAction,
} from "@/app/o/[orgSlug]/projects/[projectId]/tasks/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { createOrganization } from "@/server/organizations/bootstrap";
import { changeMembershipRole, SYSTEM_ACTOR } from "@/server/organizations/ownership";
import { tenantPage } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

/*
 * Concurrency, stale updates, duplicate operations, transaction failures and
 * audit consistency across modules. Races are made deterministic with a row
 * lock held by a second connection (see CLAUDE.md): the operation under test
 * reads the old state, blocks on the lock, and must re-check after it.
 */

type Member = { userId: string; cookie: string; membershipId: string };

let acme: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let other: pg.Client;

const as = (role: MembershipRole) => actAs(members[role].cookie);
const future = () => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
const pause = () => new Promise((resolve) => setTimeout(resolve, 300));

async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

const auditCount = (action: string, resourceId?: string) =>
  getDb().auditLog.count({
    where: { organizationId: acme.id, action, ...(resourceId ? { resourceId } : {}) },
  });

/** Run `sql` in a second transaction that keeps its row locks until `release()`. */
async function holdLock(sql: string, params: unknown[]) {
  await other.query("BEGIN");
  await other.query(sql, params);
  return { release: () => other.query("COMMIT") };
}

beforeEach(async () => {
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
  const ownerMembership = await getDb().membership.findFirstOrThrow({
    where: { organizationId: acme.id },
  });
  members.OWNER = { ...owner, membershipId: ownerMembership.id };
  for (const role of ["ADMIN", "MANAGER", "MEMBER"] as const) {
    const user = await createVerifiedUser(`${role.toLowerCase()}@example.com`);
    const membership = await getDb().membership.create({
      data: { organizationId: acme.id, userId: user.userId, role },
    });
    members[role] = { ...user, membershipId: membership.id };
  }
  other = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await other.connect();
});

afterEach(async () => {
  await other.query("ROLLBACK").catch(() => {});
  await other.end();
});

describe("stale updates on clients", () => {
  it("archiving a client that was archived meanwhile is a 409, recorded once", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    const lock = await holdLock(
      `UPDATE "Client" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`,
      [client.id],
    );
    as("MANAGER");
    const pending = archiveClientAction("acme", { id: client.id });
    await pause();
    await lock.release();

    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(getDb().clientActivity.count({ where: { clientId: client.id } })).resolves.toBe(0);
    await expect(auditCount("client.archived", client.id)).resolves.toBe(0);
  });

  it("an edit racing with an archive does not modify the archived client", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    const lock = await holdLock(
      `UPDATE "Client" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`,
      [client.id],
    );
    as("MANAGER");
    const pending = runRedirecting(
      updateClientAction("acme", { id: client.id, name: "Renamed while archived" }),
    );
    await pause();
    await lock.release();

    await expect(pending).resolves.toMatchObject({
      result: { ok: false, error: { code: "CONFLICT" } },
    });
    await expect(
      getDb().client.findUniqueOrThrow({ where: { id: client.id } }),
    ).resolves.toMatchObject({
      name: "Wayne",
      status: "ARCHIVED",
    });
    await expect(auditCount("client.updated", client.id)).resolves.toBe(0);
  });

  it("restoring a client that was restored meanwhile is a 409", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne", status: "ARCHIVED", archivedAt: new Date() },
    });
    const lock = await holdLock(
      `UPDATE "Client" SET status = 'ACTIVE', "archivedAt" = NULL WHERE id = $1`,
      [client.id],
    );
    as("MANAGER");
    const pending = restoreClientAction("acme", { id: client.id });
    await pause();
    await lock.release();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(auditCount("client.restored", client.id)).resolves.toBe(0);
  });
});

describe("stale updates on projects", () => {
  async function seedProject(status: "ACTIVE" | "ARCHIVED" = "ACTIVE") {
    return getDb().project.create({
      data: {
        organizationId: acme.id,
        name: "Website",
        status,
        ...(status === "ARCHIVED" ? { statusBeforeArchive: "ACTIVE", archivedAt: new Date() } : {}),
      },
    });
  }
  const archiveSql = `UPDATE "Project" SET status = 'ARCHIVED', "statusBeforeArchive" = status, "archivedAt" = now() WHERE id = $1`;

  it("archiving a project that was archived meanwhile is a 409, recorded once", async () => {
    const project = await seedProject();
    const lock = await holdLock(archiveSql, [project.id]);
    as("MANAGER");
    const pending = archiveProjectAction("acme", { id: project.id });
    await pause();
    await lock.release();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ status: "ARCHIVED", statusBeforeArchive: "ACTIVE" });
    await expect(auditCount("project.archived", project.id)).resolves.toBe(0);
  });

  it("a status change racing with an archive does not un-archive the project", async () => {
    const project = await seedProject();
    const lock = await holdLock(archiveSql, [project.id]);
    as("MANAGER");
    const pending = setProjectStatusAction("acme", { id: project.id, status: "COMPLETED" });
    await pause();
    await lock.release();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ status: "ARCHIVED" });
    await expect(auditCount("project.status_changed", project.id)).resolves.toBe(0);
  });

  it("an edit racing with an archive does not modify the archived project", async () => {
    const project = await seedProject();
    const lock = await holdLock(archiveSql, [project.id]);
    as("MANAGER");
    const pending = runRedirecting(
      updateProjectAction("acme", { id: project.id, name: "Renamed", status: "ACTIVE" }),
    );
    await pause();
    await lock.release();
    await expect(pending).resolves.toMatchObject({
      result: { ok: false, error: { code: "CONFLICT" } },
    });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ name: "Website", status: "ARCHIVED" });
  });
});

describe("duplicate operations", () => {
  it("adding the same project member twice concurrently: one succeeds, the other is a 409", async () => {
    const project = await getDb().project.create({
      data: { organizationId: acme.id, name: "Site" },
    });
    // The other transaction adds the member first and holds the unique-index lock.
    const lock = await holdLock(
      `INSERT INTO "ProjectMember" (id, "organizationId", "projectId", "userId") VALUES ('pm-race', $1, $2, $3)`,
      [acme.id, project.id, members.MEMBER.userId],
    );
    as("MANAGER");
    const pending = addProjectMemberAction("acme", {
      projectId: project.id,
      userId: members.MEMBER.userId,
    });
    await pause();
    await lock.release();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(getDb().projectMember.count({ where: { projectId: project.id } })).resolves.toBe(
      1,
    );
    await expect(auditCount("project.member_added")).resolves.toBe(0);
  });

  it("issuing the same invoice twice at once assigns one number and records one issue", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    as("OWNER");
    const { redirectedTo } = await runRedirecting(
      createInvoiceAction("acme", {
        clientId: client.id,
        dueDate: future(),
        items: [{ description: "Design", quantity: "1", unitPrice: "100" }],
      }),
    );
    const id = redirectedTo!.split("/").at(-1)!;
    const results = await Promise.all([
      issueInvoiceAction("acme", { id }),
      issueInvoiceAction("acme", { id }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { code: "CONFLICT" } });
    await expect(
      getDb().organization.findUniqueOrThrow({ where: { id: acme.id } }),
    ).resolves.toMatchObject({ invoiceSequence: 1 });
    await expect(auditCount("invoice.issued", id)).resolves.toBe(1);
  });

  it("paying and cancelling the same invoice at once: exactly one wins", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    const invoice = await getDb().invoice.create({
      data: {
        organizationId: acme.id,
        clientId: client.id,
        status: "ISSUED",
        number: 1,
        issueDate: new Date("2026-01-01T00:00:00Z"),
        issuedAt: new Date(),
        dueDate: new Date("2099-01-01T00:00:00Z"),
        subtotalCents: 100,
        totalCents: 100,
      },
    });
    const lock = await holdLock(
      `UPDATE "Invoice" SET status = 'PAID', "paidAt" = now() WHERE id = $1`,
      [invoice.id],
    );
    as("OWNER");
    const pending = cancelInvoiceAction("acme", { id: invoice.id });
    await pause();
    await lock.release();
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { code: "CONFLICT", message: "Paid invoices cannot be cancelled" },
    });
    await expect(
      getDb().invoice.findUniqueOrThrow({ where: { id: invoice.id } }),
    ).resolves.toMatchObject({
      status: "PAID",
      cancelledAt: null,
    });
    await expect(auditCount("invoice.cancelled", invoice.id)).resolves.toBe(0);
    // Paying again is refused too.
    await expect(markInvoicePaidAction("acme", { id: invoice.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });

  it("deleting a task twice: the second attempt is a 404 and the deletion is recorded once", async () => {
    const project = await getDb().project.create({
      data: { organizationId: acme.id, name: "Site" },
    });
    as("OWNER");
    const created = await createTaskAction("acme", { projectId: project.id, title: "Temp" });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const first = await runRedirecting(deleteTaskAction("acme", { id: created.data.id }));
    expect(first.redirectedTo).toBe(`/o/acme/projects/${project.id}`);
    await expect(
      runRedirecting(deleteTaskAction("acme", { id: created.data.id })),
    ).resolves.toMatchObject({ result: { ok: false, error: { code: "NOT_FOUND" } } });
    await expect(auditCount("task.deleted", created.data.id)).resolves.toBe(1);
  });
});

describe("database transaction failures", () => {
  /** A test-only trigger that makes the audit insert for one event fail. */
  async function failAuditFor(action: string, body: () => Promise<void>) {
    const admin = getDb();
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."action" = '${action}' THEN RAISE EXCEPTION 'simulated audit failure'; END IF;
        RETURN NEW;
      END $$`);
    await admin.$executeRawUnsafe(
      `CREATE TRIGGER test_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_fail_audit()`,
    );
    try {
      await body();
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_audit ON "AuditLog"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_audit()`);
    }
  }

  it("a client creation whose audit record fails leaves no client and no activity", async () => {
    await failAuditFor("client.created", async () => {
      as("MANAGER");
      const { result, redirectedTo } = await runRedirecting(
        createClientAction("acme", { name: "Never saved" }),
      );
      expect(redirectedTo).toBeUndefined();
      expect(result).toEqual({
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
      });
    });
    await expect(getDb().client.count({ where: { name: "Never saved" } })).resolves.toBe(0);
    await expect(getDb().clientActivity.count()).resolves.toBe(0);
  });

  it("an invoice issue whose audit record fails stays a draft and consumes no number", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    as("OWNER");
    const { redirectedTo } = await runRedirecting(
      createInvoiceAction("acme", {
        clientId: client.id,
        dueDate: future(),
        items: [{ description: "Design", quantity: "1", unitPrice: "100" }],
      }),
    );
    const id = redirectedTo!.split("/").at(-1)!;
    await failAuditFor("invoice.issued", async () => {
      await expect(issueInvoiceAction("acme", { id })).resolves.toMatchObject({
        ok: false,
        error: { code: "INTERNAL_ERROR" },
      });
    });
    await expect(getDb().invoice.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      status: "DRAFT",
      number: null,
    });
    await expect(
      getDb().organization.findUniqueOrThrow({ where: { id: acme.id } }),
    ).resolves.toMatchObject({ invoiceSequence: 0 });
    // The operation works once the failure is gone, with the first number.
    await expect(issueInvoiceAction("acme", { id })).resolves.toMatchObject({
      ok: true,
      data: { number: 1 },
    });
  });
});

describe("role changes take effect on the next request", () => {
  it("a demoted ADMIN loses invoice and audit access immediately; a promotion grants it", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    const create = () =>
      runRedirecting(createInvoiceAction("acme", { clientId: client.id, dueDate: future() }));

    as("ADMIN");
    await expect(create()).resolves.toMatchObject({
      redirectedTo: expect.stringContaining("/invoices/"),
    });
    await changeMembershipRole(
      getTenantDb(acme.id),
      members.ADMIN.membershipId,
      "MEMBER",
      SYSTEM_ACTOR,
    );
    await expect(create()).resolves.toMatchObject({
      result: { ok: false, error: { code: "FORBIDDEN" } },
    });
    await expect(tenantPage("acme", "audit:read")).resolves.toMatchObject({ allowed: false });

    await changeMembershipRole(
      getTenantDb(acme.id),
      members.ADMIN.membershipId,
      "MANAGER",
      SYSTEM_ACTOR,
    );
    await expect(create()).resolves.toMatchObject({
      redirectedTo: expect.stringContaining("/invoices/"),
    });
    await expect(tenantPage("acme", "audit:read")).resolves.toMatchObject({ allowed: false });
    await expect(getDb().invoice.count({ where: { organizationId: acme.id } })).resolves.toBe(2);
  });
});

describe("audit-log consistency", () => {
  it("every successful change has exactly one audit record, and failed or no-op changes none", async () => {
    as("MANAGER");
    const { redirectedTo } = await runRedirecting(createClientAction("acme", { name: "Wayne" }));
    const clientId = redirectedTo!.split("/").at(-1)!;
    // A no-op update (same values) and an invalid update change nothing.
    await runRedirecting(updateClientAction("acme", { id: clientId, name: "Wayne" }));
    await runRedirecting(updateClientAction("acme", { id: clientId, name: "" }));
    await runRedirecting(updateClientAction("acme", { id: clientId, name: "Wayne Ent." }));
    await archiveClientAction("acme", { id: clientId });
    await archiveClientAction("acme", { id: clientId }); // 409
    await restoreClientAction("acme", { id: clientId });

    const activity = await getDb().clientActivity.findMany({
      where: { clientId },
      orderBy: { createdAt: "asc" },
    });
    const audit = await getDb().auditLog.findMany({
      where: { organizationId: acme.id, resourceId: clientId },
      orderBy: { createdAt: "asc" },
    });
    expect(activity.map((row) => row.type)).toEqual(["CREATED", "UPDATED", "ARCHIVED", "RESTORED"]);
    expect(audit.map((row) => row.action)).toEqual([
      "client.created",
      "client.updated",
      "client.archived",
      "client.restored",
    ]);
    expect(audit.every((row) => row.actorUserId === members.MANAGER.userId)).toBe(true);
  });
});
