import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assignTaskAction,
  createTaskAction,
  deleteTaskAction,
  moveTaskAction,
  setTaskPriorityAction,
  updateTaskAction,
} from "@/app/o/[orgSlug]/projects/[projectId]/tasks/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { hasPermission } from "@/lib/permissions";
import { taskBoardQuery } from "@/lib/validation/task";
import { listProjectActivity } from "@/server/projects/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantPage } from "@/server/protected";
import { getTask, listProjectTasks, listTaskActivity } from "@/server/tasks/service";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

type Member = { userId: string; cookie: string };

let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: Member;
let project: { id: string };
let otherAcmeProject: { id: string };
let globexProject: { id: string };
let globexTask: { id: string };

async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

const as = (role: MembershipRole) => actAs(members[role].cookie);

function seedTask(
  organizationId: string,
  projectId: string,
  data: {
    title: string;
    status?: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    assigneeUserId?: string | null;
    dueDate?: Date;
    description?: string;
  },
) {
  return getDb().task.create({ data: { organizationId, projectId, ...data } });
}

const addToProject = (organizationId: string, projectId: string, userId: string) =>
  getDb().projectMember.create({ data: { organizationId, projectId, userId } });

const taskEvents = async (taskId: string) =>
  (
    await getDb().projectActivity.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } })
  ).map((row) => row.type);

beforeEach(async () => {
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
  members.OWNER = owner;
  for (const role of ["ADMIN", "MANAGER", "MEMBER"] as const) {
    const user = await createVerifiedUser(`${role.toLowerCase()}@example.com`);
    await getDb().membership.create({
      data: { organizationId: acme.id, userId: user.userId, role },
    });
    members[role] = user;
  }
  project = await getDb().project.create({ data: { organizationId: acme.id, name: "Website" } });
  otherAcmeProject = await getDb().project.create({
    data: { organizationId: acme.id, name: "Mobile app" },
  });
  await addToProject(acme.id, project.id, members.MEMBER.userId);
  await addToProject(acme.id, project.id, members.MANAGER.userId);

  outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
  globexProject = await getDb().project.create({
    data: { organizationId: globex.id, name: "Globex secret" },
  });
  await addToProject(globex.id, globexProject.id, outsider.userId);
  globexTask = await seedTask(globex.id, globexProject.id, {
    title: "Globex secret task",
    assigneeUserId: outsider.userId,
  });
});

describe("create", () => {
  it("creates a task in the project with all fields, and records it", async () => {
    as("MEMBER");
    const result = await createTaskAction("acme", {
      projectId: project.id,
      title: "  Design homepage ",
      description: "Hero + nav",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: "2026-11-01",
      assigneeUserId: members.MANAGER.userId,
      organizationId: globex.id,
    });

    expect(result).toMatchObject({ ok: true, data: { status: "IN_PROGRESS" } });
    const task = await getDb().task.findFirstOrThrow({ where: { projectId: project.id } });
    expect(task).toMatchObject({
      organizationId: acme.id,
      projectId: project.id,
      title: "Design homepage",
      description: "Hero + nav",
      status: "IN_PROGRESS",
      priority: "HIGH",
      dueDate: new Date("2026-11-01T00:00:00Z"),
      assigneeUserId: members.MANAGER.userId,
    });
    const [event] = await getDb().projectActivity.findMany({ where: { taskId: task.id } });
    expect(event).toMatchObject({
      type: "TASK_CREATED",
      projectId: project.id,
      actorUserId: members.MEMBER.userId,
      changes: { task: { title: "Design homepage" }, assignee: { userId: members.MANAGER.userId } },
    });
    expect(JSON.stringify(event.changes)).not.toContain("Hero");
  });

  it("creates a minimal unassigned TODO task", async () => {
    as("OWNER");
    await createTaskAction("acme", { projectId: project.id, title: "Quick" });
    await expect(
      getDb().task.findFirstOrThrow({ where: { title: "Quick" } }),
    ).resolves.toMatchObject({
      status: "TODO",
      priority: "MEDIUM",
      assigneeUserId: null,
      dueDate: null,
      description: null,
    });
  });

  it("validates title, status, priority and due date", async () => {
    as("OWNER");
    const result = await createTaskAction("acme", {
      projectId: project.id,
      title: "",
      status: "BLOCKED",
      priority: "CRITICAL",
      dueDate: "2026-02-31",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const paths = (result as { error: { details: { path: string }[] } }).error.details
      .map((detail) => detail.path)
      .sort();
    expect(paths).toEqual(["dueDate", "priority", "status", "title"]);
    await expect(getDb().task.count({ where: { organizationId: acme.id } })).resolves.toBe(0);
  });

  it("cannot create a task in an archived project", async () => {
    await getDb().project.update({ where: { id: project.id }, data: { status: "ARCHIVED" } });
    as("OWNER");
    await expect(
      createTaskAction("acme", { projectId: project.id, title: "X" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "Restore this project before changing its tasks" },
    });
  });
});

describe("retrieve and list", () => {
  it("returns the task with its project and assignee", async () => {
    const task = await seedTask(acme.id, project.id, {
      title: "T",
      assigneeUserId: members.MEMBER.userId,
    });
    await expect(getTask(getTenantDb(acme.id), task.id)).resolves.toMatchObject({
      title: "T",
      project: { id: project.id, name: "Website" },
      assignee: { membership: { user: { email: "member@example.com" } } },
    });
  });

  it("lists a project's tasks with assignee names, most urgent first per column", async () => {
    await seedTask(acme.id, project.id, { title: "Low", priority: "LOW" });
    await seedTask(acme.id, project.id, {
      title: "Urgent",
      priority: "URGENT",
      assigneeUserId: members.MEMBER.userId,
    });
    await seedTask(acme.id, project.id, {
      title: "High soon",
      priority: "HIGH",
      dueDate: new Date("2026-01-01"),
    });
    await seedTask(acme.id, project.id, {
      title: "High later",
      priority: "HIGH",
      dueDate: new Date("2026-06-01"),
    });
    await seedTask(acme.id, otherAcmeProject.id, { title: "Other project" });

    const { tasks, truncated } = await listProjectTasks(getTenantDb(acme.id), project.id);
    expect(truncated).toBe(false);
    expect(tasks.map((task) => task.title)).toEqual(["Urgent", "High soon", "High later", "Low"]);
    expect(tasks[0].assignee?.membership.user.name).toBe("Test User");
  });

  it("filters the board by search, assignee (incl. unassigned) and priority", async () => {
    await seedTask(acme.id, project.id, {
      title: "Fix login bug",
      assigneeUserId: members.MEMBER.userId,
      priority: "HIGH",
    });
    await seedTask(acme.id, project.id, { title: "Write docs", description: "API bug notes" });
    await seedTask(acme.id, project.id, { title: "100% coverage", priority: "LOW" });
    const titles = async (input: Record<string, unknown>) =>
      (
        await listProjectTasks(getTenantDb(acme.id), project.id, taskBoardQuery.parse(input))
      ).tasks.map((task) => task.title);

    await expect(titles({ q: "bug" })).resolves.toEqual(["Fix login bug", "Write docs"]);
    await expect(titles({ q: "100%" })).resolves.toEqual(["100% coverage"]);
    await expect(titles({ q: "_" })).resolves.toEqual([]);
    await expect(titles({ assignee: members.MEMBER.userId })).resolves.toEqual(["Fix login bug"]);
    await expect(titles({ assignee: "unassigned" })).resolves.toEqual([
      "Write docs",
      "100% coverage",
    ]);
    await expect(titles({ priority: "LOW" })).resolves.toEqual(["100% coverage"]);
  });

  it("keeps task events out of the project's own activity feed", async () => {
    as("OWNER");
    await createTaskAction("acme", { projectId: project.id, title: "T" });
    await expect(listProjectActivity(getTenantDb(acme.id), project.id)).resolves.toEqual([]);
  });
});

describe("update", () => {
  it("updates fields and records status, priority, assignment and other changes separately", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Old", description: "secret notes" });
    as("MEMBER");
    await expect(
      updateTaskAction("acme", {
        id: task.id,
        title: "New",
        description: "new secret notes",
        status: "REVIEW",
        priority: "URGENT",
        dueDate: "2026-12-01",
        assigneeUserId: members.MEMBER.userId,
      }),
    ).resolves.toEqual({ ok: true, data: { id: task.id } });

    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      {
        title: "New",
        status: "REVIEW",
        priority: "URGENT",
        dueDate: new Date("2026-12-01T00:00:00Z"),
        assigneeUserId: members.MEMBER.userId,
      },
    );
    const history = await listTaskActivity(getTenantDb(acme.id), task.id);
    const byType = Object.fromEntries(history.map((item) => [item.type, item.changes]));
    expect(Object.keys(byType).sort()).toEqual([
      "TASK_ASSIGNMENT_CHANGED",
      "TASK_PRIORITY_CHANGED",
      "TASK_STATUS_CHANGED",
      "TASK_UPDATED",
    ]);
    expect(byType.TASK_STATUS_CHANGED).toEqual({
      task: { title: "New" },
      status: { from: "TODO", to: "REVIEW" },
    });
    expect(byType.TASK_ASSIGNMENT_CHANGED).toEqual({
      task: { title: "New" },
      assignee: { from: null, to: { userId: members.MEMBER.userId, name: "Test User" } },
    });
    expect(byType.TASK_UPDATED).toEqual({
      task: { title: "New" },
      title: { from: "Old", to: "New" },
      dueDate: { from: null, to: "2026-12-01" },
      description: { from: null, to: null },
    });
    expect(JSON.stringify(history)).not.toContain("secret");
  });

  it("changes the due date and clears it", async () => {
    const task = await seedTask(acme.id, project.id, { title: "T" });
    as("OWNER");
    await updateTaskAction("acme", { id: task.id, title: "T", dueDate: "2026-03-10" });
    await updateTaskAction("acme", { id: task.id, title: "T", dueDate: "" });
    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      { dueDate: null },
    );
  });

  it("records nothing when nothing changed", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Same" });
    as("OWNER");
    await updateTaskAction("acme", { id: task.id, title: "Same" });
    await expect(taskEvents(task.id)).resolves.toEqual([]);
  });

  it("changes priority through the dedicated action", async () => {
    const task = await seedTask(acme.id, project.id, { title: "T" });
    as("MEMBER");
    await expect(
      setTaskPriorityAction("acme", { id: task.id, priority: "URGENT" }),
    ).resolves.toEqual({
      ok: true,
      data: { id: task.id, priority: "URGENT" },
    });
    await expect(
      setTaskPriorityAction("acme", { id: task.id, priority: "EXTREME" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    await expect(taskEvents(task.id)).resolves.toEqual(["TASK_PRIORITY_CHANGED"]);
  });

  it("tasks in an archived project are read-only", async () => {
    const task = await seedTask(acme.id, project.id, { title: "T" });
    await getDb().project.update({ where: { id: project.id }, data: { status: "ARCHIVED" } });
    as("OWNER");
    const blocked = {
      ok: false,
      error: { code: "CONFLICT", message: "Restore this project before changing its tasks" },
    };
    await expect(moveTaskAction("acme", { id: task.id, status: "DONE" })).resolves.toEqual(blocked);
    await expect(setTaskPriorityAction("acme", { id: task.id, priority: "LOW" })).resolves.toEqual(
      blocked,
    );
    expect((await runRedirecting(deleteTaskAction("acme", { id: task.id }))).result).toEqual(
      blocked,
    );
  });
});

describe("status changes (Kanban moves)", () => {
  it("moves a task between columns and records it", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Card" });
    as("MEMBER");
    for (const status of ["IN_PROGRESS", "REVIEW", "DONE", "TODO"] as const) {
      await expect(moveTaskAction("acme", { id: task.id, status })).resolves.toEqual({
        ok: true,
        data: { id: task.id, status },
      });
    }
    await expect(taskEvents(task.id)).resolves.toEqual([
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
    ]);
  });

  it("rejects invalid status values without changing anything", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Card" });
    as("OWNER");
    for (const status of ["ARCHIVED", "BLOCKED", "", "done", null, 3]) {
      await expect(moveTaskAction("acme", { id: task.id, status })).resolves.toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
    }
    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      { status: "TODO" },
    );
  });

  it("is a compare-and-set: a stale move (someone else moved the card) is a 409 and changes nothing", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Card", status: "REVIEW" });
    as("MEMBER");
    await expect(
      moveTaskAction("acme", { id: task.id, status: "DONE", fromStatus: "TODO" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      { status: "REVIEW" },
    );

    await expect(
      moveTaskAction("acme", { id: task.id, status: "DONE", fromStatus: "REVIEW" }),
    ).resolves.toMatchObject({ ok: true, data: { status: "DONE" } });
  });

  it("two concurrent moves from the same column: exactly one wins", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Card" });
    as("MEMBER");
    const results = await Promise.all([
      moveTaskAction("acme", { id: task.id, status: "IN_PROGRESS", fromStatus: "TODO" }),
      moveTaskAction("acme", { id: task.id, status: "DONE", fromStatus: "TODO" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: "CONFLICT" }) }),
    ]);
    await expect(taskEvents(task.id)).resolves.toHaveLength(1);
  });
});

describe("atomic moves", () => {
  it("a move racing with an uncommitted concurrent change is rejected, not overwritten", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Raced card" });
    const pg = await import("pg");
    const other = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      // Someone else moves the card to REVIEW and holds the row lock (not committed yet).
      await other.query("BEGIN");
      await other.query(`UPDATE "Task" SET "status" = 'REVIEW' WHERE "id" = $1`, [task.id]);

      // Our move still sees TODO (passes the fromStatus pre-check), then blocks on the lock.
      as("MEMBER");
      const pending = moveTaskAction("acme", { id: task.id, status: "DONE", fromStatus: "TODO" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query("COMMIT");

      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      await expect(
        getDb().task.findUniqueOrThrow({ where: { id: task.id } }),
      ).resolves.toMatchObject({
        status: "REVIEW",
      });
      await expect(taskEvents(task.id)).resolves.toEqual([]);
    } finally {
      await other.query("ROLLBACK").catch(() => {});
      await other.end();
    }
  });
});

describe("assignment", () => {
  let task: { id: string };
  beforeEach(async () => {
    task = await seedTask(acme.id, project.id, { title: "Card" });
  });

  it("assigns to a project member and unassigns", async () => {
    as("MEMBER");
    await expect(
      assignTaskAction("acme", { id: task.id, assigneeUserId: members.MANAGER.userId }),
    ).resolves.toEqual({
      ok: true,
      data: { id: task.id, assigneeUserId: members.MANAGER.userId },
    });
    await expect(assignTaskAction("acme", { id: task.id, assigneeUserId: "" })).resolves.toEqual({
      ok: true,
      data: { id: task.id, assigneeUserId: null },
    });
    const history = await listTaskActivity(getTenantDb(acme.id), task.id);
    expect(history.map((item) => item.changes)).toEqual([
      {
        task: { title: "Card" },
        assignee: { from: { userId: members.MANAGER.userId, name: "Test User" }, to: null },
      },
      {
        task: { title: "Card" },
        assignee: { from: null, to: { userId: members.MANAGER.userId, name: "Test User" } },
      },
    ]);
  });

  it("rejects an organization member who is not on the project", async () => {
    as("OWNER");
    await expect(
      assignTaskAction("acme", { id: task.id, assigneeUserId: members.ADMIN.userId }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The assignee must be a member of this project",
        details: [
          { path: "assigneeUserId", message: "The assignee must be a member of this project" },
        ],
      },
    });
  });

  it("rejects a user from another organization exactly like an unknown user", async () => {
    as("OWNER");
    const foreign = await assignTaskAction("acme", {
      id: task.id,
      assigneeUserId: outsider.userId,
    });
    const unknown = await assignTaskAction("acme", { id: task.id, assigneeUserId: "no-such-user" });
    expect(foreign).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(unknown).toEqual(foreign);
    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      { assigneeUserId: null },
    );
  });

  it("rejects a member of a different project of the same organization on create", async () => {
    await addToProject(acme.id, otherAcmeProject.id, members.ADMIN.userId);
    as("OWNER");
    await expect(
      createTaskAction("acme", {
        projectId: project.id,
        title: "X",
        assigneeUserId: members.ADMIN.userId,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("the database rejects an assignee who is not a member of the task's project (composite key)", async () => {
    await expect(
      getDb().task.update({
        where: { id: task.id },
        data: { assigneeUserId: members.ADMIN.userId },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      getDb().task.create({
        data: {
          organizationId: acme.id,
          projectId: project.id,
          title: "Raw",
          assigneeUserId: outsider.userId,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("the database rejects a task whose project is in another organization (composite key)", async () => {
    await expect(
      getDb().task.create({
        data: { organizationId: acme.id, projectId: globexProject.id, title: "Raw" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("removing someone from the project (or organization) unassigns their tasks there", async () => {
    await getDb().task.update({
      where: { id: task.id },
      data: { assigneeUserId: members.MEMBER.userId },
    });
    const other = await seedTask(acme.id, project.id, {
      title: "Other",
      assigneeUserId: members.MANAGER.userId,
    });

    as("OWNER");
    const { removeProjectMemberAction } = await import("@/app/o/[orgSlug]/projects/actions");
    await expect(
      removeProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      { assigneeUserId: null },
    );

    await getDb().membership.deleteMany({
      where: { organizationId: acme.id, userId: members.MANAGER.userId },
    });
    await expect(
      getDb().task.findUniqueOrThrow({ where: { id: other.id } }),
    ).resolves.toMatchObject({ assigneeUserId: null });
  });
});

describe("delete", () => {
  it("deletes the task, returns to the project, and keeps its history", async () => {
    const task = await seedTask(acme.id, project.id, { title: "Obsolete" });
    as("MANAGER");
    const { redirectedTo } = await runRedirecting(deleteTaskAction("acme", { id: task.id }));
    expect(redirectedTo).toBe(`/o/acme/projects/${project.id}`);
    await expect(getDb().task.count({ where: { id: task.id } })).resolves.toBe(0);
    await expect(
      getDb().projectActivity.findFirstOrThrow({ where: { taskId: task.id } }),
    ).resolves.toMatchObject({ type: "TASK_DELETED", changes: { task: { title: "Obsolete" } } });

    expect((await runRedirecting(deleteTaskAction("acme", { id: task.id }))).result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Task not found" },
    });
  });
});

describe("role/permission matrix", () => {
  const cases = [
    { name: "create", permission: "task:create" },
    { name: "update", permission: "task:update" },
    { name: "move", permission: "task:update" },
    { name: "assign", permission: "task:update" },
    { name: "priority", permission: "task:update" },
    { name: "delete", permission: "task:delete" },
  ] as const;

  for (const role of ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const) {
    it(role, async () => {
      const task = await seedTask(acme.id, project.id, { title: "Matrix" });
      const doomed = await seedTask(acme.id, project.id, { title: "Doomed" });
      as(role);
      const outcomes: Record<string, boolean> = {};
      const run = async (name: string, action: () => Promise<unknown>) => {
        const { result, redirectedTo } = await runRedirecting(action());
        const ok = redirectedTo !== undefined || (result as { ok: boolean }).ok;
        if (!ok) expect(result).toMatchObject({ error: { code: "FORBIDDEN" } });
        outcomes[name] = ok;
      };

      await run("create", () =>
        createTaskAction("acme", { projectId: project.id, title: `By ${role}` }),
      );
      await run("update", () =>
        updateTaskAction("acme", { id: task.id, title: `Renamed by ${role}` }),
      );
      await run("move", () => moveTaskAction("acme", { id: task.id, status: "DONE" }));
      await run("assign", () =>
        assignTaskAction("acme", { id: task.id, assigneeUserId: members.MEMBER.userId }),
      );
      await run("priority", () =>
        setTaskPriorityAction("acme", { id: task.id, priority: "URGENT" }),
      );
      await run("delete", () => deleteTaskAction("acme", { id: doomed.id }));

      expect(outcomes).toEqual(
        Object.fromEntries(
          cases.map(({ name, permission }) => [name, hasPermission(role, permission)]),
        ),
      );
      await expect(tenantPage("acme", "task:read")).resolves.toMatchObject({ allowed: true });
    });
  }

  it("documents the current model: MEMBER can create and edit tasks in any project of the organization, but not delete", async () => {
    const task = await seedTask(acme.id, otherAcmeProject.id, { title: "Not my project" });
    as("MEMBER");
    await expect(moveTaskAction("acme", { id: task.id, status: "DONE" })).resolves.toMatchObject({
      ok: true,
    });
    expect((await runRedirecting(deleteTaskAction("acme", { id: task.id }))).result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("unauthenticated requests", () => {
  it("every task action is rejected and nothing changes", async () => {
    const task = await seedTask(acme.id, project.id, { title: "T" });
    actAs(undefined);
    const unauthenticated = {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    };
    await expect(
      createTaskAction("acme", { projectId: project.id, title: "Anon" }),
    ).resolves.toEqual(unauthenticated);
    await expect(updateTaskAction("acme", { id: task.id, title: "Anon" })).resolves.toEqual(
      unauthenticated,
    );
    await expect(moveTaskAction("acme", { id: task.id, status: "DONE" })).resolves.toEqual(
      unauthenticated,
    );
    await expect(
      assignTaskAction("acme", { id: task.id, assigneeUserId: members.MEMBER.userId }),
    ).resolves.toEqual(unauthenticated);
    await expect(setTaskPriorityAction("acme", { id: task.id, priority: "LOW" })).resolves.toEqual(
      unauthenticated,
    );
    expect((await runRedirecting(deleteTaskAction("acme", { id: task.id }))).result).toEqual(
      unauthenticated,
    );
    await expect(getDb().task.findUniqueOrThrow({ where: { id: task.id } })).resolves.toMatchObject(
      { title: "T", status: "TODO" },
    );
    await expect(taskEvents(task.id)).resolves.toEqual([]);
  });
});

describe("organization isolation and IDOR/BOLA", () => {
  async function expectGlobexUntouched() {
    await expect(
      getDb().task.findUniqueOrThrow({ where: { id: globexTask.id } }),
    ).resolves.toMatchObject({
      organizationId: globex.id,
      title: "Globex secret task",
      status: "TODO",
      priority: "MEDIUM",
      assigneeUserId: outsider.userId,
    });
    await expect(getDb().task.count({ where: { projectId: globexProject.id } })).resolves.toBe(1);
    await expect(
      getDb().projectActivity.count({ where: { projectId: globexProject.id } }),
    ).resolves.toBe(0);
  }

  const taskNotFound = { ok: false, error: { code: "NOT_FOUND", message: "Task not found" } };

  it("an Acme OWNER cannot touch a Globex task by id", async () => {
    as("OWNER");
    await expect(updateTaskAction("acme", { id: globexTask.id, title: "Pwned" })).resolves.toEqual(
      taskNotFound,
    );
    await expect(moveTaskAction("acme", { id: globexTask.id, status: "DONE" })).resolves.toEqual(
      taskNotFound,
    );
    await expect(
      assignTaskAction("acme", { id: globexTask.id, assigneeUserId: "" }),
    ).resolves.toEqual(taskNotFound);
    await expect(
      setTaskPriorityAction("acme", { id: globexTask.id, priority: "URGENT" }),
    ).resolves.toEqual(taskNotFound);
    expect((await runRedirecting(deleteTaskAction("acme", { id: globexTask.id }))).result).toEqual(
      taskNotFound,
    );
    await expect(getTask(getTenantDb(acme.id), globexTask.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listTaskActivity(getTenantDb(acme.id), globexTask.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expectGlobexUntouched();
  });

  it("cannot create a task in a Globex project, or list its board", async () => {
    as("OWNER");
    await expect(
      createTaskAction("acme", { projectId: globexProject.id, title: "Planted" }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Project not found" },
    });
    await expect(listProjectTasks(getTenantDb(acme.id), globexProject.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expectGlobexUntouched();
  });

  it("cannot assign a Globex user to an Acme task (see assignment tests) nor act by switching the slug", async () => {
    as("OWNER");
    await expect(
      moveTaskAction("globex", { id: globexTask.id, status: "DONE" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Organization not found" },
    });
    await expect(tenantPage("globex", "task:read")).rejects.toThrow();
    await expectGlobexUntouched();
  });

  it("board filters never reveal other organizations' tasks", async () => {
    await expect(
      listProjectTasks(
        getTenantDb(acme.id),
        project.id,
        taskBoardQuery.parse({ q: "secret", assignee: outsider.userId }),
      ),
    ).resolves.toEqual({ tasks: [], truncated: false });
  });

  it("a Globex member cannot reach Acme tasks", async () => {
    const acmeTask = await seedTask(acme.id, project.id, { title: "Acme task" });
    actAs(outsider.cookie);
    await expect(moveTaskAction("globex", { id: acmeTask.id, status: "DONE" })).resolves.toEqual(
      taskNotFound,
    );
    await expect(
      assignTaskAction("globex", { id: acmeTask.id, assigneeUserId: outsider.userId }),
    ).resolves.toEqual(taskNotFound);
  });
});

describe("query efficiency", () => {
  it("loads the board with assignee names in a constant number of queries (no N+1)", async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { createTenantDb } = await import("@/server/tenancy/tenant-db");

    const statements: string[] = [];
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      log: [{ emit: "event", level: "query" }],
    });
    counting.$on("query", (event) => statements.push(event.query));
    const db = createTenantDb(counting, acme.id);

    async function queriesFor(taskCount: number) {
      await getDb().task.deleteMany({ where: { projectId: project.id } });
      for (let index = 0; index < taskCount; index++) {
        await seedTask(acme.id, project.id, {
          title: `T${index}`,
          assigneeUserId: index % 2 ? members.MEMBER.userId : members.MANAGER.userId,
        });
      }
      statements.length = 0;
      const { tasks } = await listProjectTasks(db, project.id);
      expect(tasks).toHaveLength(taskCount);
      expect(tasks.every((task) => task.assignee?.membership.user.name === "Test User")).toBe(true);
      return statements.length;
    }

    try {
      const few = await queriesFor(2);
      const many = await queriesFor(30);
      expect(many).toBe(few);
      expect(few).toBeLessThanOrEqual(5);
    } finally {
      await counting.$disconnect();
    }
  });
});
