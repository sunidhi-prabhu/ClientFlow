import { z } from "zod";

import { calendarDateField } from "@/lib/validation/dates";

/*
 * Task input and query schemas, shared by the server (authoritative) and the
 * forms. Unknown keys (organizationId, …) are stripped. The project always
 * comes from the task (for updates) or is verified against the organization
 * (for creation); the assignee is verified to be a member of the project.
 */

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const id = z.string().trim().min(1).max(64);

/** A project member's user id, or "" / missing for unassigned. */
const assigneeField = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((value) => (value ? value : null));

const taskFieldsObject = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200, "Title must be at most 200 characters"),
  description: z
    .string()
    .trim()
    .max(10_000, "Description must be at most 10000 characters")
    .optional()
    .transform((value) => (value ? value : null)),
  status: z.enum(TASK_STATUSES, "Choose a valid status").default("TODO"),
  priority: z.enum(TASK_PRIORITIES, "Choose a valid priority").default("MEDIUM"),
  dueDate: calendarDateField("Due date"),
  assigneeUserId: assigneeField,
});

export type TaskFields = z.infer<typeof taskFieldsObject>;

export const createTaskInput = taskFieldsObject.extend({ projectId: id });

/** Full update: the edit form always sends every field. */
export const updateTaskInput = taskFieldsObject.extend({ id });

export const taskIdInput = z.object({ id });

/**
 * Move a card to another column. `fromStatus`, when given, makes the move a
 * compare-and-set: it fails (409) if someone else moved the task meanwhile.
 */
export const moveTaskInput = z.object({
  id,
  status: z.enum(TASK_STATUSES, "Choose a valid status"),
  fromStatus: z.enum(TASK_STATUSES).optional(),
});

export const assignTaskInput = z.object({ id, assigneeUserId: assigneeField });

export const setTaskPriorityInput = z.object({
  id,
  priority: z.enum(TASK_PRIORITIES, "Choose a valid priority"),
});

/** Board filter value for tasks without an assignee. */
export const UNASSIGNED_FILTER = "unassigned";

/** Board filters from URL search params; invalid values fall back to "no filter". */
export const taskBoardQuery = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  assignee: z
    .string()
    .trim()
    .max(64)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  priority: z.enum(TASK_PRIORITIES).optional().catch(undefined),
});

export type TaskBoardQuery = z.infer<typeof taskBoardQuery>;

export function parseTaskBoardQuery(
  searchParams: Record<string, string | string[] | undefined>,
): TaskBoardQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return taskBoardQuery.parse({
    q: first(searchParams.q),
    assignee: first(searchParams.assignee),
    priority: first(searchParams.priority),
  });
}
