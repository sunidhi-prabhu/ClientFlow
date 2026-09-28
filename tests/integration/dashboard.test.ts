import { beforeEach, describe, expect, it, vi } from "vitest";

import { type MembershipRole } from "@/generated/prisma/enums";
import { toAppError } from "@/lib/api/handle-error";
import { getDb } from "@/lib/db";
import { getDashboard } from "@/server/dashboard/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantPage } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

type Member = { userId: string; cookie: string };

// A fixed "now": today (UTC) is 2026-09-28.
const now = new Date("2026-09-28T18:30:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: Member;

const as = (role: MembershipRole) => actAs(members[role].cookie);

const seedClient = (
  organizationId: string,
  name: string,
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED" = "ACTIVE",
) => getDb().client.create({ data: { organizationId, name, status } });

function seedProject(
  organizationId: string,
  name: string,
  data: {
    status?: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
    progress?: number;
    dueDate?: Date;
    clientId?: string;
  } = {},
) {
  return getDb().project.create({ data: { organizationId, name, status: "ACTIVE", ...data } });
}

function seedTasks(
  organizationId: string,
  projectId: string,
  counts: Partial<Record<"TODO" | "IN_PROGRESS" | "REVIEW" | "DONE", number>>,
) {
  return getDb().task.createMany({
    data: Object.entries(counts).flatMap(([status, count]) =>
      Array.from({ length: count }, (_, index) => ({
        organizationId,
        projectId,
        title: `${status} ${index}`,
        status: status as "TODO",
      })),
    ),
  });
}

let invoiceNumber = 0;

/** Inserts an invoice in its final state (the transition trigger only guards updates). */
function seedInvoice(
  organizationId: string,
  clientId: string,
  data: {
    status: "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
    totalCents: number;
    currency?: string;
    dueDate?: Date;
  },
) {
  const issued = data.status === "ISSUED" || data.status === "PAID";
  return getDb().invoice.create({
    data: {
      organizationId,
      clientId,
      status: data.status,
      currency: data.currency ?? "USD",
      subtotalCents: data.totalCents,
      totalCents: data.totalCents,
      dueDate: data.dueDate ?? (issued ? day("2026-10-31") : null),
      ...(issued && { number: ++invoiceNumber, issueDate: day("2026-01-01"), issuedAt: now }),
      ...(data.status === "PAID" && { paidAt: now }),
      ...(data.status === "CANCELLED" && { cancelledAt: now }),
    },
  });
}

beforeEach(async () => {
  invoiceNumber = 0;
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
  members.OWNER = owner;
  for (const role of ["ADMIN", "MANAGER", "MEMBER"] as const) {
    const user = await createVerifiedUser(`${role.toLowerCase()}@example.com`);
    await getDb().membership.create({
      data: { organizationId: acme.id, userId: user.userId, role },
    });
    members[role] = user;
  }
  outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
});

/** A realistic Acme plus a noisy Globex that must never show up in Acme's numbers. */
async function seedAcme() {
  const wayne = await seedClient(acme.id, "Wayne Enterprises");
  const stark = await seedClient(acme.id, "Stark Industries");
  await seedClient(acme.id, "Initech", "INACTIVE");
  await seedClient(acme.id, "Umbrella", "ARCHIVED");

  const site = await seedProject(acme.id, "Website", {
    progress: 40,
    dueDate: day("2026-09-01"),
    clientId: wayne.id,
  });
  const app = await seedProject(acme.id, "Mobile app", {
    progress: 75,
    dueDate: day("2026-12-01"),
  });
  await seedProject(acme.id, "Research", { status: "PLANNING" });
  await seedProject(acme.id, "Paused", { status: "ON_HOLD" });
  await seedProject(acme.id, "Shipped", { status: "COMPLETED", progress: 100 });
  const archived = await seedProject(acme.id, "Old", { status: "ARCHIVED" });

  await seedTasks(acme.id, site.id, { TODO: 2, IN_PROGRESS: 1, REVIEW: 1, DONE: 3 });
  await seedTasks(acme.id, app.id, { TODO: 1, DONE: 1 });
  // Tasks of an archived project are not counted.
  await seedTasks(acme.id, archived.id, { TODO: 5 });

  await seedInvoice(acme.id, wayne.id, { status: "DRAFT", totalCents: 999 });
  await seedInvoice(acme.id, wayne.id, { status: "ISSUED", totalCents: 100_001 });
  // Due today: not overdue yet.
  await seedInvoice(acme.id, wayne.id, {
    status: "ISSUED",
    totalCents: 50_000,
    dueDate: day("2026-09-28"),
  });
  // Due yesterday and last month: overdue.
  await seedInvoice(acme.id, stark.id, {
    status: "ISSUED",
    totalCents: 20_050,
    dueDate: day("2026-09-27"),
  });
  await seedInvoice(acme.id, stark.id, {
    status: "ISSUED",
    totalCents: 7,
    dueDate: day("2026-08-15"),
  });
  // Paid after its due date: paid, not overdue.
  await seedInvoice(acme.id, stark.id, {
    status: "PAID",
    totalCents: 12_345,
    dueDate: day("2026-09-01"),
  });
  await seedInvoice(acme.id, stark.id, { status: "CANCELLED", totalCents: 4_444 });
  await seedInvoice(acme.id, stark.id, { status: "PAID", totalCents: 2_500, currency: "EUR" });

  await getDb().clientActivity.createMany({
    data: [
      {
        organizationId: acme.id,
        clientId: wayne.id,
        type: "CREATED",
        createdAt: day("2026-09-01"),
      },
      {
        organizationId: acme.id,
        clientId: stark.id,
        type: "UPDATED",
        actorUserId: members.MANAGER.userId,
        changes: { email: { from: null, to: "x@example.com" } },
        createdAt: day("2026-09-20"),
      },
    ],
  });
  await getDb().projectActivity.createMany({
    data: [
      {
        organizationId: acme.id,
        projectId: site.id,
        type: "CREATED",
        actorUserId: members.OWNER.userId,
        createdAt: day("2026-09-02"),
      },
      {
        organizationId: acme.id,
        projectId: site.id,
        type: "TASK_STATUS_CHANGED",
        actorUserId: members.MEMBER.userId,
        changes: { task: { title: "Wireframes" }, status: { from: "TODO", to: "REVIEW" } },
        createdAt: day("2026-09-25"),
      },
    ],
  });

  return { wayne, stark, site, app };
}

async function seedGlobex(scale = 1) {
  const client = await seedClient(globex.id, "Globex client");
  const project = await seedProject(globex.id, "Globex project", { dueDate: day("2026-01-01") });
  await seedTasks(globex.id, project.id, { TODO: 4 * scale, DONE: 2 * scale });
  for (let index = 0; index < 3 * scale; index++) {
    await seedInvoice(globex.id, client.id, {
      status: "ISSUED",
      totalCents: 1_000_000,
      dueDate: day("2026-01-31"),
    });
  }
  await getDb().clientActivity.create({
    data: { organizationId: globex.id, clientId: client.id, type: "CREATED", createdAt: now },
  });
  await getDb().projectActivity.create({
    data: { organizationId: globex.id, projectId: project.id, type: "CREATED", createdAt: now },
  });
}

describe("dashboard metrics", () => {
  it("computes every metric for the organization in the database", async () => {
    const { site, app } = await seedAcme();
    await seedGlobex();

    const dashboard = await getDashboard(getTenantDb(acme.id), "OWNER", now);

    expect(dashboard.clients).toEqual({
      total: 3,
      byStatus: { ACTIVE: 2, INACTIVE: 1, ARCHIVED: 1 },
    });
    expect(dashboard.projects).toMatchObject({
      active: 2,
      byStatus: { PLANNING: 1, ACTIVE: 2, ON_HOLD: 1, COMPLETED: 1, ARCHIVED: 1 },
    });
    // Active projects only, soonest due first, with their open (not done) task counts.
    expect(dashboard.projects!.activeProjects).toEqual([
      expect.objectContaining({
        id: site.id,
        name: "Website",
        progress: 40,
        dueDate: day("2026-09-01"),
        client: expect.objectContaining({ name: "Wayne Enterprises" }),
        openTasks: 4,
      }),
      expect.objectContaining({ id: app.id, progress: 75, client: null, openTasks: 1 }),
    ]);
    expect(dashboard.tasks).toEqual({
      total: 9,
      open: 5,
      byStatus: { TODO: 3, IN_PROGRESS: 1, REVIEW: 1, DONE: 4 },
    });
  });

  it("derives OVERDUE and totals invoices in exact integer cents per currency", async () => {
    await seedAcme();
    await seedGlobex();

    const { invoices } = await getDashboard(getTenantDb(acme.id), "OWNER", now);

    expect(invoices!.total).toBe(8);
    expect(invoices!.overdueCount).toBe(2);
    expect(invoices!.overdue).toEqual([{ currency: "USD", cents: 20_057 }]);
    expect(invoices!.byStatus).toEqual({
      DRAFT: { count: 1, amounts: [{ currency: "USD", cents: 999 }] },
      ISSUED: { count: 2, amounts: [{ currency: "USD", cents: 150_001 }] },
      OVERDUE: { count: 2, amounts: [{ currency: "USD", cents: 20_057 }] },
      PAID: {
        count: 2,
        amounts: [
          { currency: "EUR", cents: 2_500 },
          { currency: "USD", cents: 12_345 },
        ],
      },
      CANCELLED: { count: 1, amounts: [{ currency: "USD", cents: 4_444 }] },
    });
    // Invoiced = issued (including overdue) + paid; drafts and cancelled invoices are excluded.
    expect(invoices!.invoiced).toEqual([
      { currency: "EUR", cents: 2_500 },
      { currency: "USD", cents: 100_001 + 50_000 + 20_050 + 7 + 12_345 },
    ]);
    expect(invoices!.paid).toEqual([
      { currency: "EUR", cents: 2_500 },
      { currency: "USD", cents: 12_345 },
    ]);
    expect(invoices!.outstanding).toEqual([
      { currency: "EUR", cents: 0 },
      { currency: "USD", cents: 170_058 },
    ]);
  });

  it("matches the invoice list's derived status counts", async () => {
    await seedAcme();
    const { listInvoices } = await import("@/server/invoices/service");
    const db = getTenantDb(acme.id);
    const [{ invoices }, list] = await Promise.all([
      getDashboard(db, "OWNER", now),
      listInvoices(
        db,
        { status: "all", sort: "newest", page: 1, pageSize: 20 } as Parameters<
          typeof listInvoices
        >[1],
        now,
      ),
    ]);
    expect(
      Object.fromEntries(Object.entries(invoices!.byStatus).map(([s, v]) => [s, v.count])),
    ).toEqual(list.statusCounts);
  });

  it("moves an invoice to overdue exactly when its due date passes (UTC)", async () => {
    const client = await seedClient(acme.id, "Wayne");
    await seedInvoice(acme.id, client.id, {
      status: "ISSUED",
      totalCents: 1_00,
      dueDate: day("2026-09-28"),
    });
    const db = getTenantDb(acme.id);
    const lastMoment = new Date("2026-09-28T23:59:59.999Z");
    const nextDay = new Date("2026-09-29T00:00:00Z");
    await expect(getDashboard(db, "OWNER", lastMoment)).resolves.toMatchObject({
      invoices: { overdueCount: 0 },
    });
    await expect(getDashboard(db, "OWNER", nextDay)).resolves.toMatchObject({
      invoices: { overdueCount: 1, overdue: [{ currency: "USD", cents: 1_00 }] },
    });
  });

  it("lists recent project/task and client activity, newest first, with actors and subjects", async () => {
    await seedAcme();
    await seedGlobex();
    const dashboard = await getDashboard(getTenantDb(acme.id), "OWNER", now);

    expect(dashboard.projectActivity).toEqual([
      expect.objectContaining({
        type: "TASK_STATUS_CHANGED",
        taskId: null,
        actor: { name: "Test User", email: "member@example.com" },
        project: expect.objectContaining({ name: "Website" }),
      }),
      expect.objectContaining({
        type: "CREATED",
        project: expect.objectContaining({ name: "Website" }),
      }),
    ]);
    expect(dashboard.clientActivity).toEqual([
      expect.objectContaining({
        type: "UPDATED",
        actor: { name: "Test User", email: "manager@example.com" },
        client: expect.objectContaining({ name: "Stark Industries" }),
      }),
      expect.objectContaining({ type: "CREATED", actor: null }),
    ]);
  });

  it("caps each activity feed", async () => {
    const client = await seedClient(acme.id, "Busy");
    await getDb().clientActivity.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        organizationId: acme.id,
        clientId: client.id,
        type: "UPDATED" as const,
        createdAt: new Date(now.getTime() - index * 60_000),
      })),
    });
    const { clientActivity } = await getDashboard(getTenantDb(acme.id), "OWNER", now);
    expect(clientActivity).toHaveLength(8);
    expect(clientActivity![0].createdAt).toEqual(now);
  });

  it("returns zeros and empty lists for an empty organization", async () => {
    await seedGlobex();
    await expect(getDashboard(getTenantDb(acme.id), "OWNER", now)).resolves.toEqual({
      clients: { total: 0, byStatus: { ACTIVE: 0, INACTIVE: 0, ARCHIVED: 0 } },
      projects: {
        active: 0,
        byStatus: { PLANNING: 0, ACTIVE: 0, ON_HOLD: 0, COMPLETED: 0, ARCHIVED: 0 },
        activeProjects: [],
      },
      tasks: { total: 0, open: 0, byStatus: { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 } },
      invoices: {
        total: 0,
        overdueCount: 0,
        invoiced: [],
        paid: [],
        outstanding: [],
        overdue: [],
        byStatus: {
          DRAFT: { count: 0, amounts: [] },
          ISSUED: { count: 0, amounts: [] },
          OVERDUE: { count: 0, amounts: [] },
          PAID: { count: 0, amounts: [] },
          CANCELLED: { count: 0, amounts: [] },
        },
      },
      projectActivity: [],
      clientActivity: [],
    });
  });
});

describe("tenant isolation", () => {
  it("resolves the organization from the session and never mixes organizations", async () => {
    await seedAcme();
    await seedGlobex();

    actAs(outsider.cookie);
    const access = await tenantPage("globex", "organization:read");
    expect(access.allowed).toBe(true);
    if (!access.allowed) return;
    const dashboard = await getDashboard(access.db, access.ctx.role, now);

    expect(dashboard.clients!.total).toBe(1);
    expect(dashboard.projects!.activeProjects.map((p) => p.name)).toEqual(["Globex project"]);
    expect(dashboard.tasks).toMatchObject({ total: 6, open: 4 });
    expect(dashboard.invoices).toMatchObject({
      total: 3,
      overdueCount: 3,
      invoiced: [{ currency: "USD", cents: 3_000_000 }],
    });
    expect(dashboard.projectActivity!.map((a) => a.project.name)).toEqual(["Globex project"]);
    expect(dashboard.clientActivity!.map((a) => a.client.name)).toEqual(["Globex client"]);
  });

  it("does not let a member open another organization's dashboard", async () => {
    await seedGlobex();
    as("OWNER");
    await expect(tenantPage("globex", "organization:read")).rejects.toThrow();
    actAs(outsider.cookie);
    await expect(tenantPage("acme", "organization:read")).rejects.toThrow();
  });

  it("requires a session", async () => {
    actAs(undefined);
    const error = await tenantPage("acme", "organization:read").catch((caught: unknown) => caught);
    expect((error as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;.*;\/sign-in/);
  });
});

describe("role-based access", () => {
  for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
    it(`${role} sees every section, including invoices`, async () => {
      await seedAcme();
      as(role);
      const access = await tenantPage("acme", "organization:read");
      if (!access.allowed) throw new Error("expected access");
      const dashboard = await getDashboard(access.db, access.ctx.role, now);
      expect(access.ctx.role).toBe(role);
      expect(dashboard.invoices?.overdueCount).toBe(2);
      expect(dashboard.clients?.total).toBe(3);
    });
  }

  it("MEMBER sees clients, projects, tasks and activity but no invoice data", async () => {
    await seedAcme();
    as("MEMBER");
    const access = await tenantPage("acme", "organization:read");
    if (!access.allowed) throw new Error("expected access");
    const dashboard = await getDashboard(access.db, access.ctx.role, now);
    expect(dashboard.invoices).toBeNull();
    expect(dashboard.clients?.total).toBe(3);
    expect(dashboard.projects?.active).toBe(2);
    expect(dashboard.tasks?.open).toBe(5);
    expect(dashboard.projectActivity).toHaveLength(2);
    expect(dashboard.clientActivity).toHaveLength(2);
  });
});

describe("error handling", () => {
  it("surfaces a database failure as a generic error without internals", async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { createTenantDb } = await import("@/server/tenancy/tenant-db");
    const unreachable = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: "postgresql://nobody:secret@127.0.0.1:1/unreachable",
        connectionTimeoutMillis: 2_000,
      }),
    });
    try {
      const error = await getDashboard(createTenantDb(unreachable, acme.id), "OWNER", now).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      const appError = toAppError(error);
      expect(appError.status).toBeGreaterThanOrEqual(500);
      expect(appError.message).not.toMatch(/secret|127\.0\.0\.1|unreachable/);
    } finally {
      await unreachable.$disconnect();
    }
  });
});

describe("query efficiency", () => {
  async function countQueries(role: MembershipRole) {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { createTenantDb } = await import("@/server/tenancy/tenant-db");
    const statements: string[] = [];
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      log: [{ emit: "event", level: "query" }],
    });
    counting.$on("query", (event) => statements.push(event.query));
    try {
      await getDashboard(createTenantDb(counting, acme.id), role, now);
      return statements;
    } finally {
      await counting.$disconnect();
    }
  }

  it("uses a constant number of aggregate queries regardless of data size (no N+1)", async () => {
    const small = await countQueries("OWNER");

    // Many more clients, projects, tasks, invoices and activity rows.
    const { wayne, site } = await seedAcme();
    for (let index = 0; index < 12; index++) {
      const project = await seedProject(acme.id, `Bulk ${index}`, { clientId: wayne.id });
      await seedTasks(acme.id, project.id, { TODO: 3, DONE: 2 });
      await seedInvoice(acme.id, wayne.id, { status: "ISSUED", totalCents: 100 + index });
      await getDb().projectActivity.create({
        data: { organizationId: acme.id, projectId: project.id, type: "CREATED" },
      });
    }
    await seedTasks(acme.id, site.id, { REVIEW: 20 });
    const large = await countQueries("OWNER");

    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThanOrEqual(14);
    // Totals are aggregated in SQL, not by loading every invoice or task.
    expect(large.some((sql) => /SUM\(.*"totalCents"/.test(sql))).toBe(true);
    expect(large.filter((sql) => /GROUP BY/.test(sql)).length).toBeGreaterThanOrEqual(5);
  });

  it("does not query invoices at all for a role without invoice:read", async () => {
    await seedAcme();
    const statements = await countQueries("MEMBER");
    expect(statements.some((sql) => sql.includes('"Invoice"'))).toBe(false);
    expect(statements.length).toBeLessThan((await countQueries("OWNER")).length);
  });
});
