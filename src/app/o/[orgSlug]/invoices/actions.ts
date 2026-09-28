"use server";

import { redirect } from "next/navigation";

import {
  addInvoiceItemInput,
  createInvoiceInput,
  invoiceIdInput,
  invoiceItemIdInput,
  updateInvoiceInput,
  updateInvoiceItemInput,
} from "@/lib/validation/invoice";
import {
  addInvoiceItem,
  cancelInvoice,
  createInvoice,
  issueInvoice,
  markInvoicePaid,
  removeInvoiceItem,
  updateInvoice,
  updateInvoiceItem,
} from "@/server/invoices/service";
import { tenantAction } from "@/server/protected";

/*
 * Invoice Server Actions: the standard pipeline (session → tenant context →
 * permission → validation) around a service call.
 *
 * Permissions: view → invoice:read; create draft → invoice:create; edit draft
 * and its items, mark paid → invoice:update; issue → invoice:send;
 * cancel → invoice:delete (OWNER/ADMIN only).
 */

const create = tenantAction(
  { permission: "invoice:create", input: createInvoiceInput },
  async ({ ctx, db, input }) => {
    const invoice = await createInvoice({ ctx, db }, input);
    return { id: invoice.id, organizationSlug: ctx.organization.slug };
  },
);

export async function createInvoiceAction(organizationSlug: string, input: unknown) {
  const result = await create(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/invoices/${result.data.id}`);
  return result;
}

const update = tenantAction(
  { permission: "invoice:update", input: updateInvoiceInput },
  async ({ ctx, db, input: { id, ...fields } }) => {
    const invoice = await updateInvoice({ ctx, db }, id, fields);
    return { id: invoice.id, organizationSlug: ctx.organization.slug };
  },
);

export async function updateInvoiceAction(organizationSlug: string, input: unknown) {
  const result = await update(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/invoices/${result.data.id}`);
  return result;
}

export const addInvoiceItemAction = tenantAction(
  { permission: "invoice:update", input: addInvoiceItemInput },
  async ({ ctx, db, input: { invoiceId, ...item } }) => {
    const created = await addInvoiceItem({ ctx, db }, invoiceId, item);
    return { id: created.id };
  },
);

export const updateInvoiceItemAction = tenantAction(
  { permission: "invoice:update", input: updateInvoiceItemInput },
  async ({ ctx, db, input: { id, ...item } }) => {
    const updated = await updateInvoiceItem({ ctx, db }, id, item);
    return { id: updated.id };
  },
);

export const removeInvoiceItemAction = tenantAction(
  { permission: "invoice:update", input: invoiceItemIdInput },
  async ({ ctx, db, input }) => removeInvoiceItem({ ctx, db }, input.id),
);

export const issueInvoiceAction = tenantAction(
  { permission: "invoice:send", input: invoiceIdInput },
  async ({ ctx, db, input }) => {
    const invoice = await issueInvoice({ ctx, db }, input.id);
    return { id: invoice.id, status: invoice.status, number: invoice.number };
  },
);

export const markInvoicePaidAction = tenantAction(
  { permission: "invoice:update", input: invoiceIdInput },
  async ({ ctx, db, input }) => {
    const invoice = await markInvoicePaid({ ctx, db }, input.id);
    return { id: invoice.id, status: invoice.status };
  },
);

export const cancelInvoiceAction = tenantAction(
  { permission: "invoice:delete", input: invoiceIdInput },
  async ({ ctx, db, input }) => {
    const invoice = await cancelInvoice({ ctx, db }, input.id);
    return { id: invoice.id, status: invoice.status };
  },
);
