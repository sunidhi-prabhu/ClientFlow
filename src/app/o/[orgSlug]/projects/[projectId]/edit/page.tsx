import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AccessDenied } from "@/components/layout/access-denied";
import { toDateInputValue } from "@/components/projects/project-labels";
import { ProjectForm } from "@/components/projects/project-form";
import { NotFoundError } from "@/lib/errors";
import { getProject, listAssignableClients } from "@/server/projects/service";
import { tenantPage } from "@/server/protected";

import { updateProjectAction } from "../../actions";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditProjectPage({
  params,
}: PageProps<"/o/[orgSlug]/projects/[projectId]/edit">) {
  const { orgSlug, projectId } = await params;
  const access = await tenantPage(orgSlug, "project:update");
  if (!access.allowed)
    return <AccessDenied message="Your role can view projects but not edit them." />;

  const project = await getProject(access.db, projectId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const slug = access.ctx.organization.slug;
  const detailsPath = `/o/${slug}/projects/${project.id}`;
  // Archived projects are read-only until restored.
  if (project.status === "ARCHIVED") redirect(detailsPath);
  const clients = await listAssignableClients(access.db, project.clientId);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={detailsPath}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {project.name}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Edit project</h1>
      </div>
      <ProjectForm
        organizationSlug={slug}
        action={updateProjectAction}
        clients={clients}
        submitLabel="Save changes"
        initial={{
          id: project.id,
          name: project.name,
          description: project.description,
          clientId: project.clientId,
          status: project.status,
          priority: project.priority,
          startDate: toDateInputValue(project.startDate),
          dueDate: toDateInputValue(project.dueDate),
          progress: project.progress,
        }}
      />
    </div>
  );
}
