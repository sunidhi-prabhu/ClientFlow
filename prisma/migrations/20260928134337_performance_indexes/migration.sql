-- Trigram matching for case-insensitive substring search (ILIKE '%…%').
-- A trusted extension: the database owner can create it without superuser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropIndex
DROP INDEX "AuditLog_organizationId_createdAt_idx";

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_id_idx" ON "AuditLog"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Client_name_company_email_idx" ON "Client" USING GIN ("name" gin_trgm_ops, "company" gin_trgm_ops, "email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_currency_totalCents_idx" ON "Invoice"("organizationId", "status", "currency", "totalCents");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_totalCents_id_idx" ON "Invoice"("organizationId", "totalCents" DESC, "id");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_dueDate_id_idx" ON "Invoice"("organizationId", "dueDate", "id");

-- CreateIndex
CREATE INDEX "Project_organizationId_status_dueDate_idx" ON "Project"("organizationId", "status", "dueDate");
