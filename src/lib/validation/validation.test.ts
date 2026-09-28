import { describe, expect, it } from "vitest";

import { isBeforeToday, toDateInputValue } from "@/lib/calendar-date";
import { formatInvoiceNumber, invoiceDisplayStatus, todayUtc } from "@/lib/invoices";
import { escapeLikePattern } from "@/server/search";

import { calendarDateField } from "./dates";
import { createInvoiceInput, invoiceItemFields } from "./invoice";
import { organizationSlugSchema, slugify } from "./organization";
import { createProjectInput } from "./project";
import { createTaskInput } from "./task";

/* Pure input rules and date helpers that the integration tests rely on but never isolate. */

describe("organizationSlugSchema", () => {
  it("normalizes case and whitespace", () => {
    expect(organizationSlugSchema.parse("  Acme-Studio ")).toBe("acme-studio");
  });

  it.each(["ab", "a".repeat(49), "-acme", "acme-", "ac--me", "acme_1", "acmé", "ac me", "../x"])(
    "rejects %j",
    (slug) => {
      expect(organizationSlugSchema.safeParse(slug).success).toBe(false);
    },
  );

  it("accepts the length bounds exactly", () => {
    expect(organizationSlugSchema.safeParse("abc").success).toBe(true);
    expect(organizationSlugSchema.safeParse("a".repeat(48)).success).toBe(true);
  });
});

describe("slugify", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Crème Brûlée & Co.")).toBe("creme-brulee-co");
  });

  it("returns an empty slug (then rejected) for names without letters or digits", () => {
    expect(slugify("!!! ???")).toBe("");
    expect(organizationSlugSchema.safeParse(slugify("!!!")).success).toBe(false);
  });

  it("cuts long names at 48 characters without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(47)} bcd`);
    expect(slug).toBe("a".repeat(47));
    expect(organizationSlugSchema.safeParse(slug).success).toBe(true);
  });
});

describe("calendarDateField", () => {
  const field = calendarDateField("Due date");

  it("stores a calendar day as UTC midnight", () => {
    expect(field.parse("2028-02-29")).toEqual(new Date("2028-02-29T00:00:00.000Z"));
    expect(toDateInputValue(field.parse("2026-12-31"))).toBe("2026-12-31");
  });

  it("treats blank or missing as no date", () => {
    expect(field.parse("")).toBeNull();
    expect(field.parse(undefined)).toBeNull();
  });

  it.each(["2026-02-29", "2026-13-01", "2026-04-31", "2026-09-28T10:00", "28/09/2026", "tomorrow"])(
    "rejects %j",
    (value) => {
      expect(field.safeParse(value).success).toBe(false);
    },
  );
});

describe("isBeforeToday / todayUtc at the day boundary (UTC)", () => {
  const lastMoment = new Date("2026-09-28T23:59:59.999Z");
  const firstMoment = new Date("2026-09-29T00:00:00.000Z");

  it("a date is 'before today' only once its UTC day is over", () => {
    const due = new Date("2026-09-28T00:00:00.000Z");
    expect(isBeforeToday(due, lastMoment)).toBe(false);
    expect(isBeforeToday(due, firstMoment)).toBe(true);
  });

  it("todayUtc ignores the local time of day", () => {
    expect(todayUtc(lastMoment)).toEqual(new Date("2026-09-28T00:00:00.000Z"));
    expect(todayUtc(firstMoment)).toEqual(new Date("2026-09-29T00:00:00.000Z"));
  });
});

describe("invoiceDisplayStatus", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const yesterday = new Date("2026-09-27T00:00:00Z");
  const today = new Date("2026-09-28T00:00:00Z");

  it("derives OVERDUE only for issued invoices past their due date", () => {
    expect(invoiceDisplayStatus({ status: "ISSUED", dueDate: yesterday }, now)).toBe("OVERDUE");
    expect(invoiceDisplayStatus({ status: "ISSUED", dueDate: today }, now)).toBe("ISSUED");
    expect(invoiceDisplayStatus({ status: "ISSUED", dueDate: null }, now)).toBe("ISSUED");
    expect(invoiceDisplayStatus({ status: "PAID", dueDate: yesterday }, now)).toBe("PAID");
    expect(invoiceDisplayStatus({ status: "DRAFT", dueDate: yesterday }, now)).toBe("DRAFT");
    expect(invoiceDisplayStatus({ status: "CANCELLED", dueDate: yesterday }, now)).toBe(
      "CANCELLED",
    );
  });

  it("formats numbers, including beyond four digits", () => {
    expect(formatInvoiceNumber(null)).toBe("Draft");
    expect(formatInvoiceNumber(7)).toBe("INV-0007");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
  });
});

describe("invoice input", () => {
  const base = { clientId: "c1", dueDate: "2026-10-01" };

  it("accepts the money and rate limits exactly", () => {
    expect(
      invoiceItemFields.parse({ description: "Max", quantity: "0.001", unitPrice: "10000000.00" }),
    ).toEqual({ description: "Max", quantity: 1, unitPrice: 1_000_000_000 });
    expect(
      createInvoiceInput.parse({ ...base, discountPercent: "100", taxPercent: "0.01" }),
    ).toMatchObject({ discountPercent: 10_000, taxPercent: 1 });
  });

  it.each([
    ["zero quantity", { quantity: "0", unitPrice: "1" }],
    ["negative price", { quantity: "1", unitPrice: "-1" }],
    ["price over the maximum", { quantity: "1", unitPrice: "10000000.01" }],
    ["too many decimals", { quantity: "1", unitPrice: "1.001" }],
    ["quantity with 4 decimals", { quantity: "1.0001", unitPrice: "1" }],
    ["exponent notation", { quantity: "1e3", unitPrice: "1" }],
  ])("rejects an item with %s", (_label, item) => {
    expect(invoiceItemFields.safeParse({ description: "X", ...item }).success).toBe(false);
  });

  it.each(["100.01", "-1", "12.345", "abc"])("rejects a %j percent rate", (rate) => {
    expect(createInvoiceInput.safeParse({ ...base, taxPercent: rate }).success).toBe(false);
  });

  it("allows at most 200 items", () => {
    const item = { description: "I", quantity: "1", unitPrice: "1" };
    expect(createInvoiceInput.safeParse({ ...base, items: Array(200).fill(item) }).success).toBe(
      true,
    );
    expect(createInvoiceInput.safeParse({ ...base, items: Array(201).fill(item) }).success).toBe(
      false,
    );
  });

  it("strips computed and identity fields sent by a client", () => {
    const parsed = createInvoiceInput.parse({
      ...base,
      totalCents: 1,
      subtotalCents: 1,
      status: "PAID",
      number: 99,
      organizationId: "other-org",
    });
    expect(parsed).not.toHaveProperty("totalCents");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("number");
    expect(parsed).not.toHaveProperty("organizationId");
  });
});

describe("project and task input", () => {
  it("allows a due date on the start date but not before it", () => {
    const project = { name: "P", startDate: "2026-09-28" };
    expect(createProjectInput.safeParse({ ...project, dueDate: "2026-09-28" }).success).toBe(true);
    expect(createProjectInput.safeParse({ ...project, dueDate: "2026-09-27" }).success).toBe(false);
  });

  it.each([-1, 101, 50.5])("rejects progress %j", (progress) => {
    expect(createProjectInput.safeParse({ name: "P", progress }).success).toBe(false);
  });

  it("treats an empty assignee as unassigned and rejects unknown statuses", () => {
    expect(createTaskInput.parse({ projectId: "p", title: "T", assigneeUserId: "" })).toMatchObject(
      { assigneeUserId: null, status: "TODO", priority: "MEDIUM" },
    );
    expect(
      createTaskInput.safeParse({ projectId: "p", title: "T", status: "BLOCKED" }).success,
    ).toBe(false);
    expect(createTaskInput.safeParse({ projectId: "p", title: " " }).success).toBe(false);
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});
