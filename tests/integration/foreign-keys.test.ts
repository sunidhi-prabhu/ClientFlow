import { beforeEach, describe, expect, it } from "vitest";

import { errorResponse, withErrorHandling } from "@/lib/api/handle-error";
import { getDb } from "@/lib/db";
import { ReferenceNotFoundError } from "@/lib/errors";
import { getTenantDb, requireTenantRecord, type TenantDb } from "@/server/tenancy";

/**
 * Foreign ids supplied by callers: nonexistent and other-organization ids
 * must behave identically (404, no database details), whether caught by the
 * tenant-scoped lookup or by the composite foreign key itself.
 */
let orgAId: string;
let clientA: { id: string };
let clientB: { id: string };
let tenantA: TenantDb;

beforeEach(async () => {
  const db = getDb();
  const orgA = await db.organization.create({ data: { name: "Org A", slug: "org-a" } });
  const orgB = await db.organization.create({ data: { name: "Org B", slug: "org-b" } });
  clientA = await db.client.create({ data: { organizationId: orgA.id, name: "Client A" } });
  clientB = await db.client.create({ data: { organizationId: orgB.id, name: "Client B" } });
  orgAId = orgA.id;
  tenantA = getTenantDb(orgA.id);
});

const NOT_FOUND_BODY = { error: { code: "NOT_FOUND", message: "Referenced resource not found" } };

describe("requireTenantRecord", () => {
  it("accepts a record owned by the current organization", async () => {
    await expect(requireTenantRecord(tenantA, "client", clientA.id)).resolves.toBeUndefined();
  });

  it("rejects another organization's record exactly like a nonexistent one", async () => {
    const crossTenant = await requireTenantRecord(tenantA, "client", clientB.id).catch(
      (error: unknown) => error,
    );
    const missing = await requireTenantRecord(tenantA, "client", "does-not-exist").catch(
      (error: unknown) => error,
    );

    expect(crossTenant).toBeInstanceOf(ReferenceNotFoundError);
    expect(missing).toBeInstanceOf(ReferenceNotFoundError);
    await expect(errorResponse(crossTenant).json()).resolves.toEqual(NOT_FOUND_BODY);
    await expect(errorResponse(missing).json()).resolves.toEqual(NOT_FOUND_BODY);
  });

  it("rejects an empty id", async () => {
    await expect(requireTenantRecord(tenantA, "client", "")).rejects.toBeInstanceOf(
      ReferenceNotFoundError,
    );
  });
});

describe("P2003 from the database (no pre-check)", () => {
  // Route handler that trusts a caller-supplied clientId and relies on the
  // composite foreign key alone.
  const createProject = (clientId: string) =>
    withErrorHandling(async () => {
      const project = await tenantA.project.create({
        data: { organizationId: orgAId, clientId, name: "New project" },
      });
      return Response.json(project, { status: 201 });
    })(new Request("http://localhost/api/projects", { method: "POST" }));

  it("responds 404, not 500, for another organization's clientId", async () => {
    const response = await createProject(clientB.id);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual(NOT_FOUND_BODY);
    expect(JSON.stringify(body)).not.toMatch(/fkey|23503|Project|Client/);
  });

  it("responds identically for a nonexistent clientId", async () => {
    const response = await createProject("does-not-exist");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY);
  });

  it("still succeeds for the organization's own client", async () => {
    const response = await createProject(clientA.id);
    expect(response.status).toBe(201);
  });

  it("responds 404 when re-pointing a project at another organization's client", async () => {
    const project = await tenantA.project.create({
      data: { organizationId: orgAId, clientId: clientA.id, name: "Existing" },
    });
    const response = await withErrorHandling(async () => {
      await tenantA.project.update({ where: { id: project.id }, data: { clientId: clientB.id } });
      return Response.json({ ok: true });
    })(new Request("http://localhost/api/projects", { method: "PATCH" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual(NOT_FOUND_BODY);
  });

  it("responds 409 when deleting a client that still has projects", async () => {
    await tenantA.project.create({
      data: { organizationId: orgAId, clientId: clientA.id, name: "Child" },
    });
    for (const remove of [
      () => tenantA.client.delete({ where: { id: clientA.id } }),
      () => tenantA.client.deleteMany({ where: { id: clientA.id } }),
    ]) {
      const response = await withErrorHandling(async () => {
        await remove();
        return new Response(null, { status: 204 });
      })(new Request("http://localhost/api/clients", { method: "DELETE" }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: { code: "CONFLICT", message: "This record is still referenced by other records" },
      });
    }
    await expect(tenantA.client.count()).resolves.toBe(1);
  });
});
