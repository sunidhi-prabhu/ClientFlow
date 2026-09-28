import { type ProjectPriority, type ProjectStatus } from "@/generated/prisma/enums";
import { formatCalendarDate, isBeforeToday, toDateInputValue } from "@/lib/calendar-date";

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
export const formatProjectDate = formatCalendarDate;
export { toDateInputValue };

/** Due before today (UTC) and not finished. */
export function isOverdue(
  project: { dueDate: Date | null; status: ProjectStatus },
  now: Date = new Date(),
): boolean {
  if (!project.dueDate || project.status === "COMPLETED" || project.status === "ARCHIVED") {
    return false;
  }
  return isBeforeToday(project.dueDate, now);
}
