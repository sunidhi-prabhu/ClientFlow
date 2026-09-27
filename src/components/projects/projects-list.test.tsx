// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { formatProjectDate, isOverdue, toDateInputValue } from "./project-labels";
import { ProjectActivityList } from "./project-activity-list";
import { ProjectsEmptyState } from "./projects-empty-state";
import { ProjectsTable, type ProjectRow } from "./projects-table";
import { projectsListHref } from "./projects-url";

afterEach(cleanup);

const row = (overrides: Partial<ProjectRow>): ProjectRow => ({
  id: "p1",
  name: "Website redesign",
  status: "ACTIVE",
  priority: "HIGH",
  progress: 45,
  startDate: null,
  dueDate: null,
  client: { id: "c1", name: "Wayne Enterprises" },
  _count: { members: 3 },
  ...overrides,
});

describe("project dates", () => {
  it("formats calendar dates in UTC so they never shift a day", () => {
    expect(formatProjectDate(new Date("2026-12-15T00:00:00Z"))).toBe("Dec 15, 2026");
    expect(formatProjectDate(null)).toBe("—");
    expect(toDateInputValue(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });

  it("marks unfinished projects past their due date as overdue", () => {
    const now = new Date("2026-06-10T15:00:00Z");
    const due = new Date("2026-06-09T00:00:00Z");
    expect(isOverdue({ dueDate: due, status: "ACTIVE" }, now)).toBe(true);
    expect(isOverdue({ dueDate: new Date("2026-06-10T00:00:00Z"), status: "ACTIVE" }, now)).toBe(
      false,
    );
    expect(isOverdue({ dueDate: due, status: "COMPLETED" }, now)).toBe(false);
    expect(isOverdue({ dueDate: due, status: "ARCHIVED" }, now)).toBe(false);
    expect(isOverdue({ dueDate: null, status: "ACTIVE" }, now)).toBe(false);
  });
});

describe("projectsListHref", () => {
  it("omits defaults and keeps filters", () => {
    expect(projectsListHref("/o/acme/projects", { status: "current", sort: "name", page: 1 })).toBe(
      "/o/acme/projects",
    );
    expect(
      projectsListHref("/o/acme/projects", {
        q: "a b",
        clientId: "c1",
        status: "ON_HOLD",
        page: 2,
      }),
    ).toBe("/o/acme/projects?q=a+b&status=ON_HOLD&clientId=c1&page=2");
  });
});

describe("ProjectsTable", () => {
  it("shows name link, client, status, priority, progress, due date and member count", () => {
    render(
      <ProjectsTable
        basePath="/o/acme/projects"
        projects={[
          row({ dueDate: new Date("2000-01-01T00:00:00Z") }),
          row({
            id: "p2",
            name: "Internal",
            client: null,
            status: "COMPLETED",
            priority: "LOW",
            progress: 100,
          }),
        ]}
      />,
    );
    const table = screen.getByRole("table");
    const [, first, second] = within(table).getAllByRole("row");

    expect(within(first).getByRole("link", { name: "Website redesign" })).toHaveAttribute(
      "href",
      "/o/acme/projects/p1",
    );
    expect(first).toHaveTextContent("Wayne Enterprises");
    expect(first).toHaveTextContent("Active");
    expect(first).toHaveTextContent("High");
    expect(first).toHaveTextContent("(overdue)");
    expect(within(first).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "45");
    expect(first).toHaveTextContent("Members: 3");

    expect(second).toHaveTextContent("No client");
    expect(second).toHaveTextContent("Completed");
    expect(second).not.toHaveTextContent("(overdue)");
  });
});

describe("ProjectsEmptyState", () => {
  it("distinguishes 'no projects yet' from 'no matches'", () => {
    const { rerender } = render(
      <ProjectsEmptyState filtered={false} basePath="/o/acme/projects" canCreate />,
    );
    expect(screen.getByRole("link", { name: "New project" })).toHaveAttribute(
      "href",
      "/o/acme/projects/new",
    );
    rerender(<ProjectsEmptyState filtered basePath="/o/acme/projects" canCreate />);
    expect(screen.getByText("No matching projects")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toBeInTheDocument();
    rerender(<ProjectsEmptyState filtered={false} basePath="/o/acme/projects" canCreate={false} />);
    expect(screen.queryByRole("link", { name: "New project" })).not.toBeInTheDocument();
  });
});

describe("ProjectActivityList", () => {
  it("describes status, member, progress and field changes", () => {
    const base = {
      createdAt: new Date("2026-01-01T10:00:00Z"),
      actor: { name: "Ada", email: "a@x.io" },
    };
    render(
      <ProjectActivityList
        items={[
          {
            ...base,
            id: "5",
            type: "STATUS_CHANGED",
            changes: { status: { from: "ACTIVE", to: "ON_HOLD" } },
          },
          {
            ...base,
            id: "4",
            type: "MEMBER_ADDED",
            changes: { member: { userId: "u", name: "Grace" } },
          },
          { ...base, id: "3", type: "UPDATED", changes: { progress: { from: 10, to: 60 } } },
          {
            ...base,
            id: "2",
            type: "UPDATED",
            changes: {
              clientId: { from: null, to: "c" },
              dueDate: { from: null, to: "2026-02-01" },
            },
          },
          { ...base, id: "1", type: "CREATED", changes: null, actor: null },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toContain("Ada changed the status from Active to On hold");
    expect(items[1]).toContain("Ada added Grace to the project");
    expect(items[2]).toContain("Ada set progress to 60%");
    expect(items[3]).toContain("Ada updated client, due date");
    expect(items[4]).toContain("A former member created this project");
  });
});
