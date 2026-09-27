import { type ProjectPriority, type ProjectStatus } from "@/generated/prisma/enums";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** Calendar dates are stored as UTC midnight; format them in UTC so they never shift a day. */
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

export function formatProjectDate(date: Date | null): string {
  return date ? dateFormat.format(date) : "—";
}

/** `YYYY-MM-DD` for <input type="date">. */
export function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** Due before today (UTC) and not finished. */
export function isOverdue(
  project: { dueDate: Date | null; status: ProjectStatus },
  now: Date = new Date(),
): boolean {
  if (!project.dueDate || project.status === "COMPLETED" || project.status === "ARCHIVED") {
    return false;
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return project.dueDate.getTime() < today;
}
