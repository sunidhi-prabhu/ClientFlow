-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_actorUserId_createdAt_idx" ON "AuditLog"("organizationId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_resourceType_createdAt_idx" ON "AuditLog"("organizationId", "resourceType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_organizationId_id_key" ON "AuditLog"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit records are append-only.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_action_check" CHECK ("action" ~ '^[a-z]+\.[a-z_]+$'),
  ADD CONSTRAINT "AuditLog_resourceType_check" CHECK (
    "resourceType" IN ('user', 'organization', 'membership', 'client', 'project', 'task', 'invoice')
  ),
  ADD CONSTRAINT "AuditLog_metadata_check" CHECK (jsonb_typeof("metadata") = 'object');

-- No UPDATE or DELETE, except what foreign-key actions do on behalf of other
-- tables (pg_trigger_depth() > 1): deleting the organization removes its log,
-- and deleting a user only clears actorUserId.
CREATE FUNCTION "audit_log_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW."actorUserId" IS NULL
      AND NEW."id" = OLD."id"
      AND NEW."organizationId" = OLD."organizationId"
      AND NEW."action" = OLD."action"
      AND NEW."resourceType" = OLD."resourceType"
      AND NEW."resourceId" IS NOT DISTINCT FROM OLD."resourceId"
      AND NEW."metadata" = OLD."metadata"
      AND NEW."createdAt" = OLD."createdAt"
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Audit log records cannot be modified or deleted' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "AuditLog_guard"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "audit_log_guard"();
