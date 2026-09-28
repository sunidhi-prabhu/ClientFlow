// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as DndKit from "@dnd-kit/core";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard } from "./kanban-board";
import { type TaskCardData } from "./task-card";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// Capture the board's real onDragEnd so drops can be simulated (jsdom has no layout for pointer geometry).
const dnd = vi.hoisted(() => ({ onDragEnd: undefined as undefined | ((event: unknown) => void) }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof DndKit>();
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: (event: unknown) => void; children: ReactNode }) => {
      dnd.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const tasks: TaskCardData[] = [
  {
    id: "t1",
    title: "Design homepage",
    status: "TODO",
    priority: "HIGH",
    dueDate: null,
    assigneeName: "Ada",
  },
  {
    id: "t2",
    title: "Write copy",
    status: "TODO",
    priority: "LOW",
    dueDate: null,
    assigneeName: null,
  },
  {
    id: "t3",
    title: "Review PR",
    status: "REVIEW",
    priority: "URGENT",
    dueDate: null,
    assigneeName: "Grace",
  },
];

function column(name: RegExp) {
  return screen.getByRole("region", { name });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("KanbanBoard", () => {
  const moveAction = vi.fn();
  const createAction = vi.fn();

  beforeEach(() => {
    router.refresh.mockReset();
    moveAction.mockReset();
    createAction.mockReset();
  });
  afterEach(cleanup);

  const renderBoard = (overrides: Partial<Parameters<typeof KanbanBoard>[0]> = {}) =>
    render(
      <KanbanBoard
        organizationSlug="acme"
        projectId="p1"
        tasks={tasks}
        taskBasePath="/o/acme/projects/p1/tasks"
        canEdit
        canCreate
        moveAction={moveAction}
        createAction={createAction}
        {...overrides}
      />,
    );

  it("renders the four columns with their tasks and counts", () => {
    renderBoard();
    expect(
      within(column(/^To do \(2\)/))
        .getAllByRole("article")
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual(["Design homepage", "Write copy"]);
    expect(column(/^In progress \(0\)/)).toHaveTextContent("No tasks");
    expect(
      within(column(/^Review \(1\)/)).getByRole("link", { name: "Review PR" }),
    ).toHaveAttribute("href", "/o/acme/projects/p1/tasks/t3");
    expect(column(/^Done \(0\)/)).toBeInTheDocument();
  });

  it("moves a card optimistically, then refreshes when the server accepts", async () => {
    const pending = deferred<{ ok: true; data: unknown }>();
    moveAction.mockReturnValue(pending.promise);
    renderBoard();

    fireEvent.change(screen.getByRole("combobox", { name: "Move Write copy" }), {
      target: { value: "IN_PROGRESS" },
    });
    // Moved before the server answered.
    expect(
      within(column(/^In progress/)).getByRole("article", { name: "Write copy" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(moveAction).toHaveBeenCalledWith("acme", {
      id: "t2",
      status: "IN_PROGRESS",
      fromStatus: "TODO",
    });

    await act(async () => pending.resolve({ ok: true, data: {} }));
    expect(router.refresh).toHaveBeenCalled();
    expect(
      within(column(/^In progress/)).getByRole("article", { name: "Write copy" }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("rolls the card back and shows the error when the server rejects the move", async () => {
    moveAction.mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "This task was moved by someone else. Refresh to see its current column.",
      },
    });
    renderBoard();

    fireEvent.change(screen.getByRole("combobox", { name: "Move Design homepage" }), {
      target: { value: "DONE" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't move “Design homepage”: This task was moved by someone else.",
    );
    expect(
      within(column(/^To do/)).getByRole("article", { name: "Design homepage" }),
    ).toBeInTheDocument();
    expect(column(/^Done \(0\)/)).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("handles a drag-and-drop onto another column through the same optimistic path", async () => {
    moveAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" },
    });
    renderBoard();

    act(() => dnd.onDragEnd?.({ active: { id: "t3" }, over: { id: "DONE" } }));
    expect(within(column(/^Done/)).getByRole("article", { name: "Review PR" })).toBeInTheDocument();
    expect(moveAction).toHaveBeenCalledWith("acme", {
      id: "t3",
      status: "DONE",
      fromStatus: "REVIEW",
    });

    await screen.findByRole("alert");
    expect(
      within(column(/^Review/)).getByRole("article", { name: "Review PR" }),
    ).toBeInTheDocument();
  });

  it("ignores drops outside a column and onto the same column", () => {
    renderBoard();
    act(() => dnd.onDragEnd?.({ active: { id: "t1" }, over: null }));
    act(() => dnd.onDragEnd?.({ active: { id: "t1" }, over: { id: "TODO" } }));
    act(() => dnd.onDragEnd?.({ active: { id: "t1" }, over: { id: "NOT_A_COLUMN" } }));
    expect(moveAction).not.toHaveBeenCalled();
  });

  it("adopts fresh server data after a refresh", () => {
    const { rerender } = renderBoard();
    rerender(
      <KanbanBoard
        organizationSlug="acme"
        projectId="p1"
        tasks={[{ ...tasks[0], status: "DONE" }]}
        taskBasePath="/o/acme/projects/p1/tasks"
        canEdit
        canCreate
        moveAction={moveAction}
        createAction={createAction}
      />,
    );
    expect(
      within(column(/^Done \(1\)/)).getByRole("article", { name: "Design homepage" }),
    ).toBeInTheDocument();
    expect(column(/^To do \(0\)/)).toBeInTheDocument();
  });

  it("quick-adds a task to a column", async () => {
    createAction.mockResolvedValue({ ok: true, data: { id: "t9", status: "REVIEW" } });
    renderBoard();
    const input = screen.getByRole("textbox", { name: "New task in Review" });
    fireEvent.change(input, { target: { value: "  QA pass " } });
    fireEvent.click(screen.getByRole("button", { name: "Add task to Review" }));

    await waitFor(() =>
      expect(createAction).toHaveBeenCalledWith("acme", {
        projectId: "p1",
        title: "QA pass",
        status: "REVIEW",
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps the typed title and shows the error when creating fails", async () => {
    createAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "Restore this project before changing its tasks" },
    });
    renderBoard();
    const input = screen.getByRole("textbox", { name: "New task in To do" });
    fireEvent.change(input, { target: { value: "Blocked" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restore this project before changing its tasks",
    );
    expect(input).toHaveValue("Blocked");
  });

  it("is read-only without edit/create permission (no drag handles, move selects or quick-add)", () => {
    renderBoard({ canEdit: false, canCreate: false });
    expect(screen.queryByRole("button", { name: /^Drag / })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Move / })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^New task/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Design homepage" })).toBeInTheDocument();
  });
});
