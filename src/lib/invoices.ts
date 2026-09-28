import { type InvoiceStatus } from "@/generated/prisma/enums";
import { isBeforeToday } from "@/lib/calendar-date";

/** Status shown to users: OVERDUE is derived from ISSUED + a past due date. */
export type InvoiceDisplayStatus = InvoiceStatus | "OVERDUE";

export function invoiceDisplayStatus(
  invoice: { status: InvoiceStatus; dueDate: Date | null },
  now: Date = new Date(),
): InvoiceDisplayStatus {
  if (invoice.status === "ISSUED" && invoice.dueDate && isBeforeToday(invoice.dueDate, now)) {
    return "OVERDUE";
  }
  return invoice.status;
}

/** 7 → "INV-0007"; drafts have no number yet. */
export function formatInvoiceNumber(number: number | null): string {
  return number === null ? "Draft" : `INV-${String(number).padStart(4, "0")}`;
}

/** Start of today (UTC) as a Date, for comparing with `@db.Date` columns. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
