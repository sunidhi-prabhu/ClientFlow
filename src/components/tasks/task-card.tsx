"use client";

import { useDraggable } from "@dnd-kit/core";
import { CalendarDays, GripVertical, UserRound } from "lucide-react";
import Link from "next/link";

import { PriorityIndicator } from "@/components/shared/priority-indicator";
import { NativeSelect } from "@/components/ui/native-select";
import { type TaskPriority, type TaskStatus } from "@/generated/prisma/enums";
import { formatCalendarDate } from "@/lib/calendar-date";
import { cn } from "@/lib/utils";

import { TASK_COLUMNS, TASK_STATUS_LABELS, isTaskOverdue } from "./task-labels";

export type TaskCardData = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  assigneeName: string | null;
};

function CardBody({ task, href }: { task: TaskCardData; href: string }) {
  const overdue = isTaskOverdue(task);
  return (
    <>
      <Link href={href} className="block text-sm font-medium break-words hover:underline">
        {task.title}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <PriorityIndicator priority={task.priority} />
        {task.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <CalendarDays className="size-3.5" aria-hidden />
            {formatCalendarDate(task.dueDate)}
            {overdue && <span>(overdue)</span>}
          </span>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <UserRound className="size-3.5" aria-hidden />
        {task.assigneeName ?? "Unassigned"}
      </p>
    </>
  );
}

/**
 * A Kanban card. When the board is editable it can be dragged (pointer or
 * keyboard via the handle) or moved with the "Move to" select, which is the
 * accessible alternative to dragging.
 */
export function TaskCard({
  task,
  href,
  editable,
  pending,
  onMove,
}: {
  task: TaskCardData;
  href: string;
  editable: boolean;
  pending?: boolean;
  onMove?: (taskId: string, status: TaskStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status },
    disabled: !editable,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      aria-label={task.title}
      aria-busy={pending || undefined}
      data-status={task.status}
      className={cn(
        "grid gap-2 rounded-lg bg-card p-3 ring-1 ring-foreground/10",
        isDragging && "z-10 opacity-80 shadow-lg",
        pending && "opacity-70",
      )}
    >
      <div className="flex items-start gap-1.5">
        {editable && (
          <button
            type="button"
            className="-ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            aria-label={`Drag ${task.title}`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        )}
        <div className="grid min-w-0 flex-1 gap-2">
          <CardBody task={task} href={href} />
        </div>
      </div>
      {editable && onMove && (
        <NativeSelect
          aria-label={`Move ${task.title}`}
          value={task.status}
          disabled={pending}
          onChange={(event) => onMove(task.id, event.target.value as TaskStatus)}
          className="h-7 text-xs"
        >
          {TASK_COLUMNS.map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_LABELS[status]}
            </option>
          ))}
        </NativeSelect>
      )}
    </article>
  );
}
