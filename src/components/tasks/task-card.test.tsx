// @vitest-environment jsdom
import { DndContext } from "@dnd-kit/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TaskCard, type TaskCardData } from "./task-card";
import { isTaskOverdue } from "./task-labels";

afterEach(cleanup);

const base: TaskCardData = {
  id: "t1",
  title: "Design homepage",
  status: "IN_PROGRESS",
  priority: "URGENT",
  dueDate: new Date("2000-01-10T00:00:00Z"),
  assigneeName: "Ada",
};

const renderCard = (task: TaskCardData, editable = true) =>
  render(
    <DndContext>
      <TaskCard
        task={task}
        href="/o/acme/projects/p1/tasks/t1"
        editable={editable}
        onMove={() => {}}
      />
    </DndContext>,
  );

describe("TaskCard", () => {
  it("shows title link, assignee, priority, due date and overdue", () => {
    renderCard(base);
    const card = screen.getByRole("article", { name: "Design homepage" });
    expect(screen.getByRole("link", { name: "Design homepage" })).toHaveAttribute(
      "href",
      "/o/acme/projects/p1/tasks/t1",
    );
    expect(card).toHaveTextContent("Ada");
    expect(card).toHaveTextContent("Urgent");
    expect(card).toHaveTextContent("Jan 10, 2000");
    expect(card).toHaveTextContent("(overdue)");
    expect(screen.getByRole("button", { name: "Drag Design homepage" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Move Design homepage" })).toHaveValue(
      "IN_PROGRESS",
    );
  });

  it("shows 'Unassigned' and no overdue mark for done or undated tasks", () => {
    renderCard({ ...base, status: "DONE", assigneeName: null });
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent("Unassigned");
    expect(card).not.toHaveTextContent("(overdue)");
    cleanup();
    renderCard({ ...base, dueDate: null });
    expect(screen.getByRole("article")).not.toHaveTextContent("Jan");
  });

  it("has no drag handle or move control when not editable", () => {
    renderCard(base, false);
    expect(screen.queryByRole("button", { name: /Drag/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("isTaskOverdue", () => {
  const now = new Date("2026-06-10T20:00:00Z");
  it("is overdue only before today (UTC) and when not done", () => {
    expect(isTaskOverdue({ dueDate: new Date("2026-06-09T00:00:00Z"), status: "TODO" }, now)).toBe(
      true,
    );
    expect(isTaskOverdue({ dueDate: new Date("2026-06-10T00:00:00Z"), status: "TODO" }, now)).toBe(
      false,
    );
    expect(isTaskOverdue({ dueDate: new Date("2026-06-09T00:00:00Z"), status: "DONE" }, now)).toBe(
      false,
    );
    expect(isTaskOverdue({ dueDate: null, status: "TODO" }, now)).toBe(false);
  });
});
