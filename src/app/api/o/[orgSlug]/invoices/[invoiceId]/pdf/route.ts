import { z } from "zod";

import { formatInvoiceNumber } from "@/lib/invoices";
import { renderInvoicePdf } from "@/server/invoices/pdf";
import { getInvoice } from "@/server/invoices/service";
import { tenantRoute } from "@/server/protected";

const input = z.object({});

/**
 * GET /api/o/[orgSlug]/invoices/[invoiceId]/pdf
 * Downloads the invoice as a PDF. Standard pipeline: session → membership →
 * invoice:read. The invoice id is looked up through the tenant client, so
 * another organization's invoice is a 404.
 */
export const GET = tenantRoute<
  typeof input,
  RouteContext<"/api/o/[orgSlug]/invoices/[invoiceId]/pdf">
>({ permission: "invoice:read", input }, async ({ ctx, db, params }) => {
  const invoice = await getInvoice(db, params.invoiceId);
  const pdf = await renderInvoicePdf(invoice, ctx.organization.name);
  const filename = `${formatInvoiceNumber(invoice.number).replace(/[^A-Za-z0-9-]/g, "")}-${invoice.id}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
