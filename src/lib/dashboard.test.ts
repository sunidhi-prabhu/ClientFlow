import { describe, expect, it } from "vitest";

import { percentOf, summarizeInvoices } from "./dashboard";

describe("summarizeInvoices", () => {
  it("moves overdue invoices out of ISSUED and totals each currency in exact cents", () => {
    const summary = summarizeInvoices(
      [
        { status: "DRAFT", currency: "USD", count: 2, cents: 5_000 },
        { status: "ISSUED", currency: "USD", count: 3, cents: 30_001 },
        { status: "PAID", currency: "USD", count: 1, cents: 12_345 },
        { status: "CANCELLED", currency: "USD", count: 1, cents: 999 },
        { status: "ISSUED", currency: "EUR", count: 1, cents: 700 },
        { status: "PAID", currency: "EUR", count: 1, cents: 10 },
      ],
      [{ currency: "USD", count: 2, cents: 20_000 }],
    );

    expect(summary.total).toBe(9);
    expect(summary.overdueCount).toBe(2);
    expect(summary.byStatus.ISSUED).toEqual({
      count: 2,
      amounts: [
        { currency: "EUR", cents: 700 },
        { currency: "USD", cents: 10_001 },
      ],
    });
    expect(summary.byStatus.OVERDUE).toEqual({
      count: 2,
      amounts: [{ currency: "USD", cents: 20_000 }],
    });
    expect(summary.byStatus.DRAFT.count).toBe(2);
    expect(summary.byStatus.CANCELLED.count).toBe(1);
    // Invoiced = issued (including overdue) + paid; drafts and cancelled are excluded.
    expect(summary.invoiced).toEqual([
      { currency: "EUR", cents: 710 },
      { currency: "USD", cents: 42_346 },
    ]);
    expect(summary.paid).toEqual([
      { currency: "EUR", cents: 10 },
      { currency: "USD", cents: 12_345 },
    ]);
    expect(summary.outstanding).toEqual([
      { currency: "EUR", cents: 700 },
      { currency: "USD", cents: 30_001 },
    ]);
    expect(summary.overdue).toEqual([{ currency: "USD", cents: 20_000 }]);
  });

  it("reports zero paid for an invoiced currency with no payments, and omits emptied currencies", () => {
    const summary = summarizeInvoices(
      [{ status: "ISSUED", currency: "GBP", count: 1, cents: 5_00 }],
      [{ currency: "GBP", count: 1, cents: 5_00 }],
    );
    expect(summary.paid).toEqual([{ currency: "GBP", cents: 0 }]);
    expect(summary.byStatus.ISSUED).toEqual({ count: 0, amounts: [] });
    expect(summary.byStatus.OVERDUE.count).toBe(1);
  });

  it("is all zeros without invoices", () => {
    const summary = summarizeInvoices([], []);
    expect(summary.total).toBe(0);
    expect(summary.overdueCount).toBe(0);
    expect(summary.invoiced).toEqual([]);
    expect(summary.paid).toEqual([]);
    expect(Object.values(summary.byStatus).every((s) => s.count === 0)).toBe(true);
  });

  it("stays exact beyond 32-bit sums and refuses to round past 2^53", () => {
    const big = 1_000_000_000;
    const groups = Array.from({ length: 5 }, () => ({
      status: "PAID" as const,
      currency: "USD",
      count: 1,
      cents: big + 1,
    }));
    expect(summarizeInvoices(groups, []).paid).toEqual([{ currency: "USD", cents: 5 * big + 5 }]);
    expect(() =>
      summarizeInvoices(
        [
          { status: "PAID", currency: "USD", count: 1, cents: Number.MAX_SAFE_INTEGER },
          { status: "PAID", currency: "USD", count: 1, cents: 1 },
        ],
        [],
      ),
    ).toThrow(RangeError);
  });
});

describe("percentOf", () => {
  it("rounds shares and handles an empty total", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 0)).toBe(0);
  });
});
