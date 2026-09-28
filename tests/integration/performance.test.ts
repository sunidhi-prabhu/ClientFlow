import { beforeEach, describe, expect, it } from "vitest";

import { type Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { parseListAuditLogQuery } from "@/lib/validation/audit";
import { parseListClientsQuery } from "@/lib/validation/client";
import { parseListInvoicesQuery } from "@/lib/validation/invoice";
import { parseListProjectsQuery } from "@/lib/validation/project";
import { AUDIT_COUNT_LIMIT, listAuditLog } from "@/server/audit/service";
import { listClients } from "@/server/clients/service";
import { getDashboard } from "@/server/dashboard/service";
import { listClientInvoices, listInvoices } from "@/server/invoices/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { listProjects } from "@/server/projects/service";
import { getTenantDb } from "@/server/tenancy";
import { createTenantDb } from "@/server/tenancy/tenant-db";

import { createVerifiedUser } from "./support/auth";

/*
 * Regression tests for the performance audit fixes: statement counts that do
 * not grow with data, derived totals that equal real counts, the capped audit
 * count, and indexes that the generated SQL can actually use.
 */

let acme: { id: string };

beforeEach(async () => {
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
});

/** A tenant client on a Prisma client that records every SQL statement. */
async function counting() {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const statements: { query: string; params: string }[] = [];
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    log: [{ emit: "event", level: "query" }],
  });
  client.$on("query", (event) => statements.push({ query: event.query, params: event.params }));
  return { client, statements, db: createTenantDb(client, acme.id) };
}

async function seed(scale: number) {
  const clients = Array.from({ length: 10 * scale }, (_, i) => ({
    id: `c${scale}_${i}`,
    organizationId: acme.id,
    name: `Client ${i}`,
    status: (["ACTIVE", "INACTIVE", "ARCHIVED"] as const)[i % 3],
  }));
  await getDb().client.createMany({ data: clients });
  await getDb().project.createMany({
    data: Array.from({ length: 10 * scale }, (_, i) => ({
      id: `p${scale}_${i}`,
      organizationId: acme.id,
      clientId: clients[i % clients.length].id,
      name: `Project ${i}`,
      status: (["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] as const)[i % 5],
      dueDate: i % 2 ? new Date(Date.UTC(2026, 0, 1 + i)) : null,
    })),
  });
  await getDb().task.createMany({
    data: Array.from({ length: 50 * scale }, (_, i) => ({
      organizationId: acme.id,
      projectId: `p${scale}_${i % (10 * scale)}`,
      title: `Task ${i}`,
      status: (["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const)[i % 4],
    })),
  });
  await getDb().invoice.createMany({
    data: Array.from({ length: 10 * scale }, (_, i) => {
      const issued = i % 4 === 1 || i % 4 === 2;
      return {
        organizationId: acme.id,
        clientId: clients[i % clients.length].id,
        status: (["DRAFT", "ISSUED", "PAID", "CANCELLED"] as const)[i % 4],
        currency: i % 2 ? "EUR" : "USD",
        subtotalCents: 100 * i,
        totalCents: 100 * i,
        dueDate: new Date(Date.UTC(i % 3 ? 2020 : 2099, 0, 1)),
        ...(issued && {
          number: scale * 1000 + i,
          issueDate: new Date(Date.UTC(2019, 0, 1)),
          issuedAt: new Date(),
        }),
        ...(i % 4 === 2 && { paidAt: new Date() }),
        ...(i % 4 === 3 && { cancelledAt: new Date() }),
      };
    }),
  });
}

describe("statement counts do not grow with data", () => {
  it("lists, the client invoice widget and the dashboard", async () => {
    const { client, statements, db } = await counting();
    async function countFor() {
      const counts: Record<string, number> = {};
      const measure = async (name: string, run: () => Promise<unknown>) => {
        statements.length = 0;
        await run();
        counts[name] = statements.length;
      };
      await measure("clients", () => listClients(db, parseListClientsQuery({ q: "client" })));
      await measure("projects", () => listProjects(db, parseListProjectsQuery({ q: "project" })));
      await measure("invoices", () => listInvoices(db, parseListInvoicesQuery({ q: "client" })));
      await measure("client invoices", () => listClientInvoices(db, "c1_1"));
      await measure("dashboard", () => getDashboard(db, "OWNER"));
      return counts;
    }
    try {
      await seed(1);
      const small = await countFor();
      await seed(8);
      const large = await countFor();
      expect(large).toEqual(small);
      // Before the performance pass: clients 3, projects 4, invoices 5, client widget 5.
      expect(small).toMatchObject({ clients: 2, projects: 3, invoices: 4, "client invoices": 1 });
      expect(small.dashboard).toBeLessThanOrEqual(14);
    } finally {
      await client.$disconnect();
    }
  });

  it("the dashboard counts open tasks only for the projects it shows", async () => {
    await seed(3);
    const { client, statements, db } = await counting();
    try {
      const dashboard = await getDashboard(db, "OWNER");
      const openTaskCount = statements.find(
        (s) => s.query.includes('FROM "public"."Task"') && s.query.includes('"projectId" IN'),
      );
      expect(openTaskCount).toBeDefined();
      // Bound to the (at most 5) listed projects, not the whole organization.
      const ids = dashboard.projects!.activeProjects.map((p) => p.id);
      for (const id of ids) expect(openTaskCount!.params).toContain(id);
      // Same numbers as a direct count.
      for (const project of dashboard.projects!.activeProjects) {
        const open = await getDb().task.count({
          where: { projectId: project.id, status: { not: "DONE" } },
        });
        expect({ id: project.id, open: project.openTasks }).toEqual({ id: project.id, open });
      }
    } finally {
      await client.$disconnect();
    }
  });
});

describe("derived list totals equal real counts", () => {
  it("clients, projects and invoices for every status filter, with and without search", async () => {
    await seed(2);
    const db = getTenantDb(acme.id);
    for (const q of [undefined, "1"]) {
      for (const status of ["current", "ACTIVE", "INACTIVE", "ARCHIVED", "all"]) {
        const result = await listClients(db, parseListClientsQuery({ status, ...(q && { q }) }));
        const where: Prisma.ClientWhereInput = {
          organizationId: acme.id,
          ...(status === "current"
            ? { status: { not: "ARCHIVED" } }
            : status === "all"
              ? {}
              : { status: status as "ACTIVE" }),
          ...(q && {
            OR: [
              { name: { contains: q } },
              { company: { contains: q } },
              { email: { contains: q } },
            ],
          }),
        };
        expect({ status, q, total: result.total }).toEqual({
          status,
          q,
          total: await getDb().client.count({ where }),
        });
      }
      for (const status of ["current", "PLANNING", "ACTIVE", "ARCHIVED", "all"]) {
        const result = await listProjects(db, parseListProjectsQuery({ status, ...(q && { q }) }));
        expect(result.total).toBe(
          (
            await listProjects(
              db,
              parseListProjectsQuery({ status, pageSize: "100", ...(q && { q }) }),
            )
          ).items.length,
        );
      }
      for (const status of ["all", "DRAFT", "ISSUED", "OVERDUE", "PAID", "CANCELLED"]) {
        const result = await listInvoices(
          db,
          parseListInvoicesQuery({ status, pageSize: "100", ...(q && { q }) }),
        );
        expect({ status, q, total: result.total }).toEqual({
          status,
          q,
          total: result.items.length,
        });
      }
    }
  });
});

describe("audit log count is capped", () => {
  async function seedAudit(count: number) {
    const base = Date.UTC(2026, 0, 1);
    for (let offset = 0; offset < count; offset += 5_000) {
      await getDb().auditLog.createMany({
        data: Array.from({ length: Math.min(5_000, count - offset) }, (_, i) => ({
          organizationId: acme.id,
          action: "client.updated",
          resourceType: "client",
          resourceId: `r${offset + i}`,
          createdAt: new Date(base + (offset + i) * 1000),
        })),
      });
    }
  }

  it(`stops counting at ${AUDIT_COUNT_LIMIT} and limits paging to the newest events`, async () => {
    await seedAudit(AUDIT_COUNT_LIMIT + 50); // + organization.created and member.added
    const { client, statements, db } = await counting();
    try {
      const first = await listAuditLog(db, parseListAuditLogQuery({}));
      expect(first).toMatchObject({
        total: AUDIT_COUNT_LIMIT,
        totalIsCapped: true,
        pageCount: 400,
      });
      const count = statements.find((s) => s.query.includes("COUNT(*)"))!;
      // Counting stops after LIMIT + 1 rows instead of reading the whole log.
      expect(count.query).toMatch(new RegExp(`LIMIT (\\$\\d+|${AUDIT_COUNT_LIMIT + 1})`));

      const beyond = await listAuditLog(db, parseListAuditLogQuery({ page: "5000" }));
      expect(beyond.page).toBe(400);
      expect(beyond.items).toHaveLength(25);
      // The last reachable page holds events 9,976-10,000 counting from the newest.
      const newestFirst = await getDb().auditLog.findMany({
        where: { organizationId: acme.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: AUDIT_COUNT_LIMIT - 25,
        take: 25,
        select: { id: true },
      });
      expect(beyond.items.map((item) => item.id)).toEqual(newestFirst.map((item) => item.id));
    } finally {
      await client.$disconnect();
    }
  });

  it("is exact below the limit, including with filters", async () => {
    await seedAudit(120);
    const db = getTenantDb(acme.id);
    await expect(listAuditLog(db, parseListAuditLogQuery({}))).resolves.toMatchObject({
      total: 122,
      totalIsCapped: false,
    });
    await expect(
      listAuditLog(db, parseListAuditLogQuery({ action: "member.added" })),
    ).resolves.toMatchObject({ total: 1, totalIsCapped: false });
  });
});

describe("the new indexes serve the generated SQL", () => {
  /** Plan of the statement a service issues, with sequential scans disabled (tiny test data). */
  async function planOf(
    run: (db: ReturnType<typeof createTenantDb>) => Promise<unknown>,
    match: RegExp,
  ) {
    const { client, statements, db } = await counting();
    try {
      await run(db);
      const statement = statements.find((s) => match.test(s.query));
      if (!statement) throw new Error(`no statement matching ${match}`);
      const rows = await getDb().$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
          `EXPLAIN ${statement.query}`,
          ...JSON.parse(statement.params),
        );
      });
      return rows.map((row) => row["QUERY PLAN"]).join("\n");
    } finally {
      await client.$disconnect();
    }
  }

  it("audit log pages are read in index order without sorting", async () => {
    const plan = await planOf(
      (db) => listAuditLog(db, parseListAuditLogQuery({})),
      /^SELECT "public"."AuditLog"."id", "public"."AuditLog"."action"/,
    );
    expect(plan).toContain("AuditLog_organizationId_createdAt_id_idx");
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it("the trigram index accepts the search pattern the client list sends", async () => {
    // With a handful of rows the planner rightly prefers the organization index;
    // this checks the index can serve the exact escaped ILIKE pattern.
    const { client, statements, db } = await counting();
    try {
      await listClients(db, parseListClientsQuery({ q: "wayne_%" }));
      const search = statements.find((s) => s.query.includes("ILIKE"))!;
      // Prisma sends ILIKE ('%' || $n || '%') with the escaped term as the parameter.
      expect(search.query).toContain(`ILIKE ('%' || $`);
      const term = (JSON.parse(search.params) as unknown[]).find(
        (param) => typeof param === "string" && param.startsWith("wayne"),
      ) as string;
      expect(term).toBe("wayne\\_\\%");
      const plan = await getDb().$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
          `EXPLAIN SELECT id FROM "Client" WHERE name ILIKE ('%' || $1 || '%') OR company ILIKE ('%' || $1 || '%') OR email ILIKE ('%' || $1 || '%')`,
          term,
        );
      });
      expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "Client_name_company_email_idx",
      );
    } finally {
      await client.$disconnect();
    }
  });

  it("invoice sorts by amount and due date use their indexes", async () => {
    for (const [sort, index] of [
      ["amount", "Invoice_organizationId_totalCents_id_idx"],
      ["due", "Invoice_organizationId_dueDate_id_idx"],
    ] as const) {
      const plan = await planOf(
        (db) => listInvoices(db, parseListInvoicesQuery({ sort })),
        /SELECT "public"."Invoice"."id", "public"."Invoice"."number"/,
      );
      expect({ sort, usesIndex: plan.includes(index) }).toEqual({ sort, usesIndex: true });
    }
  });

  it("the dashboard picks its active projects from the status/due-date index", async () => {
    const plan = await planOf(
      (db) => getDashboard(db, "OWNER"),
      /FROM "public"."Project" WHERE .*"status" = .*ORDER BY/,
    );
    expect(plan).toContain("Project_organizationId_status_dueDate_idx");
  });

  it("invoice search joins the client table once", async () => {
    const { client, statements, db } = await counting();
    try {
      await listInvoices(db, parseListInvoicesQuery({ q: "wayne" }));
      for (const statement of statements.filter((s) => s.query.includes("ILIKE"))) {
        expect(statement.query.match(/JOIN "public"."Client"/g)?.length ?? 0).toBeLessThanOrEqual(
          1,
        );
      }
    } finally {
      await client.$disconnect();
    }
  });
});
