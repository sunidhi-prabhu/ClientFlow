// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsToolbar } from "./projects-toolbar";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const counts = { PLANNING: 2, ACTIVE: 3, ON_HOLD: 0, COMPLETED: 1, ARCHIVED: 4 };

function renderToolbar(overrides: Partial<Parameters<typeof ProjectsToolbar>[0]> = {}) {
  return render(
    <ProjectsToolbar
      basePath="/o/acme/projects"
      q=""
      status="current"
      clientId=""
      sort="name"
      clients={[{ id: "c1", name: "Wayne Enterprises" }]}
      statusCounts={counts}
      {...overrides}
    />,
  );
}

describe("ProjectsToolbar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.replace.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("filters by client, keeping the other filters", () => {
    renderToolbar({ q: "site", sort: "due" });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by client" }), {
      target: { value: "c1" },
    });
    expect(router.replace).toHaveBeenCalledWith("/o/acme/projects?q=site&clientId=c1&sort=due", {
      scroll: false,
    });
  });

  it("offers 'No client' as a filter", () => {
    renderToolbar();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by client" }), {
      target: { value: "none" },
    });
    expect(router.replace).toHaveBeenCalledWith("/o/acme/projects?clientId=none", {
      scroll: false,
    });
  });

  it("shows status counts and filters by status", () => {
    renderToolbar();
    expect(screen.getByRole("option", { name: "All except archived (6)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "On hold (0)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All projects (10)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), {
      target: { value: "ACTIVE" },
    });
    expect(router.replace).toHaveBeenCalledWith("/o/acme/projects?status=ACTIVE", {
      scroll: false,
    });
  });

  it("debounces search", () => {
    renderToolbar({ clientId: "c1" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "redesign" },
    });
    expect(router.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(router.replace).toHaveBeenCalledWith("/o/acme/projects?q=redesign&clientId=c1", {
      scroll: false,
    });
  });
});
