import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInvoiceAction, issueInvoiceAction } from "@/app/o/[orgSlug]/invoices/actions";
import { getDb } from "@/lib/db";
import { parseListAuditLogQuery } from "@/lib/validation/audit";
import { parseListInvoicesQuery } from "@/lib/validation/invoice";
import { listAuditLog } from "@/server/audit/service";
import { getDashboard } from "@/server/dashboard/service";
import { listInvoices } from "@/server/invoices/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { BOARD_TASK_LIMIT, listProjectTasks } from "@/server/tasks/service";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

/*
 * Boundary and combination cases not covered by the per-module suites:
 * date boundaries, pagination edges, filter combinations, multi-currency,
 * board limits and empty/archived-only states.
 */

let acme: { id: string; slug: string };
let owner: { userId: string; cookie: string };

const todayUtc = () => new Date().toISOString().slice(0, 10);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

beforeEach(async () => {
  owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
});

describe("invoice date boundaries", () => {
  it("an invoice due today (UTC) can be issued; the check is on calendar days", async () => {
    const client = await getDb().client.create({
      data: { organizationId: acme.id, name: "Wayne" },
    });
    actAs(owner.cookie);
    const { redirectedTo } = await runRedirecting(
      createInvoiceAction("acme", {
        clientId: client.id,
        dueDate: todayUtc(),
        items: [{ description: "Design", quantity: "1", unitPrice: "10" }],
      }),
    );
    const id = redirectedTo!.split("/").at(-1)!;
    await expect(issueInvoiceAction("acme", { id })).resolves.toMatchObject({
      ok: true,
      data: { status: "ISSUED", number: 1 },
    });
    const issued = await getDb().invoice.findUniqueOrThrow({ where: { id } });
    expect(issued.issueDate).toEqual(day(todayUtc()));
    expect(issued.dueDate).toEqual(day(todayUtc()));
  });
});

describe("invoice list: pagination, sorting, search and filter combinations", () => {
  async function seed() {
    const wayne = await getDb().client.create({ data: { organizationId: acme.id, name: "Wayne" } });
    const stark = await getDb().client.create({ data: { organizationId: acme.id, name: "Stark" } });
    const rows: {
      clientId: string;
      status: "DRAFT" | "ISSUED" | "PAID" | "CANCELLED";
      totalCents: number;
      currency?: string;
      dueDate?: Date | null;
      number?: number;
    }[] = [
      { clientId: wayne.id, status: "DRAFT", totalCents: 500, dueDate: null },
      {
        clientId: wayne.id,
        status: "ISSUED",
        totalCents: 2_000,
        number: 1,
        dueDate: day("2099-01-10"),
      },
      {
        clientId: wayne.id,
        status: "ISSUED",
        totalCents: 3_000,
        number: 2,
        dueDate: day("2020-01-10"),
      },
      {
        clientId: stark.id,
        status: "ISSUED",
        totalCents: 3_000,
        number: 3,
        dueDate: day("2020-02-10"),
        currency: "EUR",
      },
      {
        clientId: stark.id,
        status: "PAID",
        totalCents: 9_999,
        number: 4,
        dueDate: day("2020-03-10"),
      },
      { clientId: stark.id, status: "CANCELLED", totalCents: 1, dueDate: null },
      {
        clientId: wayne.id,
        status: "PAID",
        totalCents: 100,
        number: 10,
        dueDate: day("2099-05-10"),
        currency: "GBP",
      },
    ];
    for (const [index, row] of rows.entries()) {
      const issued = row.number !== undefined;
      await getDb().invoice.create({
        data: {
          organizationId: acme.id,
          clientId: row.clientId,
          status: row.status,
          currency: row.currency ?? "USD",
          subtotalCents: row.totalCents,
          totalCents: row.totalCents,
          dueDate: row.dueDate ?? null,
          createdAt: new Date(Date.UTC(2026, 0, 1 + index)),
          ...(issued && { number: row.number, issueDate: day("2020-01-01"), issuedAt: new Date() }),
          ...(row.status === "PAID" && { paidAt: new Date() }),
          ...(row.status === "CANCELLED" && { cancelledAt: new Date() }),
        },
      });
    }
    return { wayne, stark };
  }

  const list = (params: Record<string, string>) =>
    listInvoices(getTenantDb(acme.id), parseListInvoicesQuery(params));

  it("paginates at exact page boundaries and clamps past the end", async () => {
    await seed();
    const exact = await list({ pageSize: "7" });
    expect([exact.total, exact.pageCount, exact.items.length]).toEqual([7, 1, 7]);
    const last = await list({ pageSize: "3", page: "3" });
    expect([last.page, last.pageCount, last.items.length]).toEqual([3, 3, 1]);
    const beyond = await list({ pageSize: "3", page: "50" });
    expect(beyond.page).toBe(3);
    expect(beyond.items.map((item) => item.id)).toEqual(last.items.map((item) => item.id));
    const pages = await Promise.all(["1", "2", "3"].map((page) => list({ pageSize: "3", page })));
    expect(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size).toBe(7);
  });

  it("sorts by amount (ties stable), due date (empty last) and number (drafts first)", async () => {
    await seed();
    const byAmount = await list({ sort: "amount" });
    expect(byAmount.items.map((item) => item.totalCents)).toEqual([
      9_999, 3_000, 3_000, 2_000, 500, 100, 1,
    ]);
    const byDue = await list({ sort: "due" });
    expect(byDue.items.slice(-2).map((item) => item.dueDate)).toEqual([null, null]);
    expect(byDue.items[0].dueDate).toEqual(day("2020-01-10"));
    const byNumber = await list({ sort: "number" });
    expect(byNumber.items.map((item) => item.number)).toEqual([null, null, 10, 4, 3, 2, 1]);
  });

  it("finds invoices by number in every accepted notation", async () => {
    await seed();
    for (const q of ["INV-0003", "inv-3", "inv3", "0003", "3"]) {
      const result = await list({ q });
      expect({ q, numbers: result.items.map((item) => item.number) }).toEqual({ q, numbers: [3] });
    }
    await expect(list({ q: "INV-9999" })).resolves.toMatchObject({ total: 0 });
  });

  it("combines status (including derived OVERDUE), client and search, with counts for that scope", async () => {
    const { wayne, stark } = await seed();
    const overdueWayne = await list({ status: "OVERDUE", clientId: wayne.id });
    expect(overdueWayne.items.map((item) => item.number)).toEqual([2]);
    expect(overdueWayne.statusCounts).toEqual({
      DRAFT: 1,
      ISSUED: 1,
      OVERDUE: 1,
      PAID: 1,
      CANCELLED: 0,
    });
    // ISSUED excludes overdue invoices.
    const issued = await list({ status: "ISSUED" });
    expect(issued.items.map((item) => item.number)).toEqual([1]);
    const starkSearch = await list({ q: "stark", status: "all" });
    expect(starkSearch.total).toBe(3);
    await expect(list({ status: "PAID", clientId: stark.id, q: "wayne" })).resolves.toMatchObject({
      total: 0,
    });
    // An unknown or foreign client id filters to nothing, not everything.
    await expect(list({ clientId: "no-such-client" })).resolves.toMatchObject({ total: 0 });
  });

  it("keeps each invoice's own currency; no conversion or mixing", async () => {
    await seed();
    const all = await list({ pageSize: "100" });
    const currencies = Object.fromEntries(
      all.items.map((item) => [item.number ?? `d${item.totalCents}`, item.currency]),
    );
    expect(currencies).toMatchObject({ 3: "EUR", 10: "GBP", 1: "USD" });
    const dashboard = await getDashboard(getTenantDb(acme.id), "OWNER");
    expect(dashboard.invoices!.invoiced).toEqual([
      { currency: "EUR", cents: 3_000 },
      { currency: "GBP", cents: 100 },
      { currency: "USD", cents: 2_000 + 3_000 + 9_999 },
    ]);
  });
});

describe("multi-currency drafts", () => {
  it.each(["USD", "EUR", "GBP", "INR", "CAD", "AUD"])(
    "creates and totals a %s invoice in that currency's minor units",
    async (currency) => {
      const client = await getDb().client.create({ data: { organizationId: acme.id, name: "C" } });
      actAs(owner.cookie);
      const { redirectedTo } = await runRedirecting(
        createInvoiceAction("acme", {
          clientId: client.id,
          currency,
          taxPercent: "18",
          items: [{ description: "Work", quantity: "2.5", unitPrice: "19.99" }],
        }),
      );
      const invoice = await getDb().invoice.findUniqueOrThrow({
        where: { id: redirectedTo!.split("/").at(-1)! },
      });
      // 2.5 × 19.99 = 49.975 → 49.98 (half-up); tax 18% = 8.9964 → 9.00; total 58.98.
      expect(invoice).toMatchObject({
        currency,
        subtotalCents: 4_998,
        taxCents: 900,
        totalCents: 5_898,
      });
    },
  );
});

describe("Kanban board limit", () => {
  it(`returns exactly ${BOARD_TASK_LIMIT} cards without truncation, and flags ${BOARD_TASK_LIMIT + 1}`, async () => {
    const project = await getDb().project.create({
      data: { organizationId: acme.id, name: "Big" },
    });
    const tasks = (count: number, offset = 0) =>
      Array.from({ length: count }, (_, index) => ({
        organizationId: acme.id,
        projectId: project.id,
        title: `T${offset + index}`,
      }));
    await getDb().task.createMany({ data: tasks(BOARD_TASK_LIMIT) });
    const exact = await listProjectTasks(getTenantDb(acme.id), project.id);
    expect([exact.tasks.length, exact.truncated]).toEqual([BOARD_TASK_LIMIT, false]);

    await getDb().task.createMany({ data: tasks(1, BOARD_TASK_LIMIT) });
    const over = await listProjectTasks(getTenantDb(acme.id), project.id);
    expect([over.tasks.length, over.truncated]).toEqual([BOARD_TASK_LIMIT, true]);
    // A filter that narrows below the limit is not truncated.
    const filtered = await listProjectTasks(getTenantDb(acme.id), project.id, { q: "T499" });
    expect([filtered.tasks.map((task) => task.title), filtered.truncated]).toEqual([
      ["T499"],
      false,
    ]);
  });
});

describe("audit log filter boundaries", () => {
  const list = (params: Record<string, string>) =>
    listAuditLog(getTenantDb(acme.id), parseListAuditLogQuery(params));

  it("an inverted date range, an unknown actor and a foreign actor all return nothing", async () => {
    await expect(list({})).resolves.toMatchObject({ total: 2 }); // organization.created + member.added
    await expect(list({ from: "2026-12-31", to: "2026-01-01" })).resolves.toMatchObject({
      total: 0,
      page: 1,
      pageCount: 1,
      items: [],
    });
    await expect(list({ actorId: "no-such-user" })).resolves.toMatchObject({ total: 0 });
    const outsider = await createVerifiedUser("outsider@example.com");
    await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
    await expect(list({ actorId: outsider.userId })).resolves.toMatchObject({ total: 0 });
  });

  it("a page size equal to the total gives one full page", async () => {
    const result = await list({ pageSize: "2" });
    expect([result.pageCount, result.items.length]).toEqual([1, 2]);
    await expect(list({ pageSize: "1", page: "2" })).resolves.toMatchObject({
      page: 2,
      pageCount: 2,
    });
  });
});

describe("archived-only and empty organizations", () => {
  it("an organization with only archived clients and projects reports zero active work", async () => {
    await getDb().client.create({
      data: { organizationId: acme.id, name: "Old", status: "ARCHIVED", archivedAt: new Date() },
    });
    const project = await getDb().project.create({
      data: {
        organizationId: acme.id,
        name: "Old project",
        status: "ARCHIVED",
        archivedAt: new Date(),
      },
    });
    await getDb().task.create({
      data: { organizationId: acme.id, projectId: project.id, title: "Old task" },
    });
    const dashboard = await getDashboard(getTenantDb(acme.id), "OWNER");
    expect(dashboard.clients).toEqual({
      total: 0,
      byStatus: { ACTIVE: 0, INACTIVE: 0, ARCHIVED: 1 },
    });
    expect(dashboard.projects).toMatchObject({ active: 0, activeProjects: [] });
    expect(dashboard.projects!.byStatus.ARCHIVED).toBe(1);
    expect(dashboard.tasks).toMatchObject({ total: 0, open: 0 });
  });

  it("the board of an empty project is empty, not an error", async () => {
    const project = await getDb().project.create({
      data: { organizationId: acme.id, name: "Empty" },
    });
    await expect(
      listProjectTasks(getTenantDb(acme.id), project.id, { q: "anything" }),
    ).resolves.toEqual({ tasks: [], truncated: false });
  });
});
