import { formatMoney, formatPercent } from "@/lib/money";

/** Subtotal, discount, tax and total, exactly as computed and stored by the server. */
export function InvoiceTotals({
  currency,
  subtotalCents,
  discountBps,
  discountCents,
  taxBps,
  taxCents,
  totalCents,
}: {
  currency: string;
  subtotalCents: number;
  discountBps: number;
  discountCents: number;
  taxBps: number;
  taxCents: number;
  totalCents: number;
}) {
  const rows: [string, string][] = [
    ["Subtotal", formatMoney(subtotalCents, currency)],
    [`Discount (${formatPercent(discountBps)}%)`, `−${formatMoney(discountCents, currency)}`],
    [`Tax (${formatPercent(taxBps)}%)`, formatMoney(taxCents, currency)],
  ];
  return (
    <dl className="ml-auto grid w-full max-w-xs gap-1.5 text-sm" aria-label="Invoice totals">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-semibold">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatMoney(totalCents, currency)}</dd>
      </div>
    </dl>
  );
}
