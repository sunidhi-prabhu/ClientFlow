"use server";

import { redirect } from "next/navigation";

import {
  createProjectInput,
  projectIdInput,
  projectMemberInput,
  setProjectProgressInput,
  setProjectStatusInput,
  updateProjectInput,
} from "@/lib/validation/project";
import {
  addProjectMember,
  archiveProject,
  createProject,
  removeProjectMember,
  restoreProject,
  setProjectProgress,
  setProjectStatus,
  updateProject,
} from "@/server/projects/service";
import { tenantAction } from "@/server/protected";

/*
 * Project Server Actions: the standard pipeline (session → tenant context →
 * permission → validation) around a service call. The first argument is the
 * organization slug from the URL, which only selects an organization the
 * caller must already belong to.
 *
 * Permissions: create → project:create; edits, status, progress and members →
 * project:update; archive/restore → project:delete.
 */

const create = tenantAction(
  { permission: "project:create", input: createProjectInput },
  async ({ ctx, db, input }) => {
    const project = await createProject({ ctx, db }, input);
    return { id: project.id, organizationSlug: ctx.organization.slug };
  },
);

export async function createProjectAction(organizationSlug: string, input: unknown) {
  const result = await create(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/projects/${result.data.id}`);
  return result;
}

const update = tenantAction(
  { permission: "project:update", input: updateProjectInput },
  async ({ ctx, db, input: { id, ...fields } }) => {
    const project = await updateProject({ ctx, db }, id, fields);
    return { id: project.id, organizationSlug: ctx.organization.slug };
  },
);

export async function updateProjectAction(organizationSlug: string, input: unknown) {
  const result = await update(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/projects/${result.data.id}`);
  return result;
}

export const setProjectStatusAction = tenantAction(
  { permission: "project:update", input: setProjectStatusInput },
  async ({ ctx, db, input }) => {
    const project = await setProjectStatus({ ctx, db }, input.id, input.status);
    return { id: project.id, status: project.status };
  },
);

export const setProjectProgressAction = tenantAction(
  { permission: "project:update", input: setProjectProgressInput },
  async ({ ctx, db, input }) => {
    const project = await setProjectProgress({ ctx, db }, input.id, input.progress);
    return { id: project.id, progress: project.progress };
  },
);

export const archiveProjectAction = tenantAction(
  { permission: "project:delete", input: projectIdInput },
  async ({ ctx, db, input }) => {
    const project = await archiveProject({ ctx, db }, input.id);
    return { id: project.id, status: project.status };
  },
);

export const restoreProjectAction = tenantAction(
  { permission: "project:delete", input: projectIdInput },
  async ({ ctx, db, input }) => {
    const project = await restoreProject({ ctx, db }, input.id);
    return { id: project.id, status: project.status };
  },
);

export const addProjectMemberAction = tenantAction(
  { permission: "project:update", input: projectMemberInput },
  async ({ ctx, db, input }) => {
    await addProjectMember({ ctx, db }, input.projectId, input.userId);
    return { projectId: input.projectId, userId: input.userId };
  },
);

export const removeProjectMemberAction = tenantAction(
  { permission: "project:update", input: projectMemberInput },
  async ({ ctx, db, input }) => {
    await removeProjectMember({ ctx, db }, input.projectId, input.userId);
    return { projectId: input.projectId, userId: input.userId };
  },
);
