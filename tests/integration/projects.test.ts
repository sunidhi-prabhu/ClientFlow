import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addProjectMemberAction,
  archiveProjectAction,
  createProjectAction,
  removeProjectMemberAction,
  restoreProjectAction,
  setProjectProgressAction,
  setProjectStatusAction,
  updateProjectAction,
} from "@/app/o/[orgSlug]/projects/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { listProjectsQuery, parseListProjectsQuery } from "@/lib/validation/project";
import {
  getProject,
  listAddableMembers,
  listAssignableClients,
  listProjectActivity,
  listProjects,
} from "@/server/projects/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantPage } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

type Member = { userId: string; cookie: string };

let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: Member;
let acmeClient: { id: string };
let globexClient: { id: string };

/** Create/update actions end in redirect() on success. */
async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

function as(role: MembershipRole) {
  actAs(members[role].cookie);
}

function seedProject(
  organizationId: string,
  data: {
    name: string;
    clientId?: string | null;
    status?: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    dueDate?: Date;
    description?: string;
  },
) {
  return getDb().project.create({ data: { organizationId, ...data } });
}

const query = (input: Record<string, unknown> = {}) => listProjectsQuery.parse(input);
const activityTypes = async (organizationId: string, projectId: string) =>
  (await listProjectActivity(getTenantDb(organizationId), projectId)).map((item) => item.type);

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
  outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
  acmeClient = await getDb().client.create({
    data: { organizationId: acme.id, name: "Wayne Enterprises" },
  });
  globexClient = await getDb().client.create({
    data: { organizationId: globex.id, name: "Globex client" },
  });
});

describe("create", () => {
  it("creates a project for a client of the organization, with all fields and a CREATED activity", async () => {
    as("MANAGER");
    const { redirectedTo } = await runRedirecting(
      createProjectAction("acme", {
        name: "  Website redesign ",
        description: "New marketing site",
        clientId: acmeClient.id,
        status: "ACTIVE",
        priority: "HIGH",
        startDate: "2026-10-01",
        dueDate: "2026-12-15",
        progress: "25",
        organizationId: globex.id,
      }),
    );

    const project = await getDb().project.findFirstOrThrow();
    expect(redirectedTo).toBe(`/o/acme/projects/${project.id}`);
    expect(project).toMatchObject({
      organizationId: acme.id,
      clientId: acmeClient.id,
      name: "Website redesign",
      description: "New marketing site",
      status: "ACTIVE",
      priority: "HIGH",
      startDate: new Date("2026-10-01T00:00:00Z"),
      dueDate: new Date("2026-12-15T00:00:00Z"),
      progress: 25,
      archivedAt: null,
    });
    await expect(getDb().projectActivity.findMany()).resolves.toEqual([
      expect.objectContaining({ type: "CREATED", actorUserId: members.MANAGER.userId }),
    ]);
  });

  it("creates a project without a client, with defaults", async () => {
    as("OWNER");
    await runRedirecting(createProjectAction("acme", { name: "Internal tooling", clientId: "" }));
    await expect(getDb().project.findFirstOrThrow()).resolves.toMatchObject({
      clientId: null,
      status: "PLANNING",
      priority: "MEDIUM",
      progress: 0,
      startDate: null,
      dueDate: null,
    });
  });

  it("validates fields, including date order and progress range", async () => {
    as("OWNER");
    const { result } = await runRedirecting(
      createProjectAction("acme", {
        name: "",
        startDate: "2026-12-01",
        dueDate: "2026-11-01",
        progress: "101",
        status: "ARCHIVED",
        priority: "CRITICAL",
      }),
    );
    const paths = (result as { error: { details: { path: string }[] } }).error.details
      .map((detail) => detail.path)
      .sort();
    expect(paths).toEqual(["name", "priority", "progress", "status"]);
    // Date order is checked once the fields themselves are valid.
    const second = await runRedirecting(
      createProjectAction("acme", { name: "X", startDate: "2026-12-01", dueDate: "2026-11-01" }),
    );
    expect(second.result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", details: [{ path: "dueDate" }] },
    });
    await expect(getDb().project.count()).resolves.toBe(0);
  });
});

describe("client association", () => {
  it("rejects a client from another organization exactly like a nonexistent one", async () => {
    as("OWNER");
    const foreign = await runRedirecting(
      createProjectAction("acme", { name: "Sneaky", clientId: globexClient.id }),
    );
    const missing = await runRedirecting(
      createProjectAction("acme", { name: "Sneaky", clientId: "does-not-exist" }),
    );
    const expected = {
      ok: false,
      error: { code: "NOT_FOUND", message: "Referenced resource not found" },
    };
    expect(foreign.result).toEqual(expected);
    expect(missing.result).toEqual(expected);
    await expect(getDb().project.count()).resolves.toBe(0);
  });

  it("rejects re-assigning a project to a foreign client", async () => {
    const project = await seedProject(acme.id, { name: "P", clientId: acmeClient.id });
    as("OWNER");
    const { result } = await runRedirecting(
      updateProjectAction("acme", { id: project.id, name: "P", clientId: globexClient.id }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ clientId: acmeClient.id });
  });

  it("rejects assigning an archived client, but keeps an existing archived assignment on edit", async () => {
    const archived = await getDb().client.create({
      data: { organizationId: acme.id, name: "Old client", status: "ARCHIVED" },
    });
    as("OWNER");
    await expect(
      runRedirecting(createProjectAction("acme", { name: "P", clientId: archived.id })),
    ).resolves.toMatchObject({ result: { ok: false, error: { code: "CONFLICT" } } });

    const project = await seedProject(acme.id, { name: "Legacy", clientId: archived.id });
    const { redirectedTo } = await runRedirecting(
      updateProjectAction("acme", { id: project.id, name: "Legacy v2", clientId: archived.id }),
    );
    expect(redirectedTo).toBeDefined();
  });

  it("can move a project to another client or remove the client", async () => {
    const other = await getDb().client.create({ data: { organizationId: acme.id, name: "Stark" } });
    const project = await seedProject(acme.id, { name: "P", clientId: acmeClient.id });
    as("OWNER");
    await runRedirecting(
      updateProjectAction("acme", { id: project.id, name: "P", clientId: other.id }),
    );
    await runRedirecting(updateProjectAction("acme", { id: project.id, name: "P", clientId: "" }));
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ clientId: null });
    const [latest, previous] = await listProjectActivity(getTenantDb(acme.id), project.id);
    expect(latest.changes).toEqual({ clientId: { from: other.id, to: null } });
    expect(previous.changes).toEqual({ clientId: { from: acmeClient.id, to: other.id } });
  });

  it("the database rejects a cross-organization client link (composite key)", async () => {
    await expect(
      getDb().project.create({
        data: { organizationId: acme.id, clientId: globexClient.id, name: "Raw" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("offers only the organization's active clients (plus the current one) as choices", async () => {
    const archived = await getDb().client.create({
      data: { organizationId: acme.id, name: "Archived client", status: "ARCHIVED" },
    });
    const db = getTenantDb(acme.id);
    await expect(listAssignableClients(db)).resolves.toEqual([
      { id: acmeClient.id, name: "Wayne Enterprises" },
    ]);
    await expect(listAssignableClients(db, archived.id)).resolves.toHaveLength(2);
  });
});

describe("retrieve", () => {
  it("returns the project with its client and members", async () => {
    const project = await seedProject(acme.id, { name: "P", clientId: acmeClient.id });
    await getDb().projectMember.create({
      data: { organizationId: acme.id, projectId: project.id, userId: members.MEMBER.userId },
    });
    await expect(getProject(getTenantDb(acme.id), project.id)).resolves.toMatchObject({
      name: "P",
      client: { id: acmeClient.id, name: "Wayne Enterprises" },
      members: [
        {
          userId: members.MEMBER.userId,
          membership: { role: "MEMBER", user: { email: "member@example.com" } },
        },
      ],
    });
  });

  it("treats another organization's project exactly like a nonexistent one (404)", async () => {
    const foreign = await seedProject(globex.id, { name: "Globex project" });
    const crossTenant = await getProject(getTenantDb(acme.id), foreign.id).catch((e: unknown) => e);
    const missing = await getProject(getTenantDb(acme.id), "nope").catch((e: unknown) => e);
    expect(crossTenant).toBeInstanceOf(NotFoundError);
    expect((crossTenant as Error).message).toBe((missing as Error).message);
    await expect(listProjectActivity(getTenantDb(acme.id), foreign.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("update, status and progress", () => {
  it("updates fields and records STATUS_CHANGED separately from other changes", async () => {
    const project = await seedProject(acme.id, { name: "Old", status: "PLANNING" });
    as("ADMIN");
    await runRedirecting(
      updateProjectAction("acme", {
        id: project.id,
        name: "New",
        description: "Confidential scope",
        status: "ACTIVE",
        priority: "URGENT",
        dueDate: "2026-11-30",
        progress: "10",
      }),
    );

    const [first, second] = await listProjectActivity(getTenantDb(acme.id), project.id);
    const byType = Object.fromEntries([first, second].map((item) => [item.type, item.changes]));
    expect(byType.STATUS_CHANGED).toEqual({ status: { from: "PLANNING", to: "ACTIVE" } });
    expect(byType.UPDATED).toEqual({
      name: { from: "Old", to: "New" },
      priority: { from: "MEDIUM", to: "URGENT" },
      dueDate: { from: null, to: "2026-11-30" },
      progress: { from: 0, to: 10 },
      description: { from: null, to: null },
    });
    expect(JSON.stringify(byType)).not.toContain("Confidential");
  });

  it("records nothing when nothing changed", async () => {
    const project = await seedProject(acme.id, { name: "Same" });
    as("OWNER");
    await runRedirecting(updateProjectAction("acme", { id: project.id, name: "Same" }));
    await expect(getDb().projectActivity.count()).resolves.toBe(0);
  });

  it("sets the status through the dedicated action", async () => {
    const project = await seedProject(acme.id, { name: "P", status: "ACTIVE" });
    as("MANAGER");
    await expect(
      setProjectStatusAction("acme", { id: project.id, status: "ON_HOLD" }),
    ).resolves.toEqual({ ok: true, data: { id: project.id, status: "ON_HOLD" } });
    await expect(activityTypes(acme.id, project.id)).resolves.toEqual(["STATUS_CHANGED"]);
    await expect(
      setProjectStatusAction("acme", { id: project.id, status: "ARCHIVED" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("updates progress within 0-100", async () => {
    const project = await seedProject(acme.id, { name: "P" });
    as("MANAGER");
    await expect(
      setProjectProgressAction("acme", { id: project.id, progress: 60 }),
    ).resolves.toEqual({
      ok: true,
      data: { id: project.id, progress: 60 },
    });
    await expect(
      setProjectProgressAction("acme", { id: project.id, progress: 150 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("the database enforces progress and date-order CHECK constraints", async () => {
    await expect(
      getDb().project.create({ data: { organizationId: acme.id, name: "Bad", progress: 101 } }),
    ).rejects.toThrow(/Project_progress_range_check/);
    await expect(
      getDb().project.create({
        data: {
          organizationId: acme.id,
          name: "Bad",
          startDate: new Date("2026-12-01"),
          dueDate: new Date("2026-11-01"),
        },
      }),
    ).rejects.toThrow(/Project_dates_order_check/);
  });
});

describe("archive and restore", () => {
  it("archives, blocks changes while archived, and restores the previous status", async () => {
    const project = await seedProject(acme.id, { name: "Done", status: "COMPLETED" });
    as("MANAGER");

    await expect(archiveProjectAction("acme", { id: project.id })).resolves.toEqual({
      ok: true,
      data: { id: project.id, status: "ARCHIVED" },
    });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ statusBeforeArchive: "COMPLETED", archivedAt: expect.any(Date) });

    const blocked = {
      ok: false,
      error: { code: "CONFLICT", message: "Restore this project before changing it" },
    };
    await expect(
      setProjectProgressAction("acme", { id: project.id, progress: 10 }),
    ).resolves.toEqual(blocked);
    await expect(
      addProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toEqual(blocked);
    expect(
      (await runRedirecting(updateProjectAction("acme", { id: project.id, name: "X" }))).result,
    ).toEqual(blocked);
    await expect(archiveProjectAction("acme", { id: project.id })).resolves.toMatchObject({
      error: { code: "CONFLICT" },
    });

    await expect(restoreProjectAction("acme", { id: project.id })).resolves.toEqual({
      ok: true,
      data: { id: project.id, status: "COMPLETED" },
    });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({ statusBeforeArchive: null, archivedAt: null });
    await expect(activityTypes(acme.id, project.id)).resolves.toEqual(["RESTORED", "ARCHIVED"]);
  });
});

describe("project members", () => {
  let project: { id: string };
  beforeEach(async () => {
    project = await seedProject(acme.id, { name: "Team project" });
  });

  it("adds and removes an organization member, recording both", async () => {
    as("MANAGER");
    await expect(
      addProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      addProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    await expect(listAddableMembers(getTenantDb(acme.id), project.id)).resolves.not.toContainEqual(
      expect.objectContaining({ userId: members.MEMBER.userId }),
    );

    await expect(
      removeProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toMatchObject({ ok: true });
    await expect(getDb().projectMember.count()).resolves.toBe(0);
    await expect(
      removeProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const activity = await listProjectActivity(getTenantDb(acme.id), project.id);
    expect(activity.map((item) => [item.type, item.changes])).toEqual([
      ["MEMBER_REMOVED", { member: { userId: members.MEMBER.userId, name: "Test User" } }],
      ["MEMBER_ADDED", { member: { userId: members.MEMBER.userId, name: "Test User" } }],
    ]);
  });

  it("rejects a user from another organization exactly like a nonexistent user", async () => {
    as("OWNER");
    const foreign = await addProjectMemberAction("acme", {
      projectId: project.id,
      userId: outsider.userId,
    });
    const missing = await addProjectMemberAction("acme", {
      projectId: project.id,
      userId: "no-such-user",
    });
    expect(foreign).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Referenced resource not found" },
    });
    expect(missing).toEqual(foreign);
    await expect(getDb().projectMember.count()).resolves.toBe(0);
  });

  it("the database rejects a project member who is not in the organization (composite key)", async () => {
    await expect(
      getDb().projectMember.create({
        data: { organizationId: acme.id, projectId: project.id, userId: outsider.userId },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("leaving the organization removes the person from its projects", async () => {
    await getDb().projectMember.create({
      data: { organizationId: acme.id, projectId: project.id, userId: members.MEMBER.userId },
    });
    await getDb().membership.deleteMany({
      where: { organizationId: acme.id, userId: members.MEMBER.userId },
    });
    await expect(getDb().projectMember.count()).resolves.toBe(0);
  });

  it("lists only the organization's members as addable", async () => {
    const addable = await listAddableMembers(getTenantDb(acme.id), project.id);
    expect(addable.map((member) => member.email).sort()).toEqual([
      "admin@example.com",
      "manager@example.com",
      "member@example.com",
      "owner@example.com",
    ]);
  });
});

describe("list: search, filter, sort, pagination", () => {
  beforeEach(async () => {
    const stark = await getDb().client.create({
      data: { organizationId: acme.id, name: "Stark Industries" },
    });
    await seedProject(acme.id, {
      name: "Alpha",
      clientId: acmeClient.id,
      priority: "LOW",
      dueDate: new Date("2026-12-01"),
    });
    await seedProject(acme.id, {
      name: "Beta",
      clientId: stark.id,
      status: "ACTIVE",
      priority: "URGENT",
    });
    await seedProject(acme.id, {
      name: "Gamma",
      status: "COMPLETED",
      description: "Contains 50% discount",
      dueDate: new Date("2026-10-01"),
    });
    await seedProject(acme.id, { name: "Delta", status: "ARCHIVED", clientId: acmeClient.id });
    await seedProject(globex.id, { name: "Alpha", clientId: globexClient.id });
  });

  const names = async (input: Record<string, unknown>) =>
    (await listProjects(getTenantDb(acme.id), query(input))).items.map((project) => project.name);

  it("defaults to everything except archived, by name", async () => {
    await expect(names({})).resolves.toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("filters by status and by client (including 'no client')", async () => {
    await expect(names({ status: "ACTIVE" })).resolves.toEqual(["Beta"]);
    await expect(names({ status: "ARCHIVED" })).resolves.toEqual(["Delta"]);
    await expect(names({ status: "all", clientId: acmeClient.id })).resolves.toEqual([
      "Alpha",
      "Delta",
    ]);
    await expect(names({ clientId: "none" })).resolves.toEqual(["Gamma"]);
    // A foreign client id simply matches nothing.
    await expect(names({ status: "all", clientId: globexClient.id })).resolves.toEqual([]);
  });

  it("searches name, description and client name, treating input literally", async () => {
    await expect(names({ q: "stark" })).resolves.toEqual(["Beta"]);
    await expect(names({ q: "wayne", status: "all" })).resolves.toEqual(["Alpha", "Delta"]);
    await expect(names({ q: "50%" })).resolves.toEqual(["Gamma"]);
    await expect(names({ q: "%" })).resolves.toEqual(["Gamma"]);
    await expect(names({ q: "_" })).resolves.toEqual([]);
  });

  it("sorts by due date (empty last) and by priority", async () => {
    await expect(names({ sort: "due" })).resolves.toEqual(["Gamma", "Alpha", "Beta"]);
    await expect(names({ sort: "priority" })).resolves.toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("returns client names and member counts with the page, and per-status counts", async () => {
    const result = await listProjects(getTenantDb(acme.id), query({ status: "all" }));
    expect(result.items.find((item) => item.name === "Beta")).toMatchObject({
      client: { name: "Stark Industries" },
      _count: { members: 0 },
    });
    expect(result.statusCounts).toEqual({
      PLANNING: 1,
      ACTIVE: 1,
      ON_HOLD: 0,
      COMPLETED: 1,
      ARCHIVED: 1,
    });
  });

  it("paginates and clamps past the last page", async () => {
    for (let index = 0; index < 22; index++)
      await seedProject(acme.id, { name: `Bulk ${String(index).padStart(2, "0")}` });
    const db = getTenantDb(acme.id);
    await expect(listProjects(db, query({ pageSize: 10 }))).resolves.toMatchObject({
      total: 25,
      pageCount: 3,
    });
    const last = await listProjects(db, query({ pageSize: 10, page: 3 }));
    expect(last.items).toHaveLength(5);
    await expect(listProjects(db, query({ pageSize: 10, page: 50 }))).resolves.toMatchObject({
      page: 3,
    });
  });

  it("parses URL params leniently", () => {
    expect(
      parseListProjectsQuery({
        q: " x ",
        status: "DELETED",
        clientId: "",
        sort: "evil",
        page: "0",
      }),
    ).toEqual({
      q: "x",
      status: "current",
      clientId: undefined,
      sort: "name",
      page: 1,
      pageSize: 20,
    });
  });
});

describe("role/permission matrix", () => {
  const cases = [
    { name: "create", permission: "project:create" },
    { name: "update", permission: "project:update" },
    { name: "status", permission: "project:update" },
    { name: "progress", permission: "project:update" },
    { name: "add member", permission: "project:update" },
    { name: "remove member", permission: "project:update" },
    { name: "archive", permission: "project:delete" },
    { name: "restore", permission: "project:delete" },
  ] as const;

  it("uses permissions that exist in the central RBAC policy", () => {
    for (const { permission } of cases) expect(PERMISSIONS).toContain(permission);
  });

  for (const role of ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const) {
    it(`${role}`, async () => {
      const outcomes: Record<string, boolean> = {};
      const run = async (name: string, action: () => Promise<unknown>) => {
        const { result, redirectedTo } = await runRedirecting(action());
        const ok = redirectedTo !== undefined || (result as { ok: boolean }).ok;
        if (!ok) expect(result).toMatchObject({ error: { code: "FORBIDDEN" } });
        outcomes[name] = ok;
      };

      const project = await seedProject(acme.id, { name: "Matrix" });
      const archived = await seedProject(acme.id, { name: "Archived", status: "ARCHIVED" });
      await getDb().project.update({
        where: { id: archived.id },
        data: { statusBeforeArchive: "ACTIVE" },
      });
      const onProject = await seedProject(acme.id, { name: "With member" });
      await getDb().projectMember.create({
        data: { organizationId: acme.id, projectId: onProject.id, userId: members.ADMIN.userId },
      });
      as(role);

      await run("create", () => createProjectAction("acme", { name: `By ${role}` }));
      await run("update", () =>
        updateProjectAction("acme", { id: project.id, name: `Renamed by ${role}` }),
      );
      await run("status", () =>
        setProjectStatusAction("acme", { id: project.id, status: "ACTIVE" }),
      );
      await run("progress", () =>
        setProjectProgressAction("acme", { id: project.id, progress: 40 }),
      );
      await run("add member", () =>
        addProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
      );
      await run("remove member", () =>
        removeProjectMemberAction("acme", {
          projectId: onProject.id,
          userId: members.ADMIN.userId,
        }),
      );
      await run("archive", () => archiveProjectAction("acme", { id: project.id }));
      await run("restore", () => restoreProjectAction("acme", { id: archived.id }));

      expect(outcomes).toEqual(
        Object.fromEntries(
          cases.map(({ name, permission }) => [name, hasPermission(role, permission)]),
        ),
      );
      await expect(tenantPage("acme", "project:read")).resolves.toMatchObject({ allowed: true });
    });
  }

  it("MEMBER cannot change anything (data unchanged)", async () => {
    const project = await seedProject(acme.id, { name: "Read only" });
    as("MEMBER");
    await setProjectProgressAction("acme", { id: project.id, progress: 99 });
    await archiveProjectAction("acme", { id: project.id });
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: project.id } }),
    ).resolves.toMatchObject({
      progress: 0,
      status: "PLANNING",
    });
    await expect(getDb().projectActivity.count()).resolves.toBe(0);
  });
});

describe("unauthenticated access", () => {
  it("every action is rejected without a session", async () => {
    const project = await seedProject(acme.id, { name: "P" });
    actAs(undefined);
    const unauthenticated = {
      ok: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
    };

    expect((await runRedirecting(createProjectAction("acme", { name: "Anon" }))).result).toEqual(
      unauthenticated,
    );
    expect(
      (await runRedirecting(updateProjectAction("acme", { id: project.id, name: "Anon" }))).result,
    ).toEqual(unauthenticated);
    await expect(
      setProjectStatusAction("acme", { id: project.id, status: "ACTIVE" }),
    ).resolves.toEqual(unauthenticated);
    await expect(
      setProjectProgressAction("acme", { id: project.id, progress: 5 }),
    ).resolves.toEqual(unauthenticated);
    await expect(archiveProjectAction("acme", { id: project.id })).resolves.toEqual(
      unauthenticated,
    );
    await expect(
      addProjectMemberAction("acme", { projectId: project.id, userId: members.MEMBER.userId }),
    ).resolves.toEqual(unauthenticated);
    await expect(getDb().project.count()).resolves.toBe(1);
    await expect(getDb().projectActivity.count()).resolves.toBe(0);
  });
});

describe("organization isolation and IDOR/BOLA", () => {
  let foreign: { id: string };
  beforeEach(async () => {
    foreign = await seedProject(globex.id, {
      name: "Globex secret project",
      clientId: globexClient.id,
    });
    await getDb().projectMember.create({
      data: { organizationId: globex.id, projectId: foreign.id, userId: outsider.userId },
    });
  });

  async function expectForeignUntouched() {
    await expect(
      getDb().project.findUniqueOrThrow({ where: { id: foreign.id } }),
    ).resolves.toMatchObject({
      organizationId: globex.id,
      name: "Globex secret project",
      status: "PLANNING",
      progress: 0,
    });
    await expect(getDb().projectMember.count({ where: { projectId: foreign.id } })).resolves.toBe(
      1,
    );
    await expect(getDb().projectActivity.count({ where: { projectId: foreign.id } })).resolves.toBe(
      0,
    );
  }

  const notFound = { ok: false, error: { code: "NOT_FOUND", message: "Project not found" } };

  it("an OWNER of Acme cannot edit, re-status, re-progress, archive or restore a Globex project by id", async () => {
    as("OWNER");
    expect(
      (await runRedirecting(updateProjectAction("acme", { id: foreign.id, name: "Pwned" }))).result,
    ).toEqual(notFound);
    await expect(
      setProjectStatusAction("acme", { id: foreign.id, status: "COMPLETED" }),
    ).resolves.toEqual(notFound);
    await expect(
      setProjectProgressAction("acme", { id: foreign.id, progress: 100 }),
    ).resolves.toEqual(notFound);
    await expect(archiveProjectAction("acme", { id: foreign.id })).resolves.toEqual(notFound);
    await expect(restoreProjectAction("acme", { id: foreign.id })).resolves.toEqual(notFound);
    await expectForeignUntouched();
  });

  it("cannot add or remove members of a Globex project by id", async () => {
    as("OWNER");
    await expect(
      addProjectMemberAction("acme", { projectId: foreign.id, userId: members.OWNER.userId }),
    ).resolves.toEqual(notFound);
    await expect(
      removeProjectMemberAction("acme", { projectId: foreign.id, userId: outsider.userId }),
    ).resolves.toEqual(notFound);
    await expectForeignUntouched();
  });

  it("cannot act in Globex by switching the organization slug", async () => {
    as("OWNER");
    expect(
      (await runRedirecting(createProjectAction("globex", { name: "Planted" }))).result,
    ).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Organization not found" },
    });
    await expect(archiveProjectAction("globex", { id: foreign.id })).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    await expect(tenantPage("globex", "project:read")).rejects.toThrow();
    await expectForeignUntouched();
  });

  it("never lists Globex projects, clients or members", async () => {
    const db = getTenantDb(acme.id);
    const result = await listProjects(db, query({ q: "globex", status: "all" }));
    expect(result.total).toBe(0);
    await expect(listAssignableClients(db)).resolves.not.toContainEqual(
      expect.objectContaining({ id: globexClient.id }),
    );
    const acmeProject = await seedProject(acme.id, { name: "Acme project" });
    await expect(listAddableMembers(db, acmeProject.id)).resolves.not.toContainEqual(
      expect.objectContaining({ userId: outsider.userId }),
    );
  });

  it("a Globex member cannot reach Acme projects either", async () => {
    const acmeProject = await seedProject(acme.id, { name: "Acme project" });
    actAs(outsider.cookie);
    await expect(archiveProjectAction("globex", { id: acmeProject.id })).resolves.toEqual(notFound);
    await expect(
      addProjectMemberAction("globex", { projectId: acmeProject.id, userId: outsider.userId }),
    ).resolves.toEqual(notFound);
  });
});

describe("query efficiency", () => {
  it("lists projects with clients and member counts in a constant number of queries (no N+1)", async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { createTenantDb } = await import("@/server/tenancy/tenant-db");

    // A separate client that reports every SQL statement it sends.
    const statements: string[] = [];
    const counting = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      log: [{ emit: "event", level: "query" }],
    });
    counting.$on("query", (event) => statements.push(event.query));
    const db = createTenantDb(counting, acme.id);

    async function queriesFor(projectCount: number) {
      await getDb().project.deleteMany({ where: { organizationId: acme.id } });
      for (let index = 0; index < projectCount; index++) {
        const project = await seedProject(acme.id, { name: `P${index}`, clientId: acmeClient.id });
        await getDb().projectMember.create({
          data: { organizationId: acme.id, projectId: project.id, userId: members.MEMBER.userId },
        });
      }
      statements.length = 0;
      const result = await listProjects(db, query({ pageSize: 50 }));
      expect(result.items).toHaveLength(projectCount);
      expect(result.items.every((item) => item.client?.name === "Wayne Enterprises")).toBe(true);
      expect(result.items.every((item) => item._count.members === 1)).toBe(true);
      return statements.length;
    }

    try {
      const few = await queriesFor(3);
      const many = await queriesFor(25);
      expect(many).toBe(few);
      expect(few).toBeLessThanOrEqual(5);
    } finally {
      await counting.$disconnect();
    }
  });
});
