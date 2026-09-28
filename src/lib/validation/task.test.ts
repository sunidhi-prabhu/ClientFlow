import { describe, expect, it } from "vitest";

import {
  assignTaskInput,
  createTaskInput,
  moveTaskInput,
  parseTaskBoardQuery,
} from "@/lib/validation/task";

describe("task input validation", () => {
  it("normalizes input and strips fields the client may not set", () => {
    const parsed = createTaskInput.parse({
      projectId: "p1",
      title: " Title ",
      description: "",
      assigneeUserId: "",
      dueDate: "2026-03-01",
      organizationId: "org_b",
    });
    expect(parsed).toEqual({
      projectId: "p1",
      title: "Title",
      description: null,
      status: "TODO",
      priority: "MEDIUM",
      dueDate: new Date("2026-03-01T00:00:00.000Z"),
      assigneeUserId: null,
    });
  });

  it("only accepts the four statuses for moves", () => {
    for (const status of ["TODO", "IN_PROGRESS", "REVIEW", "DONE"]) {
      expect(moveTaskInput.safeParse({ id: "t", status }).success).toBe(true);
    }
    for (const status of ["ARCHIVED", "todo", "", null, undefined]) {
      expect(moveTaskInput.safeParse({ id: "t", status }).success).toBe(false);
    }
  });

  it("treats null and empty assignee as unassign", () => {
    expect(assignTaskInput.parse({ id: "t", assigneeUserId: null }).assigneeUserId).toBeNull();
    expect(assignTaskInput.parse({ id: "t", assigneeUserId: "" }).assigneeUserId).toBeNull();
  });

  it("parses board filters leniently", () => {
    expect(parseTaskBoardQuery({ q: [" x "], assignee: "", priority: "EXTREME" })).toEqual({
      q: "x",
      assignee: undefined,
      priority: undefined,
    });
  });
});
