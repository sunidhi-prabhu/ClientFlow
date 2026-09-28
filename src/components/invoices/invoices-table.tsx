import Link from "next/link";

import { type InvoiceStatus } from "@/generated/prisma/enums";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatInvoiceNumber, invoiceDisplayStatus } from "@/lib/invoices";
import { formatMoney } from "@/lib/money";

import { InvoiceStatusBadge, paymentStatusLabel } from "./invoice-status-badge";

export type InvoiceRow = {
  id: string;
  number: number | null;
  status: InvoiceStatus;
  currency: string;
  issueDate: Date | null;
  dueDate: Date | null;
  totalCents: number;
  client: { id: string; name: string };
};

/** Table on larger screens, stacked cards on phones. Each row opens the invoice. */
export function InvoicesTable({
  invoices,
  basePath,
}: {
  invoices: InvoiceRow[];
  basePath: string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl ring-1 ring-foreground/10 lg:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Invoice
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Client
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Issued
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Due
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.map((invoice) => {
              const status = invoiceDisplayStatus(invoice);
              return (
                <tr key={invoice.id} className="group relative hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`${basePath}/${invoice.id}`}
                      className="font-medium tabular-nums group-focus-within:underline after:absolute after:inset-0 focus-visible:outline-none"
                    >
                      {formatInvoiceNumber(invoice.number)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{invoice.client.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatCalendarDate(invoice.issueDate)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    <span
                      className={
                        status === "OVERDUE"
                          ? "font-medium text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {formatCalendarDate(invoice.dueDate)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="grid gap-0.5">
                      <InvoiceStatusBadge status={status} />
                      <span className="text-xs text-muted-foreground">
                        {paymentStatusLabel(status)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 lg:hidden">
        {invoices.map((invoice) => {
          const status = invoiceDisplayStatus(invoice);
          return (
            <li key={invoice.id}>
              <Link
                href={`${basePath}/${invoice.id}`}
                className="grid gap-2 rounded-xl p-4 ring-1 ring-foreground/10 hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">
                      {formatInvoiceNumber(invoice.number)}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{invoice.client.name}</p>
                  </div>
                  <InvoiceStatusBadge status={status} />
                </div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Due {formatCalendarDate(invoice.dueDate)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(invoice.totalCents, invoice.currency)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
