import { z } from "zod";

import { calendarDateField } from "@/lib/validation/dates";

/*
 * Project input and query schemas, shared by the server (authoritative) and
 * the forms. Unknown keys such as `organizationId` are stripped: the
 * organization always comes from the tenant context.
 */

/** Statuses a user can choose; ARCHIVED is set only by archiving. */
export const EDITABLE_PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export const PROJECT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const dateField = calendarDateField;

const projectFieldsObject = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120, "Name must be at most 120 characters"),
  description: z
    .string()
    .trim()
    .max(5000, "Description must be at most 5000 characters")
    .optional()
    .transform((value) => (value ? value : null)),
  /** A client of the same organization (verified on the server), or none. */
  clientId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value ? value : null)),
  status: z.enum(EDITABLE_PROJECT_STATUSES).default("PLANNING"),
  priority: z.enum(PROJECT_PRIORITIES).default("MEDIUM"),
  startDate: dateField("Start date"),
  dueDate: dateField("Due date"),
  progress: z.coerce
    .number("Progress must be a number")
    .int("Progress must be a whole number")
    .min(0, "Progress must be between 0 and 100")
    .max(100, "Progress must be between 0 and 100")
    .default(0),
});

type DatedFields = { startDate: Date | null; dueDate: Date | null };

function datesInOrder(fields: DatedFields, context: z.RefinementCtx) {
  if (fields.startDate && fields.dueDate && fields.dueDate < fields.startDate) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Due date cannot be before the start date",
    });
  }
}

export const createProjectInput = projectFieldsObject.superRefine(datesInOrder);

/** Full update: the edit form always sends every field. */
export const updateProjectInput = projectFieldsObject
  .extend({ id: z.string().min(1) })
  .superRefine(datesInOrder);

export type ProjectFields = z.infer<typeof createProjectInput>;

export const projectIdInput = z.object({ id: z.string().min(1) });

export const setProjectStatusInput = z.object({
  id: z.string().min(1),
  status: z.enum(EDITABLE_PROJECT_STATUSES),
});

export const setProjectProgressInput = z.object({
  id: z.string().min(1),
  progress: projectFieldsObject.shape.progress.unwrap(),
});

export const projectMemberInput = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1, "Choose a person"),
});

export const PROJECT_STATUS_FILTERS = [
  "current",
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
  "all",
] as const;
export type ProjectStatusFilter = (typeof PROJECT_STATUS_FILTERS)[number];

export const PROJECT_SORTS = ["name", "due", "priority", "updated", "created"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** Client filter value meaning "projects without a client". */
export const NO_CLIENT_FILTER = "none";

export const DEFAULT_PROJECT_PAGE_SIZE = 20;

/**
 * List query from URL search params. Invalid values fall back to defaults so
 * a hand-edited URL still renders. `status=current` (the default) means
 * everything except ARCHIVED.
 */
export const listProjectsQuery = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  status: z.enum(PROJECT_STATUS_FILTERS).catch("current").default("current"),
  clientId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  sort: z.enum(PROJECT_SORTS).catch("name").default("name"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .catch(DEFAULT_PROJECT_PAGE_SIZE)
    .default(DEFAULT_PROJECT_PAGE_SIZE),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuery>;

export function parseListProjectsQuery(
  searchParams: Record<string, string | string[] | undefined>,
): ListProjectsQuery {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return listProjectsQuery.parse({
    q: first(searchParams.q),
    status: first(searchParams.status),
    clientId: first(searchParams.clientId),
    sort: first(searchParams.sort),
    page: first(searchParams.page),
    pageSize: first(searchParams.pageSize),
  });
}
