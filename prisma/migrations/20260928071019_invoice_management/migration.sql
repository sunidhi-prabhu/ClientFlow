-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "invoiceSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "issueDate" DATE,
    "dueDate" DATE,
    "notes" TEXT,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_dueDate_idx" ON "Invoice"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_clientId_idx" ON "Invoice"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_createdAt_idx" ON "Invoice"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_id_key" ON "Invoice"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_number_key" ON "Invoice"("organizationId", "number");

-- CreateIndex
CREATE INDEX "InvoiceItem_organizationId_invoiceId_position_idx" ON "InvoiceItem"("organizationId", "invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceItem_organizationId_id_key" ON "InvoiceItem"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "Client"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_invoiceSequence_check" CHECK ("invoiceSequence" >= 0);

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_amounts_check" CHECK (
    "subtotalCents" >= 0 AND "discountCents" >= 0 AND "taxCents" >= 0 AND "totalCents" >= 0
    AND "discountCents" <= "subtotalCents"
    AND "totalCents" = "subtotalCents" - "discountCents" + "taxCents"
  ),
  ADD CONSTRAINT "Invoice_rates_check" CHECK (
    "discountBps" BETWEEN 0 AND 10000 AND "taxBps" BETWEEN 0 AND 10000
  ),
  ADD CONSTRAINT "Invoice_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Invoice_number_check" CHECK ("number" IS NULL OR "number" > 0),
  -- Issuing fields are all-or-nothing: set together on issue, never on a draft.
  -- ISSUED/PAID invoices have them; a CANCELLED invoice has them only if it was
  -- issued before being cancelled (a cancelled draft has none).
  ADD CONSTRAINT "Invoice_issued_fields_check" CHECK (
    (("number" IS NULL) = ("issuedAt" IS NULL) AND ("issuedAt" IS NULL) = ("issueDate" IS NULL))
    AND ("status" <> 'DRAFT' OR "issuedAt" IS NULL)
    AND ("status" NOT IN ('ISSUED', 'PAID') OR ("issuedAt" IS NOT NULL AND "dueDate" IS NOT NULL))
  ),
  ADD CONSTRAINT "Invoice_dates_check" CHECK (
    "issueDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "issueDate"
  ),
  ADD CONSTRAINT "Invoice_paid_check" CHECK (("status" = 'PAID') = ("paidAt" IS NOT NULL)),
  ADD CONSTRAINT "Invoice_cancelled_check" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_values_check" CHECK (
    "quantityMilli" > 0 AND "unitPriceCents" >= 0 AND "amountCents" >= 0 AND length(trim("description")) > 0
  );

-- Status transitions and immutability of non-draft invoices.
-- Allowed: DRAFT→ISSUED, DRAFT→CANCELLED, ISSUED→PAID, ISSUED→CANCELLED.
-- Once not a draft, only status/paidAt/cancelledAt/updatedAt may change.
-- Invoices are never deleted directly (only by deleting the organization).
CREATE FUNCTION "invoice_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF; -- cascade from organization deletion
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Invoice % is not a draft and cannot be deleted', OLD."id" USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('ISSUED', 'CANCELLED')) OR
    (OLD."status" = 'ISSUED' AND NEW."status" IN ('PAID', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'Invalid invoice status transition % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'DRAFT' AND (
    NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
    NEW."clientId" IS DISTINCT FROM OLD."clientId" OR
    NEW."number" IS DISTINCT FROM OLD."number" OR
    NEW."currency" IS DISTINCT FROM OLD."currency" OR
    NEW."issueDate" IS DISTINCT FROM OLD."issueDate" OR
    NEW."dueDate" IS DISTINCT FROM OLD."dueDate" OR
    NEW."notes" IS DISTINCT FROM OLD."notes" OR
    NEW."discountBps" IS DISTINCT FROM OLD."discountBps" OR
    NEW."taxBps" IS DISTINCT FROM OLD."taxBps" OR
    NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents" OR
    NEW."discountCents" IS DISTINCT FROM OLD."discountCents" OR
    NEW."taxCents" IS DISTINCT FROM OLD."taxCents" OR
    NEW."totalCents" IS DISTINCT FROM OLD."totalCents" OR
    NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
  ) THEN
    RAISE EXCEPTION 'Invoice % is not a draft and cannot be modified', OLD."id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Invoice_guard"
BEFORE UPDATE OR DELETE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION "invoice_guard"();

-- Line items can only be added, changed or removed while the invoice is a draft.
CREATE FUNCTION "invoice_item_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "InvoiceStatus";
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF; -- cascade
  SELECT "status" INTO parent_status FROM "Invoice"
  WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END);
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Invoice items can only be changed while the invoice is a draft' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InvoiceItem_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceItem"
FOR EACH ROW EXECUTE FUNCTION "invoice_item_guard"();
