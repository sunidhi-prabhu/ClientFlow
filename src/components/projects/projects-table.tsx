import { Users } from "lucide-react";
import Link from "next/link";

import { ProgressBar } from "@/components/shared/progress-bar";
import { type ProjectPriority, type ProjectStatus } from "@/generated/prisma/enums";

import { formatProjectDate, isOverdue } from "./project-labels";
import { ProjectPriorityIndicator } from "./project-priority";
import { ProjectStatusBadge } from "./project-status-badge";

export type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  progress: number;
  startDate: Date | null;
  dueDate: Date | null;
  client: { id: string; name: string } | null;
  _count: { members: number };
};

function DueDate({ project }: { project: ProjectRow }) {
  const overdue = isOverdue(project);
  return (
    <span className={overdue ? "font-medium text-destructive" : undefined}>
      {formatProjectDate(project.dueDate)}
      {overdue && <span className="ml-1 text-xs">(overdue)</span>}
    </span>
  );
}

/** Table on larger screens, stacked cards on phones. Each row opens the project. */
export function ProjectsTable({
  projects,
  basePath,
}: {
  projects: ProjectRow[];
  basePath: string;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl ring-1 ring-foreground/10 lg:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Project
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Priority
              </th>
              <th scope="col" className="w-40 px-4 py-2.5 font-medium">
                Progress
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Due
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Members</span>
                <Users className="ml-auto size-4" aria-hidden />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {projects.map((project) => (
              <tr key={project.id} className="group relative hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link
                    href={`${basePath}/${project.id}`}
                    className="font-medium group-focus-within:underline after:absolute after:inset-0 focus-visible:outline-none"
                  >
                    {project.name}
                  </Link>
                  <p className="text-muted-foreground">{project.client?.name ?? "No client"}</p>
                </td>
                <td className="px-4 py-3">
                  <ProjectStatusBadge status={project.status} />
                </td>
                <td className="px-4 py-3">
                  <ProjectPriorityIndicator priority={project.priority} />
                </td>
                <td className="px-4 py-3">
                  <ProgressBar value={project.progress} label={`${project.name} progress`} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                  <DueDate project={project} />
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                  <span className="sr-only">Members: </span>
                  {project._count.members}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 lg:hidden">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`${basePath}/${project.id}`}
              className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground/10 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{project.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {project.client?.name ?? "No client"}
                  </p>
                </div>
                <ProjectStatusBadge status={project.status} />
              </div>
              <ProgressBar value={project.progress} label={`${project.name} progress`} />
              <div className="flex items-center justify-between gap-2 text-sm">
                <ProjectPriorityIndicator priority={project.priority} />
                <span className="text-muted-foreground">
                  Due <DueDate project={project} />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
