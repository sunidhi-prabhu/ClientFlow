import { ArrowLeft, CalendarDays, Pencil } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AccessDenied } from "@/components/layout/access-denied";
import { ProjectActivityList } from "@/components/projects/project-activity-list";
import { formatProjectDate, isOverdue } from "@/components/projects/project-labels";
import { ProjectMembers } from "@/components/projects/project-members";
import { ProjectPriorityIndicator } from "@/components/projects/project-priority";
import { ProjectQuickControls } from "@/components/projects/project-quick-controls";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskBoardToolbar } from "@/components/tasks/task-board-toolbar";
import { ArchiveButton } from "@/components/shared/archive-button";
import { ProgressBar } from "@/components/shared/progress-bar";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotFoundError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { getProject, listAddableMembers, listProjectActivity } from "@/server/projects/service";
import { parseTaskBoardQuery } from "@/lib/validation/task";
import { tenantPage } from "@/server/protected";
import { listProjectTasks } from "@/server/tasks/service";

import {
  addProjectMemberAction,
  archiveProjectAction,
  removeProjectMemberAction,
  restoreProjectAction,
  setProjectProgressAction,
  setProjectStatusAction,
} from "../actions";
import { createTaskAction, moveTaskAction } from "./tasks/actions";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectDetailsPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/projects/[projectId]">) {
  const { orgSlug, projectId } = await params;
  const access = await tenantPage(orgSlug, "project:read");
  if (!access.allowed)
    return <AccessDenied message="Ask an owner or admin for access to projects." />;
  const { ctx, db } = access;

  // Unknown ids and other organizations' projects both render the 404 page.
  const project = await getProject(db, projectId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const slug = ctx.organization.slug;
  const archived = project.status === "ARCHIVED";
  const canUpdate = hasPermission(ctx.role, "project:update") && !archived;
  const canArchive = hasPermission(ctx.role, "project:delete");
  const canSeeTasks = hasPermission(ctx.role, "task:read");
  const boardQuery = parseTaskBoardQuery(await searchParams);
  const [activity, addable, board] = await Promise.all([
    listProjectActivity(db, project.id),
    canUpdate ? listAddableMembers(db, project.id) : Promise.resolve([]),
    canSeeTasks ? listProjectTasks(db, project.id, boardQuery) : Promise.resolve(null),
  ]);
  const projectMembers = project.members.map((member) => ({
    userId: member.userId,
    name: member.membership.user.name,
  }));
  const overdue = isOverdue(project);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href={`/o/${slug}/projects`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight break-words">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {project.client ? (
                <Link href={`/o/${slug}/clients/${project.client.id}`} className="hover:underline">
                  {project.client.name}
                </Link>
              ) : (
                "No client"
              )}
            </p>
          </div>
          <div className="flex items-start gap-2">
            {canUpdate && (
              <Link
                href={`/o/${slug}/projects/${project.id}/edit`}
                className={buttonVariants({ variant: "outline" })}
              >
                <Pencil aria-hidden />
                Edit
              </Link>
            )}
            {canArchive && (
              <ArchiveButton
                organizationSlug={slug}
                id={project.id}
                archived={archived}
                archiveAction={archiveProjectAction}
                restoreAction={restoreProjectAction}
              />
            )}
          </div>
        </div>
        {archived && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            This project was archived
            {project.archivedAt && ` on ${formatProjectDate(project.archivedAt)}`}. Restore it to
            make changes.
          </p>
        )}
      </div>

      {board && (
        <section aria-labelledby="tasks-heading" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="tasks-heading" className="text-lg font-semibold tracking-tight">
              Tasks
            </h2>
            {archived && <p className="text-sm text-muted-foreground">Read-only while archived.</p>}
          </div>
          <TaskBoardToolbar
            q={boardQuery.q ?? ""}
            assignee={boardQuery.assignee ?? ""}
            priority={boardQuery.priority ?? ""}
            members={projectMembers}
          />
          {board.truncated && (
            <p className="text-sm text-muted-foreground">
              Showing the first {board.tasks.length} tasks. Use the filters to narrow the board.
            </p>
          )}
          <KanbanBoard
            organizationSlug={slug}
            projectId={project.id}
            taskBasePath={`/o/${slug}/projects/${project.id}/tasks`}
            tasks={board.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              priority: task.priority,
              dueDate: task.dueDate,
              assigneeName: task.assignee?.membership.user.name ?? null,
            }))}
            canEdit={hasPermission(ctx.role, "task:update") && !archived}
            canCreate={hasPermission(ctx.role, "task:create") && !archived}
            moveAction={moveTaskAction}
            createAction={createTaskAction}
          />
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              {project.description ? (
                <p className="text-sm break-words whitespace-pre-line">{project.description}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No description yet.</p>
              )}
              <dl className="grid gap-4 text-sm sm:grid-cols-3">
                <div className="grid gap-1">
                  <dt className="text-muted-foreground">Priority</dt>
                  <dd>
                    <ProjectPriorityIndicator priority={project.priority} />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden /> Start
                  </dt>
                  <dd>{formatProjectDate(project.startDate)}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden /> Due
                  </dt>
                  <dd className={overdue ? "font-medium text-destructive" : undefined}>
                    {formatProjectDate(project.dueDate)}
                    {overdue && " (overdue)"}
                  </dd>
                </div>
                <div className="grid gap-1 sm:col-span-3">
                  <dt className="text-muted-foreground">Progress</dt>
                  <dd>
                    <ProgressBar value={project.progress} label="Project progress" />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectMembers
                organizationSlug={slug}
                projectId={project.id}
                members={project.members.map((member) => ({
                  userId: member.userId,
                  name: member.membership.user.name,
                  email: member.membership.user.email,
                  role: member.membership.role,
                }))}
                addable={addable}
                canManage={canUpdate}
                addAction={addProjectMemberAction}
                removeAction={removeProjectMemberAction}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          {canUpdate && project.status !== "ARCHIVED" && (
            <Card>
              <CardHeader>
                <CardTitle>Status &amp; progress</CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectQuickControls
                  organizationSlug={slug}
                  projectId={project.id}
                  status={project.status}
                  progress={project.progress}
                  statusAction={setProjectStatusAction}
                  progressAction={setProjectProgressAction}
                />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectActivityList items={activity} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
