import { readFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { recordAudit } from "@/server/audit/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { createTenantDb } from "@/server/tenancy/tenant-db";

import { createVerifiedUser } from "./support/auth";

/*
 * Regression for audit finding M2: the application must not run as the
 * schema owner. db/runtime-role.sql (applied here to a test role) leaves the
 * app able to do its work, but not to erase or rewrite the audit log, disable
 * triggers or change the schema, even with arbitrary SQL.
 */

const ROLE = "clientflow_app_it";
const PASSWORD = "integration-runtime-role";

let admin: pg.Client;
let app: PrismaClient;
let acme: { id: string };
let ownerId: string;

function runtimeUrl() {
  const url = new URL(process.env.DATABASE_URL!);
  url.username = ROLE;
  url.password = PASSWORD;
  return url.href;
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
  }
  // The exact script operators run, for this test's role name.
  const script = readFileSync("db/runtime-role.sql", "utf8").replaceAll(
    /\bclientflow_app\b/g,
    ROLE,
  );
  await admin.query(script);
  app = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl() }) });
});

afterAll(async () => {
  await app?.$disconnect();
  await admin.query(`DROP OWNED BY ${ROLE}`);
  await admin.query(`DROP ROLE ${ROLE}`);
  await admin.end();
});

beforeEach(async () => {
  const owner = await createVerifiedUser("owner@example.com");
  ownerId = owner.userId;
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
});

/** Runs raw SQL as the runtime role and returns the error message (or "ok"). */
async function asRuntimeRole(sql: string) {
  return app.$executeRawUnsafe(sql).then(
    () => "ok",
    (error: unknown) => String((error as Error).message),
  );
}

describe("runtime database role (db/runtime-role.sql)", () => {
  it("can do the application's work, including appending audit records", async () => {
    const db = createTenantDb(app, acme.id);
    const client = await db.client.create({ data: { organizationId: acme.id, name: "Wayne" } });
    await db.client.update({ where: { id: client.id }, data: { name: "Wayne Ent." } });
    await recordAudit(
      db,
      { organizationId: acme.id, actorUserId: ownerId },
      {
        action: "client.created",
        resourceId: client.id,
      },
    );
    await expect(db.auditLog.count({ where: { action: "client.created" } })).resolves.toBe(1);
    await db.client.delete({ where: { id: client.id } });
  });

  it("cannot rewrite, delete or truncate audit records, even with raw SQL", async () => {
    await recordAudit(
      createTenantDb(app, acme.id),
      { organizationId: acme.id, actorUserId: ownerId },
      {
        action: "client.created",
        resourceId: "c1",
      },
    );
    expect(await asRuntimeRole(`UPDATE "AuditLog" SET "action" = 'client.updated'`)).toMatch(
      /permission denied/,
    );
    expect(await asRuntimeRole(`DELETE FROM "AuditLog"`)).toMatch(/permission denied/);
    expect(await asRuntimeRole(`TRUNCATE "AuditLog"`)).toMatch(/permission denied/);
    expect(await asRuntimeRole(`TRUNCATE "Client"`)).toMatch(/permission denied/);
    expect(await getDb().auditLog.count({ where: { organizationId: acme.id } })).toBe(3);
  });

  it("cannot disable triggers or change the schema", async () => {
    expect(await asRuntimeRole(`ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_guard"`)).toMatch(
      /must be owner/,
    );
    expect(await asRuntimeRole(`ALTER TABLE "Invoice" DISABLE TRIGGER ALL`)).toMatch(
      /must be owner/,
    );
    expect(await asRuntimeRole(`DROP TABLE "AuditLog"`)).toMatch(/must be owner/);
    expect(await asRuntimeRole(`CREATE TABLE "Evil" (id int)`)).toMatch(/permission denied/);
    expect(await asRuntimeRole(`DELETE FROM "_prisma_migrations"`)).toMatch(/permission denied/);
  });

  it("still lets an organization or user deletion cascade through the audit log", async () => {
    const other = await createVerifiedUser("other@example.com");
    const globex = await createOrganization(other.userId, { name: "Globex", slug: "globex" });
    await app.organization.delete({ where: { id: globex.id } });
    expect(await getDb().auditLog.count({ where: { organizationId: globex.id } })).toBe(0);

    const leaver = await createVerifiedUser("leaver@example.com");
    await recordAudit(
      createTenantDb(app, acme.id),
      { organizationId: acme.id, actorUserId: leaver.userId },
      {
        action: "client.updated",
        resourceId: "c1",
      },
    );
    await app.user.delete({ where: { id: leaver.userId } });
    const [record] = await getDb().auditLog.findMany({ where: { action: "client.updated" } });
    expect(record.actorUserId).toBeNull();
  });
});
