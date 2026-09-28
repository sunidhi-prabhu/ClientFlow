import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { InvoiceForm } from "@/components/invoices/invoice-form";
import { AccessDenied } from "@/components/layout/access-denied";
import { toDateInputValue } from "@/lib/calendar-date";
import { NotFoundError } from "@/lib/errors";
import { formatPercent } from "@/lib/money";
import { getInvoice, listInvoiceableClients } from "@/server/invoices/service";
import { tenantPage } from "@/server/protected";

import { updateInvoiceAction } from "../../actions";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({
  params,
}: PageProps<"/o/[orgSlug]/invoices/[invoiceId]/edit">) {
  const { orgSlug, invoiceId } = await params;
  const access = await tenantPage(orgSlug, "invoice:update");
  if (!access.allowed) return <AccessDenied message="Your role cannot edit invoices." />;

  const invoice = await getInvoice(access.db, invoiceId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const slug = access.ctx.organization.slug;
  const detailsPath = `/o/${slug}/invoices/${invoice.id}`;
  // Only drafts are editable.
  if (invoice.status !== "DRAFT") redirect(detailsPath);
  const clients = await listInvoiceableClients(access.db, invoice.clientId);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={detailsPath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Draft invoice
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit invoice</h1>
      </div>
      <InvoiceForm
        organizationSlug={slug}
        action={updateInvoiceAction}
        clients={clients}
        submitLabel="Save changes"
        initial={{
          id: invoice.id,
          clientId: invoice.clientId,
          currency: invoice.currency,
          dueDate: toDateInputValue(invoice.dueDate),
          notes: invoice.notes,
          discountPercent: formatPercent(invoice.discountBps),
          taxPercent: formatPercent(invoice.taxBps),
        }}
      />
    </div>
  );
}
