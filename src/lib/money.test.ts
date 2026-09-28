import { describe, expect, it } from "vitest";

import {
  computeInvoiceTotals,
  formatMoney,
  formatPercent,
  formatQuantity,
  lineAmountCents,
  MAX_AMOUNT_CENTS,
  parseAmountToCents,
  parsePercentToBps,
  parseQuantityToMilli,
  percentOfCents,
} from "@/lib/money";

describe("line amounts", () => {
  it("multiplies quantity (thousandths) by unit price (cents)", () => {
    expect(lineAmountCents(1000, 12_345)).toBe(12_345); // 1 × 123.45
    expect(lineAmountCents(1500, 10_000)).toBe(15_000); // 1.5 × 100.00
    expect(lineAmountCents(2_000_000, 1)).toBe(2000); // 2000 × 0.01
  });

  it("rounds half-up to the cent", () => {
    expect(lineAmountCents(1, 500)).toBe(1); // 0.001 × 5.00 = 0.005 → 0.01
    expect(lineAmountCents(1, 499)).toBe(0); // 0.00499 → 0.00
    expect(lineAmountCents(333, 100)).toBe(33); // 0.333 × 1.00 = 0.333
    expect(lineAmountCents(1333, 1999)).toBe(2665); // 1.333 × 19.99 = 26.64667
  });

  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 style problems: 3 × 0.10 must be exactly 0.30.
    expect(lineAmountCents(3000, 10)).toBe(30);
    // Products beyond 2^53 still compute exactly with BigInt.
    expect(lineAmountCents(999_999_999, 1_000_000_000)).toBe(999_999_999_000_000);
  });
});

describe("tax and discount", () => {
  it("computes percentages in basis points, half-up", () => {
    expect(percentOfCents(10_000, 1825)).toBe(1825); // 18.25% of 100.00
    expect(percentOfCents(1, 5000)).toBe(1); // 50% of 0.01 = 0.005 → 0.01
    expect(percentOfCents(3, 3333)).toBe(1); // 0.9999 → 1
    expect(percentOfCents(12_345, 0)).toBe(0);
  });

  it("applies the discount to the subtotal and tax to the discounted subtotal", () => {
    // 100.00 + 50.00, 10% discount, 20% tax.
    expect(computeInvoiceTotals([10_000, 5_000], 1000, 2000)).toEqual({
      subtotalCents: 15_000,
      discountCents: 1_500,
      taxCents: 2_700,
      totalCents: 16_200,
    });
  });

  it("keeps total = subtotal - discount + tax under rounding", () => {
    const totals = computeInvoiceTotals([333, 333, 334], 1234, 1875);
    expect(totals.totalCents).toBe(totals.subtotalCents - totals.discountCents + totals.taxCents);
    expect(totals).toEqual({
      subtotalCents: 1000,
      discountCents: 123,
      taxCents: 164,
      totalCents: 1041,
    });
  });

  it("handles empty invoices and 100% discount", () => {
    expect(computeInvoiceTotals([], 1000, 2000)).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
    expect(computeInvoiceTotals([5000], 10_000, 2000).totalCents).toBe(0);
  });
});

describe("parsing", () => {
  it("parses amounts to cents without floating point", () => {
    expect(parseAmountToCents("0.1")).toBe(10);
    expect(parseAmountToCents("19.99")).toBe(1999);
    expect(parseAmountToCents(" 1,234.5 ")).toBe(123_450);
    expect(parseAmountToCents("10000000")).toBe(MAX_AMOUNT_CENTS);
  });

  it("rejects invalid or out-of-range amounts", () => {
    for (const input of [
      "",
      "-1",
      "1.234",
      "1e3",
      "abc",
      "1.",
      ".5",
      "10000000.01",
      "12,34.5",
      "NaN",
    ]) {
      expect(parseAmountToCents(input)).toBeNull();
    }
  });

  it("parses positive quantities with up to 3 decimals", () => {
    expect(parseQuantityToMilli("1.5")).toBe(1500);
    expect(parseQuantityToMilli("0.001")).toBe(1);
    expect(parseQuantityToMilli("999999.999")).toBe(999_999_999);
    for (const input of ["0", "0.000", "-1", "1.2345", "1000000"]) {
      expect(parseQuantityToMilli(input)).toBeNull();
    }
  });

  it("parses percentages 0–100 with up to 2 decimals", () => {
    expect(parsePercentToBps("18.25")).toBe(1825);
    expect(parsePercentToBps("0")).toBe(0);
    expect(parsePercentToBps("100")).toBe(10_000);
    for (const input of ["100.01", "-5", "12.345", "abc"]) {
      expect(parsePercentToBps(input)).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("formats money exactly", () => {
    expect(formatMoney(123_450, "USD")).toBe("$1,234.50");
    expect(formatMoney(10, "EUR")).toBe("€0.10");
    expect(formatMoney(MAX_AMOUNT_CENTS, "INR")).toBe("₹10,000,000.00");
    expect(formatMoney(0, "GBP")).toBe("£0.00");
  });

  it("formats quantities and percentages without trailing zeros", () => {
    expect(formatQuantity(1500)).toBe("1.5");
    expect(formatQuantity(2000)).toBe("2");
    expect(formatQuantity(1)).toBe("0.001");
    expect(formatPercent(1825)).toBe("18.25");
    expect(formatPercent(1000)).toBe("10");
    expect(formatPercent(0)).toBe("0");
  });
});
