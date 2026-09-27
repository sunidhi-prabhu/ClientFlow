import { describe, expect, it } from "vitest";

import {
  createProjectInput,
  setProjectProgressInput,
  updateProjectInput,
} from "@/lib/validation/project";

describe("project input validation", () => {
  it("normalizes blanks and parses calendar dates as UTC", () => {
    expect(
      createProjectInput.parse({
        name: " Site ",
        description: "",
        clientId: "",
        startDate: "2026-10-01",
        dueDate: "",
        progress: "15",
      }),
    ).toEqual({
      name: "Site",
      description: null,
      clientId: null,
      status: "PLANNING",
      priority: "MEDIUM",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      dueDate: null,
      progress: 15,
    });
  });

  it("rejects a due date before the start date", () => {
    const result = createProjectInput.safeParse({
      name: "X",
      startDate: "2026-10-02",
      dueDate: "2026-10-01",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["dueDate"]);
  });

  it("allows the same start and due date", () => {
    expect(
      createProjectInput.safeParse({ name: "X", startDate: "2026-10-01", dueDate: "2026-10-01" })
        .success,
    ).toBe(true);
  });

  it("rejects invalid dates, statuses, priorities and progress", () => {
    for (const input of [
      { name: "X", startDate: "2026-02-30" },
      { name: "X", status: "ARCHIVED" },
      { name: "X", priority: "CRITICAL" },
      { name: "X", progress: "-1" },
      { name: "X", progress: "2.5" },
    ]) {
      expect(createProjectInput.safeParse(input).success).toBe(false);
    }
    expect(setProjectProgressInput.safeParse({ id: "p", progress: 101 }).success).toBe(false);
  });

  it("strips organizationId and similar fields", () => {
    const parsed = updateProjectInput.parse({
      id: "p",
      name: "X",
      organizationId: "org_b",
      archivedAt: "x",
    });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("archivedAt");
  });
});
