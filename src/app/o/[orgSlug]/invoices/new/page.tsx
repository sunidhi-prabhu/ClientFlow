import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { InvoiceForm } from "@/components/invoices/invoice-form";
import { AccessDenied } from "@/components/layout/access-denied";
import { listInvoiceableClients } from "@/server/invoices/service";
import { tenantPage } from "@/server/protected";

import { createInvoiceAction } from "../actions";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/invoices/new">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "invoice:create");
  if (!access.allowed) return <AccessDenied message="Your role cannot create invoices." />;
  const slug = access.ctx.organization.slug;
  const clients = await listInvoiceableClients(access.db);
  // Preselect a client coming from its page (?clientId=…); only if it is one of ours.
  const { clientId } = await searchParams;
  const preselected = clients.find((client) => client.id === clientId)?.id ?? "";

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={`/o/${slug}/invoices`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Invoices
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">
          Creates a draft. You&apos;ll add line items next, then issue it.
        </p>
      </div>
      {clients.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          Add a client first:{" "}
          <Link href={`/o/${slug}/clients/new`} className="font-medium underline">
            new client
          </Link>
          .
        </p>
      ) : (
        <InvoiceForm
          organizationSlug={slug}
          action={createInvoiceAction}
          clients={clients}
          submitLabel="Create draft"
          initial={{
            clientId: preselected,
            currency: "USD",
            dueDate: "",
            notes: null,
            discountPercent: "0",
            taxPercent: "0",
          }}
        />
      )}
    </div>
  );
}
