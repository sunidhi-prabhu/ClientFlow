"use client";

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type TaskStatus } from "@/generated/prisma/enums";
import { type ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

import { TaskCard, type TaskCardData } from "./task-card";
import { TASK_COLUMNS, TASK_STATUS_LABELS } from "./task-labels";

type MoveAction = (
  organizationSlug: string,
  input: { id: string; status: TaskStatus; fromStatus: TaskStatus },
) => Promise<ActionResult<unknown>>;
type CreateAction = (
  organizationSlug: string,
  input: { projectId: string; title: string; status: TaskStatus },
) => Promise<ActionResult<unknown>>;

function QuickAdd({
  status,
  onCreate,
}: {
  status: TaskStatus;
  onCreate: (title: string, status: TaskStatus) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const value = title.trim();
        if (!value) return;
        startTransition(async () => {
          if (await onCreate(value, status)) setTitle("");
        });
      }}
    >
      <Input
        aria-label={`New task in ${TASK_STATUS_LABELS[status]}`}
        placeholder="Add a task…"
        value={title}
        maxLength={200}
        disabled={pending}
        onChange={(event) => setTitle(event.target.value)}
        className="h-7 text-xs"
      />
      <Button
        type="submit"
        size="icon-sm"
        variant="ghost"
        disabled={pending || !title.trim()}
        aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`}
      >
        <Plus aria-hidden />
      </Button>
    </form>
  );
}

function Column({
  status,
  tasks,
  children,
}: {
  status: TaskStatus;
  tasks: TaskCardData[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${TASK_STATUS_LABELS[status]} (${tasks.length})`}
      data-column={status}
      className={cn(
        "flex min-h-40 w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2 md:w-auto md:shrink",
        isOver && "ring-2 ring-primary/40",
      )}
    >
      <h3 className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
        {TASK_STATUS_LABELS[status]}
        <span className="rounded-full bg-background px-1.5 tabular-nums">{tasks.length}</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * Kanban board. Moves are optimistic: the card changes column immediately
 * and the server is asked to move it (a compare-and-set on the column it was
 * in). If the server rejects the move, the card goes back and the error is
 * shown. The server remains the authority for permissions and validity.
 */
export function KanbanBoard({
  organizationSlug,
  projectId,
  tasks: serverTasks,
  taskBasePath,
  canEdit,
  canCreate,
  moveAction,
  createAction,
}: {
  organizationSlug: string;
  projectId: string;
  tasks: TaskCardData[];
  /** e.g. `/o/acme/projects/p1/tasks` (a string: this is a Client Component). */
  taskBasePath: string;
  canEdit: boolean;
  canCreate: boolean;
  moveAction: MoveAction;
  createAction: CreateAction;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(serverTasks);
  const [lastServerTasks, setLastServerTasks] = useState(serverTasks);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Adopt fresh server data (after router.refresh()).
  if (serverTasks !== lastServerTasks) {
    setLastServerTasks(serverTasks);
    setTasks(serverTasks);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function setPending(id: string, on: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function move(taskId: string, status: TaskStatus) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status === status || pendingIds.has(taskId)) return;
    const fromStatus = task.status;

    setError(null);
    setTasks((current) => current.map((item) => (item.id === taskId ? { ...item, status } : item)));
    setPending(taskId, true);
    const result = await moveAction(organizationSlug, { id: taskId, status, fromStatus });
    setPending(taskId, false);

    if (result.ok) {
      router.refresh();
    } else {
      // Roll back to where the card was.
      setTasks((current) =>
        current.map((item) => (item.id === taskId ? { ...item, status: fromStatus } : item)),
      );
      setError(`Couldn't move “${task.title}”: ${result.error.message}`);
    }
  }

  async function create(title: string, status: TaskStatus) {
    setError(null);
    const result = await createAction(organizationSlug, { projectId, title, status });
    if (result.ok) {
      router.refresh();
      return true;
    }
    setError(`Couldn't add the task: ${result.error.message}`);
    return false;
  }

  function onDragEnd(event: DragEndEvent) {
    const status = event.over?.id as TaskStatus | undefined;
    if (status && TASK_COLUMNS.includes(status)) void move(String(event.active.id), status);
  }

  return (
    <div className="grid gap-3">
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 md:grid md:grid-cols-4 md:overflow-visible">
          {TASK_COLUMNS.map((status) => {
            const columnTasks = tasks.filter((task) => task.status === status);
            return (
              <Column key={status} status={status} tasks={columnTasks}>
                {canCreate && <QuickAdd status={status} onCreate={create} />}
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    href={`${taskBasePath}/${task.id}`}
                    editable={canEdit}
                    pending={pendingIds.has(task.id)}
                    onMove={(id, next) => void move(id, next)}
                  />
                ))}
                {columnTasks.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">No tasks</p>
                )}
              </Column>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}
