import "server-only";

import { type Prisma } from "@/generated/prisma/client";
import { type InvoiceStatus } from "@/generated/prisma/enums";
import {
  ConflictError,
  NotFoundError,
  ReferenceNotFoundError,
  ValidationError,
} from "@/lib/errors";
import { formatInvoiceNumber, invoiceDisplayStatus, todayUtc } from "@/lib/invoices";
import { computeInvoiceTotals, lineAmountCents, MAX_AMOUNT_CENTS } from "@/lib/money";
import {
  type InvoiceFields,
  type InvoiceItemFields,
  type ListInvoicesQuery,
  MAX_INVOICE_ITEMS,
} from "@/lib/validation/invoice";
import { recordAudit } from "@/server/audit/service";
import { escapeLikePattern } from "@/server/search";
import { type TenantContext } from "@/server/tenancy/context";
import { type TenantDb } from "@/server/tenancy/tenant-db";

/*
 * Invoice management. Same pattern as the other modules: tenant-scoped
 * database client only, so another organization's invoice, item or client id
 * behaves exactly like a nonexistent one.
 *
 * Consistency rules:
 * - Every change to a draft first runs `UPDATE … WHERE id = ? AND status =
 *   'DRAFT'` (lockDraft). That both checks the state and takes the invoice's
 *   row lock, so concurrent edits of the same invoice are serialized and
 *   totals are never computed from a stale set of items.
 * - Line amounts and invoice totals are always computed here (integer cents,
 *   src/lib/money.ts) in the same transaction as the change. Nothing
 *   calculated is accepted from the client.
 * - State transitions are atomic compare-and-set updates. The database also
 *   enforces them (triggers + CHECK constraints, migration invoice_management).
 *
 * Authorization is enforced by the callers through the request pipeline.
 */

type Deps = { ctx: TenantContext; db: TenantDb };
type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

function invoiceNotFound(): never {
  throw new NotFoundError("Invoice not found");
}

function tooLarge(): never {
  throw new ValidationError("Amounts exceed the maximum of 10,000,000.00", {
    details: [{ path: "items", message: "Invoice total is too large" }],
  });
}

/** The client must belong to this organization (tenant lookup) and not be archived. */
async function assertInvoiceableClient(tx: Tx, clientId: string) {
  const client = await tx.client.findUnique({ where: { id: clientId }, select: { status: true } });
  if (!client) throw new ReferenceNotFoundError();
  if (client.status === "ARCHIVED") {
    throw new ConflictError("Archived clients cannot be invoiced");
  }
}

/**
 * Lock a draft for modification: checks the state and takes the row lock in
 * one statement. 404 if the invoice is not in this organization, 409 if it
 * is no longer a draft.
 */
async function lockDraft(tx: Tx, invoiceId: string) {
  const { count } = await tx.invoice.updateMany({
    where: { id: invoiceId, status: "DRAFT" },
    data: { updatedAt: new Date() },
  });
  if (count === 0) {
    const exists = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (!exists) invoiceNotFound();
    throw new ConflictError("Only draft invoices can be changed");
  }
}

/** Recompute and store the draft's totals from its stored line amounts. */
async function recalculate(tx: Tx, invoiceId: string) {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { discountBps: true, taxBps: true, items: { select: { amountCents: true } } },
  });
  const totals = computeInvoiceTotals(
    invoice.items.map((item) => item.amountCents),
    invoice.discountBps,
    invoice.taxBps,
  );
  if (totals.subtotalCents > MAX_AMOUNT_CENTS || totals.totalCents > MAX_AMOUNT_CENTS) tooLarge();
  return tx.invoice.update({ where: { id: invoiceId }, data: totals });
}

function itemData(item: InvoiceItemFields) {
  const amountCents = lineAmountCents(item.quantity, item.unitPrice);
  if (amountCents > MAX_AMOUNT_CENTS) tooLarge();
  return {
    description: item.description,
    quantityMilli: item.quantity,
    unitPriceCents: item.unitPrice,
    amountCents,
  };
}

function headerData(fields: InvoiceFields) {
  return {
    clientId: fields.clientId,
    currency: fields.currency,
    dueDate: fields.dueDate,
    notes: fields.notes,
    discountBps: fields.discountPercent,
    taxBps: fields.taxPercent,
  };
}

/** Create a draft (optionally with items) atomically. */
export async function createInvoice(
  { ctx, db }: Deps,
  input: InvoiceFields & { items: InvoiceItemFields[] },
) {
  return db.$transaction(async (tx) => {
    await assertInvoiceableClient(tx, input.clientId);
    const invoice = await tx.invoice.create({
      data: { ...headerData(input), organizationId: ctx.organization.id },
    });
    if (input.items.length > 0) {
      await tx.invoiceItem.createMany({
        data: input.items.map((item, index) => ({
          ...itemData(item),
          organizationId: ctx.organization.id,
          invoiceId: invoice.id,
          position: index + 1,
        })),
      });
    }
    const created = await recalculate(tx, invoice.id);
    await recordAudit(tx, ctx, {
      action: "invoice.created",
      resourceId: created.id,
      metadata: {
        label: formatInvoiceNumber(created.number),
        clientId: created.clientId,
        currency: created.currency,
        totalCents: created.totalCents,
        itemCount: input.items.length,
      },
    });
    return created;
  });
}

/** Replace a draft's header fields (client, currency, due date, notes, rates). */
export async function updateInvoice({ db }: Deps, id: string, fields: InvoiceFields) {
  return db.$transaction(async (tx) => {
    await lockDraft(tx, id);
    const existing = await tx.invoice.findUniqueOrThrow({
      where: { id },
      select: { clientId: true },
    });
    if (existing.clientId !== fields.clientId) await assertInvoiceableClient(tx, fields.clientId);
    await tx.invoice.update({ where: { id }, data: headerData(fields) });
    return recalculate(tx, id);
  });
}

export async function addInvoiceItem(
  { ctx, db }: Deps,
  invoiceId: string,
  item: InvoiceItemFields,
) {
  return db.$transaction(async (tx) => {
    await lockDraft(tx, invoiceId);
    const count = await tx.invoiceItem.count({ where: { invoiceId } });
    if (count >= MAX_INVOICE_ITEMS) {
      throw new ValidationError(`An invoice can have at most ${MAX_INVOICE_ITEMS} items`);
    }
    const last = await tx.invoiceItem.findFirst({
      where: { invoiceId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const created = await tx.invoiceItem.create({
      data: {
        ...itemData(item),
        organizationId: ctx.organization.id,
        invoiceId,
        position: (last?.position ?? 0) + 1,
      },
    });
    await recalculate(tx, invoiceId);
    return created;
  });
}

async function findItem(tx: Tx, itemId: string) {
  const item = await tx.invoiceItem.findUnique({
    where: { id: itemId },
    select: { invoiceId: true },
  });
  if (!item) throw new NotFoundError("Invoice item not found");
  return item;
}

export async function updateInvoiceItem({ db }: Deps, itemId: string, item: InvoiceItemFields) {
  return db.$transaction(async (tx) => {
    const { invoiceId } = await findItem(tx, itemId);
    await lockDraft(tx, invoiceId);
    const updated = await tx.invoiceItem.update({ where: { id: itemId }, data: itemData(item) });
    await recalculate(tx, invoiceId);
    return updated;
  });
}

export async function removeInvoiceItem({ db }: Deps, itemId: string) {
  return db.$transaction(async (tx) => {
    const { invoiceId } = await findItem(tx, itemId);
    await lockDraft(tx, invoiceId);
    await tx.invoiceItem.delete({ where: { id: itemId } });
    await recalculate(tx, invoiceId);
    return { invoiceId };
  });
}

/**
 * Issue a draft: requires items, a positive total and a due date not before
 * today. Assigns the organization's next invoice number atomically (the
 * counter increment locks the organization row, so numbers are unique and
 * gap-free among issued invoices).
 */
export async function issueInvoice({ ctx, db }: Deps, id: string) {
  return db.$transaction(async (tx) => {
    await lockDraft(tx, id);
    const invoice = await recalculate(tx, id);
    const itemCount = await tx.invoiceItem.count({ where: { invoiceId: id } });
    const today = todayUtc();

    const problems: { path: string; message: string }[] = [];
    if (itemCount === 0) problems.push({ path: "items", message: "Add at least one line item" });
    else if (invoice.totalCents <= 0)
      problems.push({ path: "items", message: "The total must be greater than 0" });
    if (!invoice.dueDate) problems.push({ path: "dueDate", message: "Set a due date" });
    else if (invoice.dueDate < today)
      problems.push({ path: "dueDate", message: "The due date cannot be in the past" });
    if (problems.length > 0) {
      throw new ValidationError("This invoice cannot be issued yet", { details: problems });
    }

    const { invoiceSequence } = await tx.organization.update({
      where: { id: ctx.organization.id },
      data: { invoiceSequence: { increment: 1 } },
      select: { invoiceSequence: true },
    });
    const issued = await tx.invoice.update({
      where: { id },
      data: { status: "ISSUED", number: invoiceSequence, issueDate: today, issuedAt: new Date() },
    });
    await recordAudit(tx, ctx, {
      action: "invoice.issued",
      resourceId: id,
      metadata: {
        label: formatInvoiceNumber(issued.number),
        status: { from: "DRAFT", to: "ISSUED" },
        currency: issued.currency,
        totalCents: issued.totalCents,
        dueDate: issued.dueDate,
      },
    });
    return issued;
  });
}

/**
 * Atomic status change from one of `from` to `to`; 404/409 otherwise. The
 * update is a compare-and-set on the status read in the same transaction, so
 * the audit record names the exact previous status.
 */
async function transition(
  { ctx, db }: Deps,
  id: string,
  from: InvoiceStatus[],
  data: Prisma.InvoiceUpdateManyMutationInput & { status: InvoiceStatus },
  action: "invoice.paid" | "invoice.cancelled",
  conflictMessage: (current: InvoiceStatus) => string,
) {
  return db.$transaction(async (tx) => {
    const current =
      (await tx.invoice.findUnique({
        where: { id },
        select: { status: true, dueDate: true },
      })) ?? invoiceNotFound();
    if (!from.includes(current.status)) throw new ConflictError(conflictMessage(current.status));
    const { count } = await tx.invoice.updateMany({ where: { id, status: current.status }, data });
    if (count === 0) {
      // Changed by someone else since it was read.
      const latest = await tx.invoice.findUnique({ where: { id }, select: { status: true } });
      if (!latest) invoiceNotFound();
      throw new ConflictError(conflictMessage(latest.status));
    }
    const updated = await tx.invoice.findUniqueOrThrow({ where: { id } });
    await recordAudit(tx, ctx, {
      action,
      resourceId: id,
      metadata: {
        label: formatInvoiceNumber(updated.number),
        // OVERDUE is derived (issued and past due); recorded as it was displayed.
        status: { from: invoiceDisplayStatus(current), to: updated.status },
        currency: updated.currency,
        totalCents: updated.totalCents,
      },
    });
    return updated;
  });
}

/** Issued (including overdue) → paid. */
export function markInvoicePaid(deps: Deps, id: string) {
  return transition(
    deps,
    id,
    ["ISSUED"],
    { status: "PAID", paidAt: new Date() },
    "invoice.paid",
    (current) =>
      current === "PAID"
        ? "This invoice is already paid"
        : current === "DRAFT"
          ? "Issue the invoice before marking it as paid"
          : "Cancelled invoices cannot be marked as paid",
  );
}

/** Draft or issued (including overdue) → cancelled. Paid invoices cannot be cancelled. */
export function cancelInvoice(deps: Deps, id: string) {
  return transition(
    deps,
    id,
    ["DRAFT", "ISSUED"],
    { status: "CANCELLED", cancelledAt: new Date() },
    "invoice.cancelled",
    (current) =>
      current === "PAID"
        ? "Paid invoices cannot be cancelled"
        : "This invoice is already cancelled",
  );
}

/** Invoice with its client and items. 404 if not in this organization. */
export async function getInvoice(db: TenantDb, id: string) {
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      client: {
        select: { id: true, name: true, company: true, email: true, address: true, status: true },
      },
      items: { orderBy: [{ position: "asc" }, { id: "asc" }] },
    },
  });
  return invoice ?? invoiceNotFound();
}

function statusWhere(status: ListInvoicesQuery["status"], today: Date): Prisma.InvoiceWhereInput {
  switch (status) {
    case "all":
      return {};
    case "OVERDUE":
      return { status: "ISSUED", dueDate: { lt: today } };
    case "ISSUED":
      return { status: "ISSUED", dueDate: { gte: today } };
    default:
      return { status };
  }
}

function searchWhere(q: string | undefined): Prisma.InvoiceWhereInput {
  if (!q) return {};
  const number = /^(?:inv-?)?0*(\d{1,9})$/i.exec(q)?.[1];
  const term = { contains: escapeLikePattern(q), mode: "insensitive" as const };
  return {
    OR: [
      ...(number ? [{ number: Number(number) }] : []),
      // One relation filter (one join), not one per client column.
      { client: { OR: [{ name: term }, { company: term }] } },
    ],
  };
}

const ORDER_BY: Record<ListInvoicesQuery["sort"], Prisma.InvoiceOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  due: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  number: [{ number: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
  amount: [{ totalCents: "desc" }, { id: "asc" }],
};

export type InvoiceListResult = Awaited<ReturnType<typeof listInvoices>>;

/** Search, filter, sort and paginate invoices in the database (client names in the same round trip). */
export async function listInvoices(db: TenantDb, query: ListInvoicesQuery, now = new Date()) {
  const today = todayUtc(now);
  const base: Prisma.InvoiceWhereInput = {
    AND: [query.clientId ? { clientId: query.clientId } : {}, searchWhere(query.q)],
  };
  const where: Prisma.InvoiceWhereInput = { AND: [base, statusWhere(query.status, today)] };

  // Per-status counts (OVERDUE derived) also give the total: no separate COUNT.
  const [groups, overdue] = await Promise.all([
    db.invoice.groupBy({ by: ["status"], _count: { _all: true }, where: base }),
    db.invoice.count({ where: { AND: [base, statusWhere("OVERDUE", today)] } }),
  ]);
  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Partial<
    Record<InvoiceStatus, number>
  >;
  const statusCounts = {
    DRAFT: byStatus.DRAFT ?? 0,
    ISSUED: (byStatus.ISSUED ?? 0) - overdue,
    OVERDUE: overdue,
    PAID: byStatus.PAID ?? 0,
    CANCELLED: byStatus.CANCELLED ?? 0,
  };
  const total =
    query.status === "all"
      ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0)
      : statusCounts[query.status];

  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pageCount);
  const items = await db.invoice.findMany({
    where,
    orderBy: ORDER_BY[query.sort],
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      totalCents: true,
      paidAt: true,
      client: { select: { id: true, name: true } },
    },
  });

  return { items, total, page, pageSize: query.pageSize, pageCount, statusCounts };
}

/**
 * A client's most recent invoices (newest first, like the list's default), for
 * the client page. A plain query: the list's counts and filters are not needed.
 */
export function listClientInvoices(db: TenantDb, clientId: string, limit = 5) {
  return db.invoice.findMany({
    where: { clientId },
    orderBy: ORDER_BY.newest,
    take: limit,
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      dueDate: true,
      totalCents: true,
    },
  });
}

/** Clients that can be invoiced (active or inactive; plus the current one). */
export async function listInvoiceableClients(db: TenantDb, currentClientId?: string | null) {
  return db.client.findMany({
    where: currentClientId
      ? { OR: [{ status: { not: "ARCHIVED" } }, { id: currentClientId }] }
      : { status: { not: "ARCHIVED" } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, name: true },
  });
}
