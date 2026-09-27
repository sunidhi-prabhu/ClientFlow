import { beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { toAppError, withErrorHandling } from "@/lib/api/handle-error";
import { getDb } from "@/lib/db";
import { TenantIsolationError } from "@/lib/errors";
import { getTenantDb, type TenantDb } from "@/server/tenancy";

/**
 * Two organizations, each with one client and one project. Every test acts
 * as Organization A and checks that Organization B's data is unreachable.
 */
async function seed() {
  const db = getDb();
  const orgA = await db.organization.create({ data: { name: "Org A", slug: "org-a" } });
  const orgB = await db.organization.create({ data: { name: "Org B", slug: "org-b" } });
  const clientA = await db.client.create({ data: { organizationId: orgA.id, name: "Client A" } });
  const clientB = await db.client.create({ data: { organizationId: orgB.id, name: "Client B" } });
  const projectA = await db.project.create({
    data: { organizationId: orgA.id, clientId: clientA.id, name: "Project A" },
  });
  const projectB = await db.project.create({
    data: { organizationId: orgB.id, clientId: clientB.id, name: "Project B" },
  });
  return { orgA, orgB, clientA, clientB, projectA, projectB };
}

let data: Awaited<ReturnType<typeof seed>>;
let tenantA: TenantDb;

beforeEach(async () => {
  data = await seed();
  tenantA = getTenantDb(data.orgA.id);
});

/** Organization B's rows, read with the unscoped client, must be unchanged. */
async function expectOrgBUntouched() {
  const db = getDb();
  await expect(db.client.findUnique({ where: { id: data.clientB.id } })).resolves.toMatchObject({
    organizationId: data.orgB.id,
    name: "Client B",
  });
  await expect(db.project.findUnique({ where: { id: data.projectB.id } })).resolves.toMatchObject({
    organizationId: data.orgB.id,
    clientId: data.clientB.id,
    name: "Project B",
  });
}

function prismaCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
}

describe("tenant client: reads", () => {
  it("lists only the current organization's rows", async () => {
    await expect(tenantA.client.findMany()).resolves.toEqual([
      expect.objectContaining({ id: data.clientA.id }),
    ]);
    await expect(tenantA.project.count()).resolves.toBe(1);
  });

  it("cannot fetch another organization's row by id", async () => {
    await expect(tenantA.client.findUnique({ where: { id: data.clientB.id } })).resolves.toBeNull();
    await expect(tenantA.project.findFirst({ where: { name: "Project B" } })).resolves.toBeNull();
  });

  it("reports another organization's row as not found (404), not forbidden", async () => {
    const error = await tenantA.client
      .findUniqueOrThrow({ where: { id: data.clientB.id } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2025");
    expect(toAppError(error)).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("does not leak rows through relation filters or includes", async () => {
    await expect(
      tenantA.project.findMany({ where: { client: { name: "Client B" } } }),
    ).resolves.toEqual([]);
    const clients = await tenantA.client.findMany({ include: { projects: true } });
    expect(clients.flatMap((client) => client.projects.map((project) => project.id))).toEqual([
      data.projectA.id,
    ]);
  });

  it("rejects explicitly querying another organization", async () => {
    await expect(
      tenantA.client.findMany({ where: { organizationId: data.orgB.id } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      tenantA.organization.findUnique({ where: { id: data.orgB.id } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it("can read only its own organization row", async () => {
    await expect(tenantA.organization.findMany()).resolves.toEqual([
      expect.objectContaining({ id: data.orgA.id }),
    ]);
  });
});

describe("tenant client: updates", () => {
  it("cannot update another organization's row by id", async () => {
    const error = await tenantA.client
      .update({ where: { id: data.clientB.id }, data: { name: "hijacked" } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2025");
    await expectOrgBUntouched();
  });

  it("bulk updates only touch the current organization", async () => {
    await expect(tenantA.client.updateMany({ data: { name: "renamed" } })).resolves.toEqual({
      count: 1,
    });
    await expect(
      tenantA.project.updateMany({ where: { id: data.projectB.id }, data: { name: "hijacked" } }),
    ).resolves.toEqual({ count: 0 });
    await expectOrgBUntouched();
  });

  it("rejects moving a row into another organization", async () => {
    await expect(
      tenantA.client.update({
        where: { id: data.clientA.id },
        data: { organizationId: data.orgB.id },
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      getDb().client.findUnique({ where: { id: data.clientA.id } }),
    ).resolves.toMatchObject({ organizationId: data.orgA.id });
  });

  it("rejects nested writes that would re-parent another organization's row", async () => {
    await expect(
      tenantA.client.update({
        where: { id: data.clientA.id },
        data: { projects: { connect: { id: data.projectB.id } } },
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expectOrgBUntouched();
  });

  it("upsert on another organization's id creates nothing in B and changes nothing in B", async () => {
    await tenantA.client.upsert({
      where: { id: data.clientB.id },
      create: { organizationId: data.orgA.id, name: "Created in A" },
      update: { name: "hijacked" },
    });
    await expectOrgBUntouched();
    await expect(tenantA.client.count()).resolves.toBe(2);
  });
});

describe("tenant client: deletes", () => {
  it("cannot delete another organization's row by id", async () => {
    const error = await tenantA.project
      .delete({ where: { id: data.projectB.id } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2025");
    await expectOrgBUntouched();
  });

  it("bulk deletes only remove the current organization's rows", async () => {
    await expect(tenantA.project.deleteMany()).resolves.toEqual({ count: 1 });
    await expect(tenantA.client.deleteMany()).resolves.toEqual({ count: 1 });
    await expectOrgBUntouched();
  });

  it("cannot delete organizations", async () => {
    await expect(
      tenantA.organization.delete({ where: { id: data.orgA.id } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });
});

describe("tenant client: creates", () => {
  it("stamps the current organization on new rows", async () => {
    // The generated input types require organizationId; omit it here to prove
    // the extension supplies it.
    const created = await tenantA.client.create({
      data: { name: "New" } as Prisma.ClientUncheckedCreateInput,
    });
    expect(created.organizationId).toBe(data.orgA.id);

    await tenantA.client.createMany({
      data: [{ organizationId: data.orgA.id, name: "Bulk" }],
    });
    await expect(tenantA.client.count()).resolves.toBe(3);
  });

  it("rejects creating rows in another organization", async () => {
    await expect(
      tenantA.client.create({ data: { organizationId: data.orgB.id, name: "Planted" } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(getDb().client.count({ where: { organizationId: data.orgB.id } })).resolves.toBe(
      1,
    );
  });

  it("rejects a child pointing at another organization's parent (composite FK)", async () => {
    const error = await tenantA.project
      .create({
        data: { organizationId: data.orgA.id, clientId: data.clientB.id, name: "Cross-tenant" },
      })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2003");
    await expect(tenantA.project.count()).resolves.toBe(1);
  });

  it("rejects re-pointing an existing child at another organization's parent", async () => {
    const error = await tenantA.project
      .update({ where: { id: data.projectA.id }, data: { clientId: data.clientB.id } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2003");
  });
});

describe("tenant client: escape hatches", () => {
  it("rejects raw SQL", async () => {
    await expect(tenantA.$queryRaw`SELECT * FROM "Client"`).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    await expect(tenantA.$executeRawUnsafe(`DELETE FROM "Client"`)).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    await expectOrgBUntouched();
  });

  it("stays scoped inside interactive transactions", async () => {
    const ids = await tenantA.$transaction(async (tx) =>
      (await tx.client.findMany()).map(({ id }) => id),
    );
    expect(ids).toEqual([data.clientA.id]);

    await expect(
      tenantA.$transaction((tx) =>
        tx.client.create({ data: { organizationId: data.orgB.id, name: "Planted" } }),
      ),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });
});

describe("database constraints (independent of the tenant client)", () => {
  it("PostgreSQL rejects a child row referencing another organization's parent", async () => {
    const error = await getDb()
      .project.create({
        data: { organizationId: data.orgA.id, clientId: data.clientB.id, name: "Cross-tenant" },
      })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2003");
  });

  it("PostgreSQL rejects moving a child into another organization without its parent", async () => {
    const error = await getDb()
      .project.update({ where: { id: data.projectB.id }, data: { organizationId: data.orgA.id } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2003");
    await expectOrgBUntouched();
  });

  it("PostgreSQL rejects cross-organization rows inserted with raw SQL", async () => {
    await expect(
      getDb().$executeRaw`
        INSERT INTO "Project" ("id", "organizationId", "clientId", "name", "updatedAt")
        VALUES ('raw', ${data.orgA.id}, ${data.clientB.id}, 'Raw', now())`,
    ).rejects.toThrow(/Project_organizationId_clientId_fkey/);
  });

  it("a parent with children cannot be deleted, but deleting an organization cascades", async () => {
    const error = await getDb()
      .client.delete({ where: { id: data.clientB.id } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2003");

    await getDb().organization.delete({ where: { id: data.orgB.id } });
    await expect(getDb().client.count({ where: { organizationId: data.orgB.id } })).resolves.toBe(
      0,
    );
    await expect(getDb().project.count()).resolves.toBe(1);
  });

  it("unique violations surface as 409 Conflict", async () => {
    const error = await getDb()
      .organization.create({ data: { name: "Duplicate", slug: "org-a" } })
      .catch((caught: unknown) => caught);
    expect(prismaCode(error)).toBe("P2002");
    expect(toAppError(error)).toMatchObject({ code: "CONFLICT", status: 409 });
  });
});

describe("HTTP boundary", () => {
  it("a route handler touching another organization's row responds 404", async () => {
    const handler = withErrorHandling(async () => {
      await tenantA.client.update({ where: { id: data.clientB.id }, data: { name: "hijacked" } });
      return Response.json({ ok: true });
    });
    const response = await handler(
      new Request("http://localhost/api/clients", { method: "PATCH" }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });
    await expectOrgBUntouched();
  });

  it("a route handler attempting to plant data in another organization responds 403", async () => {
    const handler = withErrorHandling(async () => {
      await tenantA.client.create({ data: { organizationId: data.orgB.id, name: "Planted" } });
      return Response.json({ ok: true });
    });
    const response = await handler(new Request("http://localhost/api/clients", { method: "POST" }));
    expect(response.status).toBe(403);
  });
});
