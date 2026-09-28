import { ArrowLeft, Download, Pencil } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { InvoiceItemsEditor } from "@/components/invoices/invoice-items-editor";
import { InvoiceStatusBadge, paymentStatusLabel } from "@/components/invoices/invoice-status-badge";
import { InvoiceTotals } from "@/components/invoices/invoice-totals";
import { AccessDenied } from "@/components/layout/access-denied";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalendarDate } from "@/lib/calendar-date";
import { NotFoundError } from "@/lib/errors";
import { formatInvoiceNumber, invoiceDisplayStatus } from "@/lib/invoices";
import { hasPermission } from "@/lib/permissions";
import { getInvoice } from "@/server/invoices/service";
import { tenantPage } from "@/server/protected";

import {
  addInvoiceItemAction,
  cancelInvoiceAction,
  issueInvoiceAction,
  markInvoicePaidAction,
  removeInvoiceItemAction,
  updateInvoiceItemAction,
} from "../actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
}: PageProps<"/o/[orgSlug]/invoices/[invoiceId]">) {
  const { orgSlug, invoiceId } = await params;
  const access = await tenantPage(orgSlug, "invoice:read");
  if (!access.allowed)
    return <AccessDenied message="Ask an owner or admin for access to invoices." />;
  const { ctx, db } = access;

  // Unknown ids and other organizations' invoices both render the 404 page.
  const invoice = await getInvoice(db, invoiceId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const slug = ctx.organization.slug;
  const status = invoiceDisplayStatus(invoice);
  const isDraft = invoice.status === "DRAFT";
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    hasPermission(ctx.role, permission);
  const editable = isDraft && can("invoice:update");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/o/${slug}/invoices`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Invoices
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{ctx.organization.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight tabular-nums">
                {isDraft ? "Draft invoice" : formatInvoiceNumber(invoice.number)}
              </h1>
              <InvoiceStatusBadge status={status} />
            </div>
            <p className="text-sm text-muted-foreground">{paymentStatusLabel(status)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <InvoiceActions
              organizationSlug={slug}
              invoiceId={invoice.id}
              allowed={{
                issue: isDraft && can("invoice:send"),
                pay: invoice.status === "ISSUED" && can("invoice:update"),
                cancel: (isDraft || invoice.status === "ISSUED") && can("invoice:delete"),
              }}
              actions={{
                issue: issueInvoiceAction,
                pay: markInvoicePaidAction,
                cancel: cancelInvoiceAction,
              }}
            />
            <div className="flex gap-2 print:hidden">
              {editable && (
                <Link
                  href={`/o/${slug}/invoices/${invoice.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Pencil aria-hidden />
                  Edit details
                </Link>
              )}
              <a
                href={`/api/o/${slug}/invoices/${invoice.id}/pdf`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Download aria-hidden />
                Download PDF
              </a>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-6 pt-2">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1">
              <dt className="text-muted-foreground">Bill to</dt>
              <dd>
                <Link
                  href={`/o/${slug}/clients/${invoice.client.id}`}
                  className="font-medium hover:underline"
                >
                  {invoice.client.name}
                </Link>
                {invoice.client.company && <p>{invoice.client.company}</p>}
                {invoice.client.email && (
                  <p className="text-muted-foreground">{invoice.client.email}</p>
                )}
                {invoice.client.address && (
                  <p className="whitespace-pre-line text-muted-foreground">
                    {invoice.client.address}
                  </p>
                )}
              </dd>
            </div>
            <div className="grid content-start gap-1">
              <dt className="text-muted-foreground">Issue date</dt>
              <dd>{formatCalendarDate(invoice.issueDate)}</dd>
            </div>
            <div className="grid content-start gap-1">
              <dt className="text-muted-foreground">Due date</dt>
              <dd className={status === "OVERDUE" ? "font-medium text-destructive" : undefined}>
                {formatCalendarDate(invoice.dueDate)}
                {status === "OVERDUE" && " (overdue)"}
              </dd>
            </div>
            <div className="grid content-start gap-1">
              <dt className="text-muted-foreground">Payment</dt>
              <dd>
                {invoice.paidAt
                  ? `Paid ${formatCalendarDate(invoice.paidAt)}`
                  : paymentStatusLabel(status)}
                {invoice.cancelledAt && (
                  <p className="text-muted-foreground">
                    Cancelled {formatCalendarDate(invoice.cancelledAt)}
                  </p>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6">
          <InvoiceItemsEditor
            organizationSlug={slug}
            invoiceId={invoice.id}
            currency={invoice.currency}
            items={invoice.items}
            editable={editable}
            addAction={addInvoiceItemAction}
            updateAction={updateInvoiceItemAction}
            removeAction={removeInvoiceItemAction}
          />
          <InvoiceTotals
            currency={invoice.currency}
            subtotalCents={invoice.subtotalCents}
            discountBps={invoice.discountBps}
            discountCents={invoice.discountCents}
            taxBps={invoice.taxBps}
            taxCents={invoice.taxCents}
            totalCents={invoice.totalCents}
          />
        </CardContent>
      </Card>

      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm break-words whitespace-pre-line">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
