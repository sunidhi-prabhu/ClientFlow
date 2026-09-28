import { describe, expect, it } from "vitest";

import { formatInvoiceNumber, invoiceDisplayStatus } from "@/lib/invoices";
import {
  addInvoiceItemInput,
  createInvoiceInput,
  parseListInvoicesQuery,
} from "@/lib/validation/invoice";

describe("invoice validation", () => {
  it("converts decimal strings to integer units and strips computed or ownership fields", () => {
    const parsed = createInvoiceInput.parse({
      clientId: "c1",
      discountPercent: "12.5",
      taxPercent: "",
      items: [{ description: " Design ", quantity: "1.5", unitPrice: "1,234.50", amountCents: 1 }],
      organizationId: "org_b",
      totalCents: 1,
      status: "PAID",
    });
    expect(parsed).toEqual({
      clientId: "c1",
      currency: "USD",
      dueDate: null,
      notes: null,
      discountPercent: 1250,
      taxPercent: 0,
      items: [{ description: "Design", quantity: 1500, unitPrice: 123_450 }],
    });
  });

  it("rejects floating-point artefacts and out-of-range values", () => {
    for (const unitPrice of [0.1 + 0.2, "1.005", "-1", "1e5", "10000000.01"]) {
      expect(
        addInvoiceItemInput.safeParse({
          invoiceId: "i",
          description: "X",
          quantity: "1",
          unitPrice,
        }).success,
      ).toBe(false);
    }
    expect(
      addInvoiceItemInput.safeParse({
        invoiceId: "i",
        description: "X",
        quantity: "0",
        unitPrice: "1",
      }).success,
    ).toBe(false);
    expect(createInvoiceInput.safeParse({ clientId: "c", currency: "JPY" }).success).toBe(false);
    expect(
      createInvoiceInput.safeParse({
        clientId: "c",
        items: Array.from({ length: 201 }, () => ({
          description: "x",
          quantity: "1",
          unitPrice: "1",
        })),
      }).success,
    ).toBe(false);
  });

  it("parses list filters leniently", () => {
    expect(
      parseListInvoicesQuery({ status: "overdue", sort: "evil", page: "0", q: [" INV-7 "] }),
    ).toEqual({
      q: "INV-7",
      status: "all",
      clientId: undefined,
      sort: "newest",
      page: 1,
      pageSize: 20,
    });
  });
});

describe("invoice display helpers", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  it("derives OVERDUE only for issued invoices past their due date (UTC)", () => {
    expect(
      invoiceDisplayStatus({ status: "ISSUED", dueDate: new Date("2026-06-09T00:00:00Z") }, now),
    ).toBe("OVERDUE");
    expect(
      invoiceDisplayStatus({ status: "ISSUED", dueDate: new Date("2026-06-10T00:00:00Z") }, now),
    ).toBe("ISSUED");
    expect(
      invoiceDisplayStatus({ status: "PAID", dueDate: new Date("2020-01-01T00:00:00Z") }, now),
    ).toBe("PAID");
    expect(
      invoiceDisplayStatus({ status: "DRAFT", dueDate: new Date("2020-01-01T00:00:00Z") }, now),
    ).toBe("DRAFT");
  });

  it("formats invoice numbers", () => {
    expect(formatInvoiceNumber(7)).toBe("INV-0007");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
    expect(formatInvoiceNumber(null)).toBe("Draft");
  });
});
