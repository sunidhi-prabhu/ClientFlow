import { type TaskStatus } from "@/generated/prisma/enums";
import { isBeforeToday } from "@/lib/calendar-date";

/** Kanban column order. */
export const TASK_COLUMNS: TaskStatus[] = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  REVIEW: "Review",
  DONE: "Done",
};

/** Past its due date (UTC) and not done. */
export function isTaskOverdue(
  task: { dueDate: Date | null; status: TaskStatus },
  now: Date = new Date(),
): boolean {
  return Boolean(task.dueDate) && task.status !== "DONE" && isBeforeToday(task.dueDate!, now);
}
