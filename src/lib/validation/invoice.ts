import { z } from "zod";

import {
  parseAmountToCents,
  parsePercentToBps,
  parseQuantityToMilli,
  SUPPORTED_CURRENCIES,
} from "@/lib/money";
import { calendarDateField } from "@/lib/validation/dates";

/*
 * Invoice input and query schemas. Monetary values arrive as decimal strings
 * (or plain numbers, re-checked as strings) and are converted to integers by
 * src/lib/money.ts. Totals, line amounts, status, number, organizationId and
 * similar are never accepted from the client: unknown keys are stripped and
 * everything computed is recomputed on the server.
 */

export const MAX_INVOICE_ITEMS = 200;

const id = z.string().trim().min(1).max(64);

/** A decimal input converted to integer units by `parse`, with a field-level message. */
function decimalField(parse: (input: string) => number | null, message: string) {
  return z.union([z.string(), z.number()]).transform((value, context) => {
    const parsed = parse(String(value));
    if (parsed === null) {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return parsed;
  });
}

const percentField = (label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((value, context) => {
      if (value === undefined || value === "") return 0;
      const bps = parsePercentToBps(String(value));
      if (bps === null) {
        context.addIssue({
          code: "custom",
          message: `${label} must be between 0 and 100 (up to 2 decimals)`,
        });
        return z.NEVER;
      }
      return bps;
    });

export const invoiceItemFields = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Enter a description")
    .max(500, "Description must be at most 500 characters"),
  quantity: decimalField(
    parseQuantityToMilli,
    "Quantity must be greater than 0 (up to 3 decimals)",
  ),
  unitPrice: decimalField(
    parseAmountToCents,
    "Enter a price of up to 10,000,000 with at most 2 decimals",
  ),
});

export type InvoiceItemFields = z.infer<typeof invoiceItemFields>;

const invoiceFieldsObject = z.object({
  clientId: id,
  currency: z.enum(SUPPORTED_CURRENCIES, "Choose a supported currency").default("USD"),
  dueDate: calendarDateField("Due date"),
  notes: z
    .string()
    .trim()
    .max(5000, "Notes must be at most 5000 characters")
    .optional()
    .transform((value) => (value ? value : null)),
  discountPercent: percentField("Discount"),
  taxPercent: percentField("Tax"),
});

export type InvoiceFields = z.infer<typeof invoiceFieldsObject>;

/** Create a draft, optionally with its first line items (atomic). */
export const createInvoiceInput = invoiceFieldsObject.extend({
  items: z
    .array(invoiceItemFields)
    .max(MAX_INVOICE_ITEMS, `An invoice can have at most ${MAX_INVOICE_ITEMS} items`)
    .default([]),
});

/** Replace a draft's header fields (the edit form sends all of them). */
export const updateInvoiceInput = invoiceFieldsObject.extend({ id });

export const invoiceIdInput = z.object({ id });

export const addInvoiceItemInput = invoiceItemFields.extend({ invoiceId: id });
export const updateInvoiceItemInput = invoiceItemFields.extend({ id });
export const invoiceItemIdInput = z.object({ id });

/** List filters: OVERDUE is derived (issued and past its due date). */
export const INVOICE_STATUS_FILTERS = [
  "all",
  "DRAFT",
  "ISSUED",
  "OVERDUE",
  "PAID",
  "CANCELLED",
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export const INVOICE_SORTS = ["newest", "due", "number", "amount"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export const DEFAULT_INVOICE_PAGE_SIZE = 20;

export const listInvoicesQuery = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  status: z.enum(INVOICE_STATUS_FILTERS).catch("all").default("all"),
  clientId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  sort: z.enum(INVOICE_SORTS).catch("newest").default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .catch(DEFAULT_INVOICE_PAGE_SIZE)
    .default(DEFAULT_INVOICE_PAGE_SIZE),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuery>;

export function parseListInvoicesQuery(
  searchParams: Record<string, string | string[] | undefined>,
): ListInvoicesQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return listInvoicesQuery.parse({
    q: first(searchParams.q),
    status: first(searchParams.status),
    clientId: first(searchParams.clientId),
    sort: first(searchParams.sort),
    page: first(searchParams.page),
    pageSize: first(searchParams.pageSize),
  });
}
