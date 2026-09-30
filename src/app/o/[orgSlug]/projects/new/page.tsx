import { ArrowLeft } from "lucide-react";
import { type Metadata } from "next";
import Link from "next/link";

import { PlanLimitNotice } from "@/components/billing/plan-limit-notice";
import { AccessDenied } from "@/components/layout/access-denied";
import { ProjectForm } from "@/components/projects/project-form";
import { hasPermission } from "@/lib/permissions";
import { getUsage } from "@/server/billing/limits";
import { listAssignableClients } from "@/server/projects/service";
import { tenantPage } from "@/server/protected";

import { createProjectAction } from "../actions";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({
  params,
  searchParams,
}: PageProps<"/o/[orgSlug]/projects/new">) {
  const { orgSlug } = await params;
  const access = await tenantPage(orgSlug, "project:create");
  if (!access.allowed)
    return <AccessDenied message="Your role can view projects but not create them." />;

  const slug = access.ctx.organization.slug;
  const [clients, usage] = await Promise.all([
    listAssignableClients(access.db),
    getUsage(access.db, "projects"),
  ]);
  const canManageBilling = hasPermission(access.ctx.role, "billing:manage");
  // Preselect a client when coming from its page (?clientId=…); only if it is one of ours.
  const { clientId } = await searchParams;
  const preselected = clients.find((client) => client.id === clientId)?.id ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={`/o/${slug}/projects`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      </div>
      <PlanLimitNotice
        resource="projects"
        usage={usage}
        billingPath={canManageBilling ? `/o/${slug}/billing` : undefined}
      />
      <ProjectForm
        organizationSlug={slug}
        action={createProjectAction}
        clients={clients}
        submitLabel="Create project"
        initial={
          preselected
            ? {
                name: "",
                description: null,
                clientId: preselected,
                status: "PLANNING",
                priority: "MEDIUM",
                startDate: "",
                dueDate: "",
                progress: 0,
              }
            : undefined
        }
      />
    </div>
  );
}
