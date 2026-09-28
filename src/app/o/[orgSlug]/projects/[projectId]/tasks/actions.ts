"use server";

import { redirect } from "next/navigation";

import {
  assignTaskInput,
  createTaskInput,
  moveTaskInput,
  setTaskPriorityInput,
  taskIdInput,
  updateTaskInput,
} from "@/lib/validation/task";
import { tenantAction } from "@/server/protected";
import {
  assignTask,
  createTask,
  deleteTask,
  moveTask,
  setTaskPriority,
  updateTask,
} from "@/server/tasks/service";

/*
 * Task Server Actions: the standard pipeline (session → tenant context →
 * permission → validation) around a service call. The organization slug only
 * selects an organization the caller belongs to; a `projectId` in the input
 * (create only) is verified against that organization, and for existing tasks
 * the project is always taken from the task.
 *
 * Permissions: create → task:create; edit, move, assign, priority →
 * task:update; delete → task:delete.
 */

export const createTaskAction = tenantAction(
  { permission: "task:create", input: createTaskInput },
  async ({ ctx, db, input: { projectId, ...fields } }) => {
    const task = await createTask({ ctx, db }, projectId, fields);
    return { id: task.id, status: task.status };
  },
);

export const updateTaskAction = tenantAction(
  { permission: "task:update", input: updateTaskInput },
  async ({ ctx, db, input: { id, ...fields } }) => {
    const task = await updateTask({ ctx, db }, id, fields);
    return { id: task.id };
  },
);

export const moveTaskAction = tenantAction(
  { permission: "task:update", input: moveTaskInput },
  async ({ ctx, db, input }) => {
    const task = await moveTask({ ctx, db }, input.id, input.status, input.fromStatus);
    return { id: task.id, status: task.status };
  },
);

export const assignTaskAction = tenantAction(
  { permission: "task:update", input: assignTaskInput },
  async ({ ctx, db, input }) => {
    const task = await assignTask({ ctx, db }, input.id, input.assigneeUserId);
    return { id: task.id, assigneeUserId: task.assigneeUserId };
  },
);

export const setTaskPriorityAction = tenantAction(
  { permission: "task:update", input: setTaskPriorityInput },
  async ({ ctx, db, input }) => {
    const task = await setTaskPriority({ ctx, db }, input.id, input.priority);
    return { id: task.id, priority: task.priority };
  },
);

const remove = tenantAction(
  { permission: "task:delete", input: taskIdInput },
  async ({ ctx, db, input }) => {
    const { projectId } = await deleteTask({ ctx, db }, input.id);
    return { projectId, organizationSlug: ctx.organization.slug };
  },
);

/** Delete, then return to the project (both taken from the server, not the input). */
export async function deleteTaskAction(organizationSlug: string, input: unknown) {
  const result = await remove(organizationSlug, input);
  if (result.ok) redirect(`/o/${result.data.organizationSlug}/projects/${result.data.projectId}`);
  return result;
}
