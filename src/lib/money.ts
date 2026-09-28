/*
 * Money and invoice arithmetic. Pure and dependency-free: the server uses it
 * authoritatively and the UI may use it for previews (the server always
 * recomputes; totals from the browser are never trusted).
 *
 * - Amounts are integer minor units (cents) of a 2-decimal currency.
 * - Quantities are integer thousandths (1500 = 1.5).
 * - Rates are basis points (1825 = 18.25%).
 * - All products/divisions use BigInt, rounding half-up to the cent.
 *   No floating-point arithmetic is used for any amount.
 */

/** 2-decimal ISO 4217 currencies supported for invoices. */
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Largest amount stored anywhere (10,000,000.00): well inside a 32-bit integer column. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;
/** Largest quantity (999,999.999). */
export const MAX_QUANTITY_MILLI = 999_999_999;
export const MAX_BPS = 10_000;

/** Non-negative a × b / divisor, rounded half-up, exactly (BigInt). */
function mulDivRoundHalfUp(a: number, b: number, divisor: number): number {
  const product = BigInt(a) * BigInt(b);
  const d = BigInt(divisor);
  return Number((product * 2n + d) / (2n * d));
}

/** quantity (thousandths) × unit price (cents) → cents, rounded half-up. */
export function lineAmountCents(quantityMilli: number, unitPriceCents: number): number {
  return mulDivRoundHalfUp(quantityMilli, unitPriceCents, 1000);
}

/** `cents` × rate (basis points) → cents, rounded half-up. */
export function percentOfCents(cents: number, bps: number): number {
  return mulDivRoundHalfUp(cents, bps, 10_000);
}

export type InvoiceTotals = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

/**
 * Invoice totals from line amounts: discount applies to the subtotal, tax to
 * the discounted subtotal. total = subtotal - discount + tax.
 */
export function computeInvoiceTotals(
  lineAmounts: number[],
  discountBps: number,
  taxBps: number,
): InvoiceTotals {
  const subtotalCents = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const discountCents = percentOfCents(subtotalCents, discountBps);
  const taxCents = percentOfCents(subtotalCents - discountCents, taxBps);
  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
  };
}

function parseDecimal(input: string, maxDecimals: number, maxWholeDigits: number) {
  const value = input.trim().replace(/,(?=\d{3}(\D|$))/g, "");
  const match = new RegExp(`^(\\d{1,${maxWholeDigits}})(?:\\.(\\d{1,${maxDecimals}}))?$`).exec(
    value,
  );
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(maxDecimals, "0");
  return Number(match[1]) * 10 ** maxDecimals + Number(fraction || "0");
}

/** "1,234.5" → 123450 (cents). null if not a valid non-negative amount with ≤ 2 decimals. */
export function parseAmountToCents(input: string): number | null {
  const cents = parseDecimal(input, 2, 8);
  return cents === null || cents > MAX_AMOUNT_CENTS ? null : cents;
}

/** "1.5" → 1500 (thousandths). null if not a positive quantity with ≤ 3 decimals. */
export function parseQuantityToMilli(input: string): number | null {
  const milli = parseDecimal(input, 3, 6);
  return milli === null || milli <= 0 || milli > MAX_QUANTITY_MILLI ? null : milli;
}

/** "18.25" → 1825 (basis points). null unless 0–100 with ≤ 2 decimals. */
export function parsePercentToBps(input: string): number | null {
  const bps = parseDecimal(input, 2, 3);
  return bps === null || bps > MAX_BPS ? null : bps;
}

/** Integer units as a decimal string without floating point: (123450, 2) → "1234.50". */
function toDecimalString(units: number, decimals: number): string {
  const sign = units < 0 ? "-" : "";
  const digits = String(Math.abs(units)).padStart(decimals + 1, "0");
  return decimals === 0
    ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** 123450, "USD" → "$1,234.50" (formatted from the exact decimal string). */
export function formatMoney(cents: number, currency: string): string {
  let format = moneyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en", { style: "currency", currency });
    moneyFormats.set(currency, format);
  }
  // Intl formats decimal strings exactly (no binary floating-point step).
  return format.format(toDecimalString(cents, 2) as unknown as number);
}

const plainAmount = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123450 → "1,234.50" (no currency symbol; e.g. for PDFs, shown with the currency code). */
export function formatAmount(cents: number): string {
  return plainAmount.format(toDecimalString(cents, 2) as unknown as number);
}

/** For inputs: 123450 → "1234.50". */
export function centsToInput(cents: number): string {
  return toDecimalString(cents, 2);
}

/** 1500 → "1.5" (trailing zeros trimmed). */
export function formatQuantity(milli: number): string {
  return toDecimalString(milli, 3).replace(/\.?0+$/, "");
}

/** 1825 → "18.25" (trailing zeros trimmed). */
export function formatPercent(bps: number): string {
  return toDecimalString(bps, 2).replace(/\.?0+$/, "");
}
