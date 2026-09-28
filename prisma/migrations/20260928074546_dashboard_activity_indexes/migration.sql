-- CreateIndex
CREATE INDEX "ClientActivity_organizationId_createdAt_idx" ON "ClientActivity"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_createdAt_idx" ON "ProjectActivity"("organizationId", "createdAt");
