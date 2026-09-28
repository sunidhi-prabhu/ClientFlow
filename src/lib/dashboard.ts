import { type InvoiceStatus } from "@/generated/prisma/enums";
import { type InvoiceDisplayStatus } from "@/lib/invoices";

/*
 * Pure dashboard arithmetic (no database), so the money rules can be unit
 * tested. Amounts are integer cents per currency; different currencies are
 * never added together.
 */

export type CurrencyAmount = { currency: string; cents: number };

/** One row of `invoice.groupBy({ by: ["status", "currency"] })`. */
export type InvoiceStatusGroup = {
  status: InvoiceStatus;
  currency: string;
  count: number;
  cents: number;
};

/** One row of the overdue invoices grouped by currency. */
export type CurrencyGroup = { currency: string; count: number; cents: number };

export type InvoiceStatusSummary = Record<
  InvoiceDisplayStatus,
  { count: number; amounts: CurrencyAmount[] }
>;

export type InvoiceSummary = {
  /** Counts and amounts per displayed status (ISSUED excludes OVERDUE). */
  byStatus: InvoiceStatusSummary;
  total: number;
  overdueCount: number;
  /** Everything billed: issued (including overdue) and paid invoices. */
  invoiced: CurrencyAmount[];
  /** Paid invoices, for every invoiced currency (0 when none is paid). */
  paid: CurrencyAmount[];
  /** Issued and not yet paid (including overdue). */
  outstanding: CurrencyAmount[];
  overdue: CurrencyAmount[];
};

export const INVOICE_SUMMARY_ORDER: InvoiceDisplayStatus[] = [
  "DRAFT",
  "ISSUED",
  "OVERDUE",
  "PAID",
  "CANCELLED",
];

type Totals = Map<string, number>;

function add(totals: Totals, currency: string, cents: number) {
  const sum = (totals.get(currency) ?? 0) + cents;
  // Sums of integer cents stay exact only below 2^53; fail loudly rather than round.
  if (!Number.isSafeInteger(sum)) throw new RangeError("Invoice amount exceeds the exact range");
  totals.set(currency, sum);
}

function toAmounts(totals: Totals, currencies: Iterable<string> = totals.keys()): CurrencyAmount[] {
  return [...new Set(currencies)]
    .sort()
    .map((currency) => ({ currency, cents: totals.get(currency) ?? 0 }));
}

/**
 * Combines the per-status/currency invoice groups with the overdue groups.
 * OVERDUE is derived (ISSUED with a past due date), so overdue invoices are
 * moved out of ISSUED rather than counted twice.
 */
export function summarizeInvoices(
  groups: InvoiceStatusGroup[],
  overdueGroups: CurrencyGroup[],
): InvoiceSummary {
  const counts: Record<InvoiceDisplayStatus, number> = {
    DRAFT: 0,
    ISSUED: 0,
    OVERDUE: 0,
    PAID: 0,
    CANCELLED: 0,
  };
  const amounts: Record<InvoiceDisplayStatus, Totals> = {
    DRAFT: new Map(),
    ISSUED: new Map(),
    OVERDUE: new Map(),
    PAID: new Map(),
    CANCELLED: new Map(),
  };
  const invoiced: Totals = new Map();
  const outstanding: Totals = new Map();

  for (const group of groups) {
    counts[group.status] += group.count;
    add(amounts[group.status], group.currency, group.cents);
    if (group.status === "ISSUED" || group.status === "PAID") {
      add(invoiced, group.currency, group.cents);
    }
    if (group.status === "ISSUED") add(outstanding, group.currency, group.cents);
  }
  for (const group of overdueGroups) {
    counts.OVERDUE += group.count;
    counts.ISSUED -= group.count;
    add(amounts.OVERDUE, group.currency, group.cents);
    add(amounts.ISSUED, group.currency, -group.cents);
  }

  const byStatus = Object.fromEntries(
    INVOICE_SUMMARY_ORDER.map((status) => [
      status,
      {
        count: counts[status],
        // Currencies that net to zero (e.g. all their ISSUED invoices are overdue) are left out.
        amounts: toAmounts(amounts[status]).filter((amount) => amount.cents !== 0),
      },
    ]),
  ) as InvoiceStatusSummary;

  return {
    byStatus,
    total: groups.reduce((sum, group) => sum + group.count, 0),
    overdueCount: counts.OVERDUE,
    invoiced: toAmounts(invoiced),
    paid: toAmounts(amounts.PAID, invoiced.keys()),
    outstanding: toAmounts(outstanding, invoiced.keys()),
    overdue: toAmounts(amounts.OVERDUE),
  };
}

/** Rounded share of `part` in `total` (0 when there is nothing). */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
