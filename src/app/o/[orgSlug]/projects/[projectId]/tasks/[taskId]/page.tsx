import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/layout/access-denied";
import { ProjectActivityList } from "@/components/projects/project-activity-list";
import { PriorityIndicator } from "@/components/shared/priority-indicator";
import { TaskDeleteButton } from "@/components/tasks/task-delete-button";
import { TaskForm } from "@/components/tasks/task-form";
import { TASK_STATUS_LABELS, isTaskOverdue } from "@/components/tasks/task-labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalendarDate, toDateInputValue } from "@/lib/calendar-date";
import { NotFoundError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { getProject } from "@/server/projects/service";
import { tenantPage } from "@/server/protected";
import { getTask, listTaskActivity } from "@/server/tasks/service";

import { deleteTaskAction, updateTaskAction } from "../actions";

export const metadata: Metadata = { title: "Task" };

function orNotFound(error: unknown): never {
  if (error instanceof NotFoundError) notFound();
  throw error;
}

export default async function TaskPage({
  params,
}: PageProps<"/o/[orgSlug]/projects/[projectId]/tasks/[taskId]">) {
  const { orgSlug, projectId, taskId } = await params;
  const access = await tenantPage(orgSlug, "task:read");
  if (!access.allowed) return <AccessDenied message="Ask an owner or admin for access to tasks." />;
  const { ctx, db } = access;

  const task = await getTask(db, taskId).catch(orNotFound);
  // The URL must name the task's own project.
  if (task.projectId !== projectId) notFound();
  const [project, activity] = await Promise.all([
    getProject(db, task.projectId).catch(orNotFound),
    listTaskActivity(db, task.id),
  ]);

  const slug = ctx.organization.slug;
  const projectPath = `/o/${slug}/projects/${project.id}`;
  const archived = project.status === "ARCHIVED";
  const canEdit = hasPermission(ctx.role, "task:update") && !archived;
  const canDelete = hasPermission(ctx.role, "task:delete") && !archived;
  const members = project.members.map((member) => ({
    userId: member.userId,
    name: member.membership.user.name,
  }));
  const overdue = isTaskOverdue(task);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={projectPath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {project.name}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{task.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="secondary">{TASK_STATUS_LABELS[task.status]}</Badge>
              <PriorityIndicator priority={task.priority} />
              <span className={overdue ? "font-medium text-destructive" : undefined}>
                Due {formatCalendarDate(task.dueDate)}
                {overdue && " (overdue)"}
              </span>
              <span>{task.assignee?.membership.user.name ?? "Unassigned"}</span>
            </div>
          </div>
          {canDelete && (
            <TaskDeleteButton organizationSlug={slug} taskId={task.id} action={deleteTaskAction} />
          )}
        </div>
        {archived && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            This task&apos;s project is archived. Restore the project to make changes.
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="content-start lg:col-span-2">
          <CardHeader>
            <CardTitle>{canEdit ? "Edit task" : "Details"}</CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <TaskForm
                organizationSlug={slug}
                action={updateTaskAction}
                members={members}
                initial={{
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  status: task.status,
                  priority: task.priority,
                  dueDate: toDateInputValue(task.dueDate),
                  assigneeUserId: task.assigneeUserId,
                }}
              />
            ) : task.description ? (
              <p className="text-sm break-words whitespace-pre-line">{task.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </CardContent>
        </Card>
        <Card className="content-start">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectActivityList items={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
