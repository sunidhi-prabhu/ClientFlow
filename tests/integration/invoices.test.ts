import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as downloadPdf } from "@/app/api/o/[orgSlug]/invoices/[invoiceId]/pdf/route";
import {
  addInvoiceItemAction,
  cancelInvoiceAction,
  createInvoiceAction,
  issueInvoiceAction,
  markInvoicePaidAction,
  removeInvoiceItemAction,
  updateInvoiceAction,
  updateInvoiceItemAction,
} from "@/app/o/[orgSlug]/invoices/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { listInvoicesQuery } from "@/lib/validation/invoice";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantPage } from "@/server/protected";
import { getInvoice, listInvoices } from "@/server/invoices/service";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

type Member = { userId: string; cookie: string };

let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: Member;
let client: { id: string };
let globexClient: { id: string };

const as = (role: MembershipRole) => actAs(members[role].cookie);

async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

const future = (days = 30) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Create a draft through the real action; returns its id. */
async function createDraft(input: Record<string, unknown> = {}) {
  as("OWNER");
  const { redirectedTo, result } = await runRedirecting(
    createInvoiceAction("acme", { clientId: client.id, dueDate: future(), ...input }),
  );
  if (!redirectedTo) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return redirectedTo.split("/").at(-1)!;
}

const invoiceRow = (id: string) => getDb().invoice.findUniqueOrThrow({ where: { id } });
const itemCount = (invoiceId: string) => getDb().invoiceItem.count({ where: { invoiceId } });

/** Invoice-level consistency: stored totals equal a recomputation from the stored items. */
async function expectConsistent(id: string) {
  const invoice = await getDb().invoice.findUniqueOrThrow({
    where: { id },
    include: { items: true },
  });
  const subtotal = invoice.items.reduce((sum, item) => sum + item.amountCents, 0);
  expect(invoice.subtotalCents).toBe(subtotal);
  expect(invoice.totalCents).toBe(invoice.subtotalCents - invoice.discountCents + invoice.taxCents);
}

beforeEach(async () => {
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
  client = await getDb().client.create({
    data: { organizationId: acme.id, name: "Wayne Enterprises", email: "billing@wayne.com" },
  });
  globexClient = await getDb().client.create({
    data: { organizationId: globex.id, name: "Globex client" },
  });
});

describe("creation", () => {
  it("creates a draft with items and server-computed totals, ignoring client-supplied totals", async () => {
    as("MANAGER");
    const { redirectedTo } = await runRedirecting(
      createInvoiceAction("acme", {
        clientId: client.id,
        currency: "EUR",
        dueDate: future(),
        notes: "Thanks!",
        discountPercent: "10",
        taxPercent: "20",
        items: [
          { description: "Design", quantity: "1.5", unitPrice: "100.00", amountCents: 1 },
          { description: "Hosting", quantity: "3", unitPrice: "0.10" },
        ],
        // All of these must be ignored:
        organizationId: globex.id,
        status: "PAID",
        number: 999,
        subtotalCents: 1,
        totalCents: 1,
      }),
    );

    const id = redirectedTo!.split("/").at(-1)!;
    expect(redirectedTo).toBe(`/o/acme/invoices/${id}`);
    const invoice = await getInvoice(getTenantDb(acme.id), id);
    expect(invoice).toMatchObject({
      organizationId: acme.id,
      clientId: client.id,
      status: "DRAFT",
      number: null,
      currency: "EUR",
      discountBps: 1000,
      taxBps: 2000,
      // 1.5 × 100.00 = 150.00; 3 × 0.10 = 0.30 → subtotal 150.30
      subtotalCents: 15_030,
      discountCents: 1_503, // 10%
      taxCents: 2_705, // 20% of 135.27 = 27.054 → 27.05
      totalCents: 15_030 - 1_503 + 2_705,
    });
    expect(
      invoice.items.map((item) => [
        item.description,
        item.quantityMilli,
        item.unitPriceCents,
        item.amountCents,
      ]),
    ).toEqual([
      ["Design", 1500, 10_000, 15_000],
      ["Hosting", 3000, 10, 30],
    ]);
  });

  it("validates fields with clear messages", async () => {
    as("OWNER");
    const { result } = await runRedirecting(
      createInvoiceAction("acme", {
        clientId: client.id,
        currency: "BTC",
        taxPercent: "101",
        discountPercent: "-1",
        items: [{ description: "", quantity: "0", unitPrice: "1.001" }],
      }),
    );
    const paths = (result as { error: { details: { path: string }[] } }).error.details
      .map((d) => d.path)
      .sort();
    expect(paths).toEqual([
      "currency",
      "discountPercent",
      "items.0.description",
      "items.0.quantity",
      "items.0.unitPrice",
      "taxPercent",
    ]);
    await expect(getDb().invoice.count()).resolves.toBe(0);
  });

  it("rejects floating-point garbage for money", async () => {
    as("OWNER");
    const { result } = await runRedirecting(
      createInvoiceAction("acme", {
        clientId: client.id,
        items: [{ description: "Float", quantity: 1, unitPrice: 0.1 + 0.2 }],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", details: [{ path: "items.0.unitPrice" }] },
    });
  });
});

describe("line items and totals", () => {
  it("recalculates totals on add, update and remove, keeping them consistent", async () => {
    const id = await createDraft({ taxPercent: "8.25" });
    as("MANAGER");

    const added = await addInvoiceItemAction("acme", {
      invoiceId: id,
      description: "Consulting",
      quantity: "2",
      unitPrice: "150",
    });
    expect(added.ok).toBe(true);
    await expect(invoiceRow(id)).resolves.toMatchObject({
      subtotalCents: 30_000,
      taxCents: 2_475,
      totalCents: 32_475,
    });

    const itemId = (added as { data: { id: string } }).data.id;
    await updateInvoiceItemAction("acme", {
      id: itemId,
      description: "Consulting (senior)",
      quantity: "2.5",
      unitPrice: "149.99",
    });
    // 2.5 × 149.99 = 374.975 → 374.98 (half-up); tax 8.25% = 30.93585 → 30.94
    await expect(invoiceRow(id)).resolves.toMatchObject({
      subtotalCents: 37_498,
      taxCents: 3_094,
      totalCents: 40_592,
    });

    await addInvoiceItemAction("acme", {
      invoiceId: id,
      description: "Travel",
      quantity: "1",
      unitPrice: "0.01",
    });
    await removeInvoiceItemAction("acme", { id: itemId });
    await expect(invoiceRow(id)).resolves.toMatchObject({
      subtotalCents: 1,
      taxCents: 0,
      totalCents: 1,
    });
    await expectConsistent(id);
  });

  it("recalculates when the discount or tax rate changes", async () => {
    const id = await createDraft({
      items: [{ description: "Work", quantity: "1", unitPrice: "1000" }],
    });
    as("OWNER");
    await runRedirecting(
      updateInvoiceAction("acme", {
        id,
        clientId: client.id,
        dueDate: future(),
        discountPercent: "12.5",
        taxPercent: "18",
      }),
    );
    // 1000 - 12.5% = 875; 18% tax = 157.50 → total 1032.50
    await expect(invoiceRow(id)).resolves.toMatchObject({
      subtotalCents: 100_000,
      discountCents: 12_500,
      taxCents: 15_750,
      totalCents: 103_250,
    });
  });

  it("ignores amounts sent for items", async () => {
    const id = await createDraft();
    as("OWNER");
    await addInvoiceItemAction("acme", {
      invoiceId: id,
      description: "X",
      quantity: "1",
      unitPrice: "5",
      amountCents: 999_999,
    });
    await expect(
      getDb().invoiceItem.findFirstOrThrow({ where: { invoiceId: id } }),
    ).resolves.toMatchObject({ amountCents: 500 });
  });
});

describe("state transitions", () => {
  it("DRAFT → ISSUED assigns sequential numbers and today's issue date", async () => {
    const first = await createDraft({
      items: [{ description: "A", quantity: "1", unitPrice: "10" }],
    });
    const second = await createDraft({
      items: [{ description: "B", quantity: "1", unitPrice: "20" }],
    });
    as("MANAGER");
    await expect(issueInvoiceAction("acme", { id: first })).resolves.toEqual({
      ok: true,
      data: { id: first, status: "ISSUED", number: 1 },
    });
    await expect(issueInvoiceAction("acme", { id: second })).resolves.toMatchObject({
      ok: true,
      data: { number: 2 },
    });
    const issued = await invoiceRow(first);
    expect(issued.issueDate?.toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
    expect(issued.issuedAt).toBeInstanceOf(Date);
  });

  it("ISSUED → PAID and ISSUED → CANCELLED; DRAFT → CANCELLED", async () => {
    const toPay = await createDraft({
      items: [{ description: "A", quantity: "1", unitPrice: "10" }],
    });
    const toCancel = await createDraft({
      items: [{ description: "B", quantity: "1", unitPrice: "10" }],
    });
    const draft = await createDraft();
    as("OWNER");
    await issueInvoiceAction("acme", { id: toPay });
    await issueInvoiceAction("acme", { id: toCancel });

    await expect(markInvoicePaidAction("acme", { id: toPay })).resolves.toEqual({
      ok: true,
      data: { id: toPay, status: "PAID" },
    });
    await expect(invoiceRow(toPay)).resolves.toMatchObject({ paidAt: expect.any(Date) });
    await expect(cancelInvoiceAction("acme", { id: toCancel })).resolves.toMatchObject({
      ok: true,
      data: { status: "CANCELLED" },
    });
    await expect(cancelInvoiceAction("acme", { id: draft })).resolves.toMatchObject({
      ok: true,
      data: { status: "CANCELLED" },
    });
  });

  it("OVERDUE is derived: an issued invoice past its due date is overdue and can still be paid", async () => {
    const id = await createDraft({ items: [{ description: "A", quantity: "1", unitPrice: "10" }] });
    as("OWNER");
    await issueInvoiceAction("acme", { id });
    // Simulate time passing: move "now" forward instead of editing the (immutable) issued invoice.
    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const db = getTenantDb(acme.id);
    const overdue = await listInvoices(db, listInvoicesQuery.parse({ status: "OVERDUE" }), later);
    expect(overdue.items.map((invoice) => invoice.id)).toEqual([id]);
    expect(overdue.statusCounts).toMatchObject({ ISSUED: 0, OVERDUE: 1 });
    await expect(
      listInvoices(db, listInvoicesQuery.parse({ status: "ISSUED" })),
    ).resolves.toMatchObject({ total: 1 });
    await expect(markInvoicePaidAction("acme", { id })).resolves.toMatchObject({ ok: true });
  });

  it("rejects invalid transitions without changing anything", async () => {
    const paid = await createDraft({
      items: [{ description: "A", quantity: "1", unitPrice: "10" }],
    });
    const cancelled = await createDraft();
    const draft = await createDraft({
      items: [{ description: "B", quantity: "1", unitPrice: "10" }],
    });
    as("OWNER");
    await issueInvoiceAction("acme", { id: paid });
    await markInvoicePaidAction("acme", { id: paid });
    await cancelInvoiceAction("acme", { id: cancelled });

    const conflict = (message: string) => ({ ok: false, error: { code: "CONFLICT", message } });
    await expect(cancelInvoiceAction("acme", { id: paid })).resolves.toEqual(
      conflict("Paid invoices cannot be cancelled"),
    );
    await expect(markInvoicePaidAction("acme", { id: paid })).resolves.toEqual(
      conflict("This invoice is already paid"),
    );
    await expect(issueInvoiceAction("acme", { id: paid })).resolves.toEqual(
      conflict("Only draft invoices can be changed"),
    );
    await expect(markInvoicePaidAction("acme", { id: cancelled })).resolves.toEqual(
      conflict("Cancelled invoices cannot be marked as paid"),
    );
    await expect(issueInvoiceAction("acme", { id: cancelled })).resolves.toEqual(
      conflict("Only draft invoices can be changed"),
    );
    await expect(cancelInvoiceAction("acme", { id: cancelled })).resolves.toEqual(
      conflict("This invoice is already cancelled"),
    );
    await expect(markInvoicePaidAction("acme", { id: draft })).resolves.toEqual(
      conflict("Issue the invoice before marking it as paid"),
    );

    await expect(invoiceRow(paid)).resolves.toMatchObject({ status: "PAID" });
    await expect(invoiceRow(cancelled)).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(invoiceRow(draft)).resolves.toMatchObject({ status: "DRAFT", number: null });
  });

  it("refuses to issue an incomplete invoice", async () => {
    const empty = await createDraft();
    const noDue = await createDraft({
      dueDate: "",
      items: [{ description: "A", quantity: "1", unitPrice: "10" }],
    });
    const zero = await createDraft({
      items: [{ description: "Free", quantity: "1", unitPrice: "0" }],
    });
    const pastDue = await createDraft({
      items: [{ description: "A", quantity: "1", unitPrice: "10" }],
    });
    await getDb().invoice.update({
      where: { id: pastDue },
      data: { dueDate: new Date("2020-01-01") },
    });
    as("OWNER");

    const detail = async (id: string) =>
      (
        (await issueInvoiceAction("acme", { id })) as {
          error: { details: { path: string; message: string }[] };
        }
      ).error.details;
    await expect(detail(empty)).resolves.toEqual([
      { path: "items", message: "Add at least one line item" },
    ]);
    await expect(detail(noDue)).resolves.toEqual([{ path: "dueDate", message: "Set a due date" }]);
    await expect(detail(zero)).resolves.toEqual([
      { path: "items", message: "The total must be greater than 0" },
    ]);
    await expect(detail(pastDue)).resolves.toEqual([
      { path: "dueDate", message: "The due date cannot be in the past" },
    ]);
    await expect(getDb().invoice.count({ where: { status: "DRAFT" } })).resolves.toBe(4);
    await expect(
      getDb().organization.findUniqueOrThrow({ where: { id: acme.id } }),
    ).resolves.toMatchObject({ invoiceSequence: 0 });
  });
});

describe("editing restrictions", () => {
  let issued: string;
  let itemId: string;
  beforeEach(async () => {
    issued = await createDraft({
      items: [{ description: "Locked", quantity: "1", unitPrice: "10" }],
    });
    itemId = (await getDb().invoiceItem.findFirstOrThrow({ where: { invoiceId: issued } })).id;
    as("OWNER");
    await issueInvoiceAction("acme", { id: issued });
  });

  it("the application refuses to edit a non-draft invoice or its items", async () => {
    const conflict = {
      ok: false,
      error: { code: "CONFLICT", message: "Only draft invoices can be changed" },
    };
    expect(
      (
        await runRedirecting(
          updateInvoiceAction("acme", { id: issued, clientId: client.id, taxPercent: "50" }),
        )
      ).result,
    ).toEqual(conflict);
    await expect(
      addInvoiceItemAction("acme", {
        invoiceId: issued,
        description: "Sneaky",
        quantity: "1",
        unitPrice: "1",
      }),
    ).resolves.toEqual(conflict);
    await expect(
      updateInvoiceItemAction("acme", {
        id: itemId,
        description: "Changed",
        quantity: "9",
        unitPrice: "9",
      }),
    ).resolves.toEqual(conflict);
    await expect(removeInvoiceItemAction("acme", { id: itemId })).resolves.toEqual(conflict);
    await expect(invoiceRow(issued)).resolves.toMatchObject({ totalCents: 1000, taxBps: 0 });
    await expect(itemCount(issued)).resolves.toBe(1);
  });

  it("the database also refuses (triggers), even for code that bypasses the service", async () => {
    const db = getDb();
    await expect(
      db.invoiceItem.create({
        data: {
          organizationId: acme.id,
          invoiceId: issued,
          description: "Raw",
          quantityMilli: 1000,
          unitPriceCents: 1,
          amountCents: 1,
          position: 9,
        },
      }),
    ).rejects.toThrow(/only be changed while the invoice is a draft/);
    await expect(
      db.invoiceItem.update({ where: { id: itemId }, data: { unitPriceCents: 1 } }),
    ).rejects.toThrow(/only be changed while the invoice is a draft/);
    await expect(db.invoiceItem.delete({ where: { id: itemId } })).rejects.toThrow(
      /only be changed while the invoice is a draft/,
    );
    await expect(
      db.invoice.update({ where: { id: issued }, data: { notes: "rewritten" } }),
    ).rejects.toThrow(/not a draft and cannot be modified/);
    await expect(
      db.invoice.update({ where: { id: issued }, data: { status: "DRAFT" } }),
    ).rejects.toThrow(/Invalid invoice status transition/);
    await expect(db.invoice.delete({ where: { id: issued } })).rejects.toThrow(/cannot be deleted/);
    await expectConsistent(issued);
  });

  it("the database rejects inconsistent totals and invalid values (CHECK constraints)", async () => {
    const draft = await createDraft();
    const db = getDb();
    await expect(
      db.invoice.update({ where: { id: draft }, data: { totalCents: 12345 } }),
    ).rejects.toThrow(/Invoice_amounts_check/);
    await expect(
      db.invoice.update({ where: { id: draft }, data: { taxBps: 10_001 } }),
    ).rejects.toThrow(/Invoice_rates_check/);
    await expect(
      db.invoice.update({ where: { id: draft }, data: { currency: "usd" } }),
    ).rejects.toThrow(/Invoice_currency_check/);
    await expect(
      db.invoiceItem.create({
        data: {
          organizationId: acme.id,
          invoiceId: draft,
          description: "Neg",
          quantityMilli: 0,
          unitPriceCents: 1,
          amountCents: 0,
          position: 1,
        },
      }),
    ).rejects.toThrow(/InvoiceItem_values_check/);
  });

  it("deleting the organization still removes its invoices (cascade passes the triggers)", async () => {
    await getDb().organization.delete({ where: { id: acme.id } });
    await expect(getDb().invoice.count({ where: { organizationId: acme.id } })).resolves.toBe(0);
    await expect(getDb().invoiceItem.count({ where: { organizationId: acme.id } })).resolves.toBe(
      0,
    );
  });
});

describe("transactions and consistency", () => {
  it("creation is atomic: a failure after items were inserted leaves nothing behind", async () => {
    as("OWNER");
    // Each line is valid, but the total exceeds the maximum: detected after the items are inserted.
    const items = Array.from({ length: 3 }, (_, index) => ({
      description: `Big ${index}`,
      quantity: "1",
      unitPrice: "5000000",
    }));
    const { result } = await runRedirecting(
      createInvoiceAction("acme", { clientId: client.id, items }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "Amounts exceed the maximum of 10,000,000.00" },
    });
    await expect(getDb().invoice.count()).resolves.toBe(0);
    await expect(getDb().invoiceItem.count()).resolves.toBe(0);
  });

  it("an item change that would overflow the total is rolled back entirely", async () => {
    const id = await createDraft({
      items: [{ description: "Big", quantity: "1", unitPrice: "9000000" }],
    });
    as("OWNER");
    await expect(
      addInvoiceItemAction("acme", {
        invoiceId: id,
        description: "Too much",
        quantity: "1",
        unitPrice: "2000000",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    await expect(itemCount(id)).resolves.toBe(1);
    await expect(invoiceRow(id)).resolves.toMatchObject({ totalCents: 900_000_000 });
  });

  it("concurrent item additions all land and totals stay consistent", async () => {
    const id = await createDraft();
    as("OWNER");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        addInvoiceItemAction("acme", {
          invoiceId: id,
          description: `Line ${index}`,
          quantity: "1",
          unitPrice: `${index + 1}.00`,
        }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    await expect(itemCount(id)).resolves.toBe(8);
    await expect(invoiceRow(id)).resolves.toMatchObject({ subtotalCents: 3600 }); // 1+…+8 = 36.00
    await expectConsistent(id);
    const positions = (await getDb().invoiceItem.findMany({ where: { invoiceId: id } }))
      .map((item) => item.position)
      .sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("an edit waiting on the invoice lock re-checks the state: issued meanwhile → 409, no item added", async () => {
    const id = await createDraft({ items: [{ description: "A", quantity: "1", unitPrice: "10" }] });
    const pg = await import("pg");
    const other = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      // Another transaction issues the invoice and holds the row lock.
      await other.query("BEGIN");
      await other.query(
        `UPDATE "Invoice" SET status='ISSUED', number=77, "issueDate"=CURRENT_DATE, "issuedAt"=now() WHERE id=$1`,
        [id],
      );
      as("OWNER");
      const pending = addInvoiceItemAction("acme", {
        invoiceId: id,
        description: "Late",
        quantity: "1",
        unitPrice: "1",
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query("COMMIT");
      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      await expect(itemCount(id)).resolves.toBe(1);
      await expectConsistent(id);
    } finally {
      await other.query("ROLLBACK").catch(() => {});
      await other.end();
    }
  });

  it("concurrent issuing assigns unique, gap-free numbers", async () => {
    const ids = [];
    for (let index = 0; index < 5; index++) {
      ids.push(
        await createDraft({ items: [{ description: `I${index}`, quantity: "1", unitPrice: "1" }] }),
      );
    }
    as("OWNER");
    const results = await Promise.all(ids.map((id) => issueInvoiceAction("acme", { id })));
    expect(results.every((result) => result.ok)).toBe(true);
    const numbers = (await getDb().invoice.findMany({ where: { id: { in: ids } } }))
      .map((invoice) => invoice.number)
      .sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("client ownership", () => {
  it("rejects a client from another organization exactly like a nonexistent client", async () => {
    as("OWNER");
    const foreign = await runRedirecting(
      createInvoiceAction("acme", { clientId: globexClient.id }),
    );
    const missing = await runRedirecting(
      createInvoiceAction("acme", { clientId: "no-such-client" }),
    );
    const expected = {
      ok: false,
      error: { code: "NOT_FOUND", message: "Referenced resource not found" },
    };
    expect(foreign.result).toEqual(expected);
    expect(missing.result).toEqual(expected);
    await expect(getDb().invoice.count()).resolves.toBe(0);
  });

  it("rejects switching a draft to a foreign client, and invoicing archived clients", async () => {
    const id = await createDraft();
    as("OWNER");
    const { result } = await runRedirecting(
      updateInvoiceAction("acme", { id, clientId: globexClient.id }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(invoiceRow(id)).resolves.toMatchObject({ clientId: client.id });

    const archived = await getDb().client.create({
      data: { organizationId: acme.id, name: "Old", status: "ARCHIVED" },
    });
    expect(
      (await runRedirecting(createInvoiceAction("acme", { clientId: archived.id }))).result,
    ).toEqual({
      ok: false,
      error: { code: "CONFLICT", message: "Archived clients cannot be invoiced" },
    });
  });

  it("the database rejects an invoice for another organization's client (composite key)", async () => {
    await expect(
      getDb().invoice.create({ data: { organizationId: acme.id, clientId: globexClient.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("authorization", () => {
  const cases = [
    { name: "create", permission: "invoice:create" },
    { name: "edit", permission: "invoice:update" },
    { name: "add item", permission: "invoice:update" },
    { name: "issue", permission: "invoice:send" },
    { name: "mark paid", permission: "invoice:update" },
    { name: "cancel", permission: "invoice:delete" },
  ] as const;

  for (const role of ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const) {
    it(role, async () => {
      const draft = await createDraft({
        items: [{ description: "A", quantity: "1", unitPrice: "10" }],
      });
      const toIssue = await createDraft({
        items: [{ description: "B", quantity: "1", unitPrice: "10" }],
      });
      const toPay = await createDraft({
        items: [{ description: "C", quantity: "1", unitPrice: "10" }],
      });
      const toCancel = await createDraft();
      await issueInvoiceAction("acme", { id: toPay });
      as(role);

      const outcomes: Record<string, boolean> = {};
      const run = async (name: string, action: () => Promise<unknown>) => {
        const { result, redirectedTo } = await runRedirecting(action());
        const ok = redirectedTo !== undefined || (result as { ok: boolean }).ok;
        if (!ok) expect(result).toMatchObject({ error: { code: "FORBIDDEN" } });
        outcomes[name] = ok;
      };
      await run("create", () => createInvoiceAction("acme", { clientId: client.id }));
      await run("edit", () =>
        updateInvoiceAction("acme", { id: draft, clientId: client.id, notes: role }),
      );
      await run("add item", () =>
        addInvoiceItemAction("acme", {
          invoiceId: draft,
          description: "X",
          quantity: "1",
          unitPrice: "1",
        }),
      );
      await run("issue", () => issueInvoiceAction("acme", { id: toIssue }));
      await run("mark paid", () => markInvoicePaidAction("acme", { id: toPay }));
      await run("cancel", () => cancelInvoiceAction("acme", { id: toCancel }));

      expect(outcomes).toEqual(
        Object.fromEntries(
          cases.map(({ name, permission }) => [name, hasPermission(role, permission)]),
        ),
      );
      await expect(tenantPage("acme", "invoice:read")).resolves.toMatchObject({
        allowed: hasPermission(role, "invoice:read"),
      });
    });
  }

  it("MEMBER cannot read invoices at all (page and PDF)", async () => {
    const id = await createDraft();
    as("MEMBER");
    const response = await downloadPdf(
      new Request(`http://localhost:3000/api/o/acme/invoices/${id}/pdf`),
      {
        params: Promise.resolve({ orgSlug: "acme", invoiceId: id }),
      },
    );
    expect(response.status).toBe(403);
  });

  it("unauthenticated requests are rejected and change nothing", async () => {
    const id = await createDraft({ items: [{ description: "A", quantity: "1", unitPrice: "10" }] });
    actAs(undefined);
    const unauthenticated = {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    };
    expect(
      (await runRedirecting(createInvoiceAction("acme", { clientId: client.id }))).result,
    ).toEqual(unauthenticated);
    await expect(issueInvoiceAction("acme", { id })).resolves.toEqual(unauthenticated);
    await expect(
      addInvoiceItemAction("acme", {
        invoiceId: id,
        description: "X",
        quantity: "1",
        unitPrice: "1",
      }),
    ).resolves.toEqual(unauthenticated);
    await expect(invoiceRow(id)).resolves.toMatchObject({ status: "DRAFT", totalCents: 1000 });
  });
});

describe("cross-organization isolation", () => {
  let foreignInvoice: string;
  let foreignItem: string;
  beforeEach(async () => {
    const invoice = await getDb().invoice.create({
      data: { organizationId: globex.id, clientId: globexClient.id },
    });
    const item = await getDb().invoiceItem.create({
      data: {
        organizationId: globex.id,
        invoiceId: invoice.id,
        description: "Globex secret",
        quantityMilli: 1000,
        unitPriceCents: 500,
        amountCents: 500,
        position: 1,
      },
    });
    await getDb().invoice.update({
      where: { id: invoice.id },
      data: { subtotalCents: 500, totalCents: 500 },
    });
    foreignInvoice = invoice.id;
    foreignItem = item.id;
  });

  async function expectForeignUntouched() {
    await expect(invoiceRow(foreignInvoice)).resolves.toMatchObject({
      organizationId: globex.id,
      status: "DRAFT",
      totalCents: 500,
    });
    await expect(
      getDb().invoiceItem.findUniqueOrThrow({ where: { id: foreignItem } }),
    ).resolves.toMatchObject({ description: "Globex secret", unitPriceCents: 500 });
    await expect(itemCount(foreignInvoice)).resolves.toBe(1);
  }

  it("an Acme OWNER cannot touch a Globex invoice or its items by id", async () => {
    as("OWNER");
    const invoiceNotFound = {
      ok: false,
      error: { code: "NOT_FOUND", message: "Invoice not found" },
    };
    const itemNotFound = {
      ok: false,
      error: { code: "NOT_FOUND", message: "Invoice item not found" },
    };
    expect(
      (
        await runRedirecting(
          updateInvoiceAction("acme", { id: foreignInvoice, clientId: client.id }),
        )
      ).result,
    ).toEqual(invoiceNotFound);
    await expect(
      addInvoiceItemAction("acme", {
        invoiceId: foreignInvoice,
        description: "X",
        quantity: "1",
        unitPrice: "1",
      }),
    ).resolves.toEqual(invoiceNotFound);
    await expect(
      updateInvoiceItemAction("acme", {
        id: foreignItem,
        description: "Pwned",
        quantity: "1",
        unitPrice: "0",
      }),
    ).resolves.toEqual(itemNotFound);
    await expect(removeInvoiceItemAction("acme", { id: foreignItem })).resolves.toEqual(
      itemNotFound,
    );
    await expect(issueInvoiceAction("acme", { id: foreignInvoice })).resolves.toEqual(
      invoiceNotFound,
    );
    await expect(markInvoicePaidAction("acme", { id: foreignInvoice })).resolves.toEqual(
      invoiceNotFound,
    );
    await expect(cancelInvoiceAction("acme", { id: foreignInvoice })).resolves.toEqual(
      invoiceNotFound,
    );
    await expectForeignUntouched();
  });

  it("cannot reach Globex by switching the organization slug, and lists never include it", async () => {
    as("OWNER");
    await expect(cancelInvoiceAction("globex", { id: foreignInvoice })).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "Organization not found" },
    });
    const result = await listInvoices(
      getTenantDb(acme.id),
      listInvoicesQuery.parse({ q: "globex" }),
    );
    expect(result.total).toBe(0);
    await expectForeignUntouched();
  });

  it("the PDF route returns 404 for another organization's invoice", async () => {
    as("OWNER");
    const response = await downloadPdf(
      new Request(`http://localhost:3000/api/o/acme/invoices/${foreignInvoice}/pdf`),
      {
        params: Promise.resolve({ orgSlug: "acme", invoiceId: foreignInvoice }),
      },
    );
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Globex secret");
  });

  it("the database rejects an item pointing at another organization's invoice (composite key)", async () => {
    const id = await createDraft();
    await expect(
      getDb().invoiceItem.create({
        data: {
          organizationId: globex.id,
          invoiceId: id,
          description: "Raw",
          quantityMilli: 1000,
          unitPriceCents: 1,
          amountCents: 1,
          position: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("list and PDF", () => {
  it("searches by invoice number and client, filters by status and client", async () => {
    const other = await getDb().client.create({
      data: { organizationId: acme.id, name: "Stark Industries" },
    });
    const a = await createDraft({ items: [{ description: "A", quantity: "1", unitPrice: "10" }] });
    await createDraft({ clientId: other.id });
    as("OWNER");
    await issueInvoiceAction("acme", { id: a });
    const db = getTenantDb(acme.id);
    const ids = async (input: Record<string, unknown>) =>
      (await listInvoices(db, listInvoicesQuery.parse(input))).items.map(
        (invoice) => invoice.client.name,
      );

    await expect(ids({ q: "INV-0001" })).resolves.toEqual(["Wayne Enterprises"]);
    await expect(ids({ q: "1" })).resolves.toEqual(["Wayne Enterprises"]);
    await expect(ids({ q: "stark" })).resolves.toEqual(["Stark Industries"]);
    await expect(ids({ status: "DRAFT" })).resolves.toEqual(["Stark Industries"]);
    await expect(ids({ status: "ISSUED" })).resolves.toEqual(["Wayne Enterprises"]);
    await expect(ids({ clientId: other.id })).resolves.toEqual(["Stark Industries"]);
    await expect(ids({ q: "%" })).resolves.toEqual([]);
  });

  it("downloads a PDF, including non-Latin text the PDF font cannot encode", async () => {
    await getDb().client.update({
      where: { id: client.id },
      data: { name: "Wayne Enterprises 株式会社 ₹ 🚀" },
    });
    const id = await createDraft({
      currency: "INR",
      notes: "Grüße – नमस्ते",
      items: [{ description: "Café design ✓", quantity: "1", unitPrice: "1234.5" }],
    });
    as("MANAGER");
    const response = await downloadPdf(
      new Request(`http://localhost:3000/api/o/acme/invoices/${id}/pdf`),
      {
        params: Promise.resolve({ orgSlug: "acme", invoiceId: id }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Draft-.+\.pdf"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
