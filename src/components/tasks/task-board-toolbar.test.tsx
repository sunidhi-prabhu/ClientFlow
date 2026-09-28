// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskBoardToolbar } from "./task-board-toolbar";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/o/acme/projects/p1",
}));

describe("TaskBoardToolbar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.replace.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderToolbar = (props: Partial<{ q: string; assignee: string; priority: string }> = {}) =>
    render(
      <TaskBoardToolbar
        q=""
        assignee=""
        priority=""
        members={[{ userId: "u1", name: "Ada" }]}
        {...props}
      />,
    );

  it("filters by assignee (including unassigned) and priority on the project page URL", () => {
    renderToolbar({ q: "bug" });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by assignee" }), {
      target: { value: "unassigned" },
    });
    expect(router.replace).toHaveBeenLastCalledWith(
      "/o/acme/projects/p1?q=bug&assignee=unassigned",
      { scroll: false },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by priority" }), {
      target: { value: "URGENT" },
    });
    expect(router.replace).toHaveBeenLastCalledWith("/o/acme/projects/p1?q=bug&priority=URGENT", {
      scroll: false,
    });
  });

  it("debounces search and clears to the bare project URL", () => {
    renderToolbar({ assignee: "u1" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "login" },
    });
    act(() => vi.advanceTimersByTime(300));
    expect(router.replace).toHaveBeenLastCalledWith("/o/acme/projects/p1?q=login&assignee=u1", {
      scroll: false,
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by assignee" }), {
      target: { value: "" },
    });
    expect(router.replace).toHaveBeenLastCalledWith("/o/acme/projects/p1?q=login", {
      scroll: false,
    });
  });
});
