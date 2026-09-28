-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectActivityType" ADD VALUE 'TASK_CREATED';
ALTER TYPE "ProjectActivityType" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "ProjectActivityType" ADD VALUE 'TASK_STATUS_CHANGED';
ALTER TYPE "ProjectActivityType" ADD VALUE 'TASK_PRIORITY_CHANGED';
ALTER TYPE "ProjectActivityType" ADD VALUE 'TASK_ASSIGNMENT_CHANGED';
ALTER TYPE "ProjectActivityType" ADD VALUE 'TASK_DELETED';

-- AlterTable
ALTER TABLE "ProjectActivity" ADD COLUMN     "taskId" TEXT;

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" DATE,
    "assigneeUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_organizationId_projectId_status_idx" ON "Task"("organizationId", "projectId", "status");

-- CreateIndex
CREATE INDEX "Task_organizationId_projectId_assigneeUserId_idx" ON "Task"("organizationId", "projectId", "assigneeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_id_key" ON "Task"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ProjectActivity_organizationId_taskId_createdAt_idx" ON "ProjectActivity"("organizationId", "taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_projectId_fkey" FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_projectId_assigneeUserId_fkey" FOREIGN KEY ("organizationId", "projectId", "assigneeUserId") REFERENCES "ProjectMember"("organizationId", "projectId", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Removing someone from a project (directly, or by removing them from the
-- organization, which cascades to ProjectMember) unassigns their tasks in that
-- project. The composite assignee FK cannot SET NULL without also nulling
-- organizationId/projectId, so it is NO ACTION (checked at the end of the
-- statement) and this BEFORE DELETE trigger clears the assignee first.
-- Timestamps are stored as UTC wall-clock time (Prisma convention).
CREATE FUNCTION "unassign_tasks_of_removed_project_member"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Task"
  SET "assigneeUserId" = NULL,
      "updatedAt" = (now() AT TIME ZONE 'UTC')
  WHERE "organizationId" = OLD."organizationId"
    AND "projectId" = OLD."projectId"
    AND "assigneeUserId" = OLD."userId";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "ProjectMember_unassign_tasks"
BEFORE DELETE ON "ProjectMember"
FOR EACH ROW
EXECUTE FUNCTION "unassign_tasks_of_removed_project_member"();
