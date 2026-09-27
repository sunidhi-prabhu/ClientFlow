import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveClientAction,
  createClientAction,
  restoreClientAction,
  updateClientAction,
} from "@/app/o/[orgSlug]/clients/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { listClientsQuery, parseListClientsQuery } from "@/lib/validation/client";
import {
  getClient,
  listClientActivity,
  listClientProjects,
  listClients,
} from "@/server/clients/service";
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

/** Run a create/update action: success ends in redirect(), failure returns a result. */
async function runRedirecting(action: Promise<unknown>) {
  try {
    return { result: await action, redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

async function createAs(role: MembershipRole, input: Record<string, unknown>) {
  actAs(members[role].cookie);
  return runRedirecting(createClientAction("acme", input));
}

/** Create a client in `organizationId` directly (fixture data). */
function seedClient(
  organizationId: string,
  data: {
    name: string;
    company?: string;
    email?: string;
    status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  },
) {
  return getDb().client.create({ data: { organizationId, ...data } });
}

const query = (input: Record<string, unknown> = {}) => listClientsQuery.parse(input);

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
});

describe("create", () => {
  it("creates a client in the caller's organization, normalizes input, and records activity", async () => {
    const { redirectedTo } = await createAs("MANAGER", {
      name: "  Wayne Enterprises ",
      company: "Wayne Corp",
      email: "Bruce@Wayne.COM",
      phone: "+1 (555) 010-2000",
      address: "1007 Mountain Drive\nGotham",
      notes: "Prefers email.",
      company_extra: "ignored",
    });

    const client = await getDb().client.findFirstOrThrow();
    expect(redirectedTo).toBe(`/o/acme/clients/${client.id}`);
    expect(client).toMatchObject({
      organizationId: acme.id,
      name: "Wayne Enterprises",
      company: "Wayne Corp",
      email: "bruce@wayne.com",
      phone: "+1 (555) 010-2000",
      address: "1007 Mountain Drive\nGotham",
      notes: "Prefers email.",
      status: "ACTIVE",
      archivedAt: null,
    });
    await expect(getDb().clientActivity.findMany()).resolves.toEqual([
      expect.objectContaining({
        organizationId: acme.id,
        clientId: client.id,
        actorUserId: members.MANAGER.userId,
        type: "CREATED",
      }),
    ]);
  });

  it("stores empty optional fields as null", async () => {
    await createAs("OWNER", { name: "Minimal", company: "", email: "", phone: " ", notes: "" });
    await expect(getDb().client.findFirstOrThrow()).resolves.toMatchObject({
      company: null,
      email: null,
      phone: null,
      notes: null,
    });
  });

  it("rejects invalid input with field errors and creates nothing", async () => {
    const { result } = await createAs("OWNER", {
      name: "",
      email: "not-an-email",
      phone: "call me",
      status: "ARCHIVED",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    const paths = (result as { error: { details: { path: string }[] } }).error.details.map(
      (detail) => detail.path,
    );
    expect(paths.sort()).toEqual(["email", "name", "phone", "status"]);
    await expect(getDb().client.count()).resolves.toBe(0);
  });

  it("ignores an organizationId in the input: the client is created in the caller's organization", async () => {
    await createAs("OWNER", { name: "Planted", organizationId: globex.id });
    await expect(getDb().client.count({ where: { organizationId: globex.id } })).resolves.toBe(0);
    await expect(getDb().client.count({ where: { organizationId: acme.id } })).resolves.toBe(1);
  });
});

describe("retrieve", () => {
  it("returns a client of the organization", async () => {
    const client = await seedClient(acme.id, { name: "Acme client" });
    await expect(getClient(getTenantDb(acme.id), client.id)).resolves.toMatchObject({
      id: client.id,
      name: "Acme client",
    });
  });

  it("treats another organization's client exactly like a nonexistent one (404)", async () => {
    const foreign = await seedClient(globex.id, { name: "Globex client" });
    const crossTenant = await getClient(getTenantDb(acme.id), foreign.id).catch((e: unknown) => e);
    const missing = await getClient(getTenantDb(acme.id), "does-not-exist").catch(
      (e: unknown) => e,
    );

    expect(crossTenant).toBeInstanceOf(NotFoundError);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect((crossTenant as Error).message).toBe((missing as Error).message);
  });

  it("lists the client's projects and activity only within the organization", async () => {
    const client = await seedClient(acme.id, { name: "With projects" });
    await getDb().project.create({
      data: { organizationId: acme.id, clientId: client.id, name: "Website" },
    });
    await expect(listClientProjects(getTenantDb(acme.id), client.id)).resolves.toEqual([
      expect.objectContaining({ name: "Website" }),
    ]);
    await expect(listClientProjects(getTenantDb(globex.id), client.id)).resolves.toEqual([]);
    await expect(listClientActivity(getTenantDb(globex.id), client.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("update", () => {
  it("updates fields and records only the changed ones in the activity history", async () => {
    await createAs("OWNER", { name: "Old name", email: "old@example.com", notes: "old" });
    const client = await getDb().client.findFirstOrThrow();

    actAs(members.ADMIN.cookie);
    const { redirectedTo } = await runRedirecting(
      updateClientAction("acme", {
        id: client.id,
        name: "New name",
        email: "old@example.com",
        notes: "new secret-ish note",
        status: "INACTIVE",
      }),
    );

    expect(redirectedTo).toBe(`/o/acme/clients/${client.id}`);
    await expect(
      getDb().client.findUniqueOrThrow({ where: { id: client.id } }),
    ).resolves.toMatchObject({
      name: "New name",
      status: "INACTIVE",
      notes: "new secret-ish note",
    });
    const [latest] = await listClientActivity(getTenantDb(acme.id), client.id);
    expect(latest).toMatchObject({
      type: "UPDATED",
      actor: { email: "admin@example.com" },
      changes: {
        name: { from: "Old name", to: "New name" },
        status: { from: "ACTIVE", to: "INACTIVE" },
        notes: { from: null, to: null },
      },
    });
    // Note content is never copied into the history.
    expect(JSON.stringify(latest.changes)).not.toContain("secret-ish");
  });

  it("records nothing when nothing changed", async () => {
    await createAs("OWNER", { name: "Same" });
    const client = await getDb().client.findFirstOrThrow();
    actAs(members.OWNER.cookie);
    await runRedirecting(updateClientAction("acme", { id: client.id, name: "Same" }));
    await expect(getDb().clientActivity.count()).resolves.toBe(1);
  });

  it("cannot set ARCHIVED through an update", async () => {
    const client = await seedClient(acme.id, { name: "Client" });
    actAs(members.OWNER.cookie);
    const { result } = await runRedirecting(
      updateClientAction("acme", { id: client.id, name: "Client", status: "ARCHIVED" }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("refuses to edit an archived client (409) until it is restored", async () => {
    const client = await seedClient(acme.id, { name: "Old", status: "ARCHIVED" });
    actAs(members.OWNER.cookie);
    const { result } = await runRedirecting(
      updateClientAction("acme", { id: client.id, name: "Changed" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "Restore this client before editing it" },
    });
  });
});

describe("archive and restore", () => {
  it("archives a client, hides it from the default list, and records the change", async () => {
    const client = await seedClient(acme.id, { name: "To archive", status: "INACTIVE" });
    actAs(members.MANAGER.cookie);

    await expect(archiveClientAction("acme", { id: client.id })).resolves.toEqual({
      ok: true,
      data: { id: client.id, status: "ARCHIVED" },
    });
    const archived = await getDb().client.findUniqueOrThrow({ where: { id: client.id } });
    expect(archived.archivedAt).toBeInstanceOf(Date);

    const db = getTenantDb(acme.id);
    await expect(listClients(db, query())).resolves.toMatchObject({ total: 0 });
    await expect(listClients(db, query({ status: "ARCHIVED" }))).resolves.toMatchObject({
      total: 1,
    });
    const [latest] = await listClientActivity(db, client.id);
    expect(latest).toMatchObject({
      type: "ARCHIVED",
      changes: { status: { from: "INACTIVE", to: "ARCHIVED" } },
    });
  });

  it("archiving twice is a 409, restoring makes the client ACTIVE again", async () => {
    const client = await seedClient(acme.id, { name: "Client" });
    actAs(members.OWNER.cookie);
    await archiveClientAction("acme", { id: client.id });

    await expect(archiveClientAction("acme", { id: client.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    await expect(restoreClientAction("acme", { id: client.id })).resolves.toEqual({
      ok: true,
      data: { id: client.id, status: "ACTIVE" },
    });
    await expect(
      getDb().client.findUniqueOrThrow({ where: { id: client.id } }),
    ).resolves.toMatchObject({ status: "ACTIVE", archivedAt: null });
    await expect(restoreClientAction("acme", { id: client.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });
});

describe("search, filter, sort and pagination", () => {
  beforeEach(async () => {
    await seedClient(acme.id, { name: "Alpha Studio", company: "Alpha LLC", email: "hi@alpha.io" });
    await seedClient(acme.id, { name: "Beta Labs", company: "Northwind", email: "team@beta.dev" });
    await seedClient(acme.id, {
      name: "Gamma",
      company: null as never,
      email: "ops@northwind.com",
      status: "INACTIVE",
    });
    await seedClient(acme.id, { name: "Delta (old)", status: "ARCHIVED" });
    // Same names in another organization must never appear.
    await seedClient(globex.id, { name: "Alpha Studio", company: "Northwind" });
  });

  const names = async (input: Record<string, unknown>) =>
    (await listClients(getTenantDb(acme.id), query(input))).items.map((client) => client.name);

  it("defaults to active and inactive clients, sorted by name", async () => {
    await expect(names({})).resolves.toEqual(["Alpha Studio", "Beta Labs", "Gamma"]);
  });

  it("filters by status", async () => {
    await expect(names({ status: "ACTIVE" })).resolves.toEqual(["Alpha Studio", "Beta Labs"]);
    await expect(names({ status: "INACTIVE" })).resolves.toEqual(["Gamma"]);
    await expect(names({ status: "ARCHIVED" })).resolves.toEqual(["Delta (old)"]);
    await expect(names({ status: "all" })).resolves.toHaveLength(4);
  });

  it("searches name, company and email case-insensitively", async () => {
    await expect(names({ q: "ALPHA" })).resolves.toEqual(["Alpha Studio"]);
    await expect(names({ q: "northwind" })).resolves.toEqual(["Beta Labs", "Gamma"]);
    await expect(names({ q: "beta.dev" })).resolves.toEqual(["Beta Labs"]);
    await expect(names({ q: "zzz" })).resolves.toEqual([]);
  });

  it("combines search with status and reports per-status counts for the search", async () => {
    const result = await listClients(
      getTenantDb(acme.id),
      query({ q: "northwind", status: "INACTIVE" }),
    );
    expect(result.items.map((client) => client.name)).toEqual(["Gamma"]);
    expect(result.statusCounts).toEqual({ ACTIVE: 1, INACTIVE: 1, ARCHIVED: 0 });
  });

  it("treats search input as data, not a pattern", async () => {
    await expect(names({ q: "%" })).resolves.toEqual([]);
    await expect(names({ q: "_" })).resolves.toEqual([]);
    await expect(names({ q: "(old)", status: "all" })).resolves.toEqual(["Delta (old)"]);
    await seedClient(acme.id, { name: "100% Design" });
    await seedClient(acme.id, { name: "1000 Design" });
    await seedClient(acme.id, { name: "Back\\slash Co" });
    await expect(names({ q: "100%" })).resolves.toEqual(["100% Design"]);
    await expect(names({ q: "back\\" })).resolves.toEqual(["Back\\slash Co"]);
  });

  it("sorts by most recently updated", async () => {
    const beta = await getDb().client.findFirstOrThrow({ where: { name: "Beta Labs" } });
    await getDb().client.update({ where: { id: beta.id }, data: { phone: "123" } });
    await expect(names({ sort: "updated" })).resolves.toEqual(
      expect.arrayContaining(["Beta Labs"]),
    );
    expect((await names({ sort: "updated" }))[0]).toBe("Beta Labs");
  });

  it("paginates with totals and clamps pages past the end", async () => {
    for (let index = 0; index < 22; index++) {
      await seedClient(acme.id, { name: `Client ${String(index).padStart(2, "0")}` });
    }
    const db = getTenantDb(acme.id);

    const first = await listClients(db, query({ pageSize: 10 }));
    expect(first).toMatchObject({ total: 25, page: 1, pageSize: 10, pageCount: 3 });
    expect(first.items).toHaveLength(10);

    const last = await listClients(db, query({ pageSize: 10, page: 3 }));
    expect(last.items).toHaveLength(5);

    const beyond = await listClients(db, query({ pageSize: 10, page: 99 }));
    expect(beyond.page).toBe(3);
    expect(beyond.items.map((client) => client.id)).toEqual(last.items.map((client) => client.id));

    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      for (const client of (await listClients(db, query({ pageSize: 10, page }))).items) {
        seen.add(client.id);
      }
    }
    expect(seen.size).toBe(25);
  });

  it("parses URL search params leniently", () => {
    expect(
      parseListClientsQuery({
        q: ["  acme  ", "x"],
        status: "bogus",
        sort: "evil",
        page: "-3",
        pageSize: "5000",
      }),
    ).toEqual({ q: "acme", status: "current", sort: "name", page: 1, pageSize: 20 });
  });
});

describe("role-based authorization", () => {
  const expectations: Record<
    MembershipRole,
    { create: boolean; update: boolean; archive: boolean }
  > = {
    OWNER: { create: true, update: true, archive: true },
    ADMIN: { create: true, update: true, archive: true },
    MANAGER: { create: true, update: true, archive: true },
    MEMBER: { create: false, update: false, archive: false },
  };

  it.each(Object.entries(expectations))("%s", async (role, allowed) => {
    const client = await seedClient(acme.id, { name: "Existing" });

    const created = await createAs(role as MembershipRole, { name: `By ${role}` });
    expect(created.redirectedTo !== undefined).toBe(allowed.create);
    if (!allowed.create) expect(created.result).toMatchObject({ error: { code: "FORBIDDEN" } });

    actAs(members[role as MembershipRole].cookie);
    const updated = await runRedirecting(
      updateClientAction("acme", { id: client.id, name: `Renamed by ${role}` }),
    );
    expect(updated.redirectedTo !== undefined).toBe(allowed.update);

    const archived = await archiveClientAction("acme", { id: client.id });
    expect(archived.ok).toBe(allowed.archive);
    if (!allowed.archive) expect(archived).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("MEMBER can read clients (pages), but writes leave data unchanged", async () => {
    const client = await seedClient(acme.id, { name: "Read only" });
    actAs(members.MEMBER.cookie);

    const page = await tenantPage("acme", "client:read");
    expect(page.allowed).toBe(true);
    await expect(tenantPage("acme", "client:create")).resolves.toMatchObject({ allowed: false });

    await runRedirecting(updateClientAction("acme", { id: client.id, name: "Hacked" }));
    await expect(
      getDb().client.findUniqueOrThrow({ where: { id: client.id } }),
    ).resolves.toMatchObject({
      name: "Read only",
      status: "ACTIVE",
    });
  });

  it("unauthenticated requests are rejected", async () => {
    const client = await seedClient(acme.id, { name: "Client" });
    actAs(undefined);
    const { result } = await runRedirecting(createClientAction("acme", { name: "Anon" }));
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    await expect(archiveClientAction("acme", { id: client.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    await expect(getDb().client.count()).resolves.toBe(1);
  });
});

describe("organization isolation and IDOR/BOLA", () => {
  let foreign: { id: string };
  beforeEach(async () => {
    foreign = await seedClient(globex.id, {
      name: "Globex secret client",
      email: "ceo@globex.com",
    });
  });

  async function expectForeignUntouched() {
    await expect(
      getDb().client.findUniqueOrThrow({ where: { id: foreign.id } }),
    ).resolves.toMatchObject({
      organizationId: globex.id,
      name: "Globex secret client",
      status: "ACTIVE",
    });
    await expect(getDb().clientActivity.count({ where: { clientId: foreign.id } })).resolves.toBe(
      0,
    );
  }

  it("an OWNER of Acme cannot update a Globex client by its id (404)", async () => {
    actAs(members.OWNER.cookie);
    const { result } = await runRedirecting(
      updateClientAction("acme", { id: foreign.id, name: "Pwned" }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Client not found" },
    });
    await expectForeignUntouched();
  });

  it("cannot archive or restore a Globex client by its id (404)", async () => {
    actAs(members.OWNER.cookie);
    await expect(archiveClientAction("acme", { id: foreign.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    await getDb().client.update({ where: { id: foreign.id }, data: { status: "ARCHIVED" } });
    await expect(restoreClientAction("acme", { id: foreign.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("cannot act in Globex by switching the organization slug", async () => {
    actAs(members.OWNER.cookie);
    const { result } = await runRedirecting(createClientAction("globex", { name: "Planted" }));
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    await expect(archiveClientAction("globex", { id: foreign.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    await expectForeignUntouched();
  });

  it("never lists or finds another organization's clients", async () => {
    const result = await listClients(getTenantDb(acme.id), query({ q: "globex", status: "all" }));
    expect(result.total).toBe(0);
    expect(result.statusCounts).toEqual({ ACTIVE: 0, INACTIVE: 0, ARCHIVED: 0 });
  });

  it("a Globex member cannot reach Acme clients either", async () => {
    const acmeClient = await seedClient(acme.id, { name: "Acme client" });
    actAs(outsider.cookie);
    await expect(archiveClientAction("globex", { id: acmeClient.id })).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    await expect(tenantPage("acme", "client:read")).rejects.toThrow();
  });

  it("activity rows cannot point at another organization's client (composite key)", async () => {
    await expect(
      getDb().clientActivity.create({
        data: { organizationId: acme.id, clientId: foreign.id, type: "UPDATED" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
