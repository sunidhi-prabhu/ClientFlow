// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskForm, type TaskFormValues } from "./task-form";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const initial: TaskFormValues = {
  id: "t1",
  title: "Design homepage",
  description: "Hero section",
  status: "IN_PROGRESS",
  priority: "HIGH",
  dueDate: "2026-11-01",
  assigneeUserId: "u1",
};
const members = [
  { userId: "u1", name: "Ada" },
  { userId: "u2", name: "Grace" },
];

describe("TaskForm", () => {
  beforeEach(() => router.refresh.mockReset());
  afterEach(cleanup);

  it("prefills every field and offers only project members as assignees", () => {
    render(
      <TaskForm organizationSlug="acme" action={vi.fn()} initial={initial} members={members} />,
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Design homepage");
    expect(screen.getByLabelText("Description")).toHaveValue("Hero section");
    expect(screen.getByLabelText("Status")).toHaveValue("IN_PROGRESS");
    expect(screen.getByLabelText("Priority")).toHaveValue("HIGH");
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-11-01");
    const assignee = screen.getByLabelText("Assignee") as HTMLSelectElement;
    expect(assignee).toHaveValue("u1");
    expect(Array.from(assignee.options).map((option) => option.text)).toEqual([
      "Unassigned",
      "Ada",
      "Grace",
    ]);
  });

  it("submits the edited values with the task id, then shows 'saved' and refreshes", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: { id: "t1" } });
    render(
      <TaskForm organizationSlug="acme" action={action} initial={initial} members={members} />,
    );

    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "URGENT" } });
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        "acme",
        expect.objectContaining({
          id: "t1",
          priority: "URGENT",
          assigneeUserId: "",
          dueDate: "",
          status: "IN_PROGRESS",
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Changes saved.");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows validation errors next to the fields", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The assignee must be a member of this project",
        details: [
          { path: "assigneeUserId", message: "The assignee must be a member of this project" },
          { path: "title", message: "Enter a title" },
        ],
      },
    });
    render(
      <TaskForm organizationSlug="acme" action={action} initial={initial} members={members} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("The assignee must be a member of this project"),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter a title")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee")).toHaveAttribute("aria-invalid", "true");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("hints when the project has no members to assign", () => {
    render(
      <TaskForm
        organizationSlug="acme"
        action={vi.fn()}
        initial={{ ...initial, assigneeUserId: null }}
        members={[]}
      />,
    );
    expect(screen.getByText("Add people to the project to assign tasks.")).toBeInTheDocument();
  });
});
