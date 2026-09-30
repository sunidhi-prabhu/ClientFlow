import pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  archiveClientAction,
  createClientAction,
  restoreClientAction,
  updateClientAction,
} from "@/app/o/[orgSlug]/clients/actions";
import {
  archiveProjectAction,
  createProjectAction,
  restoreProjectAction,
} from "@/app/o/[orgSlug]/projects/actions";
import { type BillingPlan, type SubscriptionStatus } from "@/generated/prisma/enums";
import { PLANS } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { getUsage } from "@/server/billing/limits";
import { createOrganization } from "@/server/organizations/bootstrap";
import { getTenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
let manager: { userId: string; cookie: string };
let outsider: { userId: string; cookie: string };

/** Run a create action: success ends in redirect(), failure returns a result. */
async function run(action: Promise<unknown>) {
  try {
    return (await action) as {
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { ok: true as const, redirectedTo: digest.split(";")[2] };
  }
}

const createClient = (name: string, extra: Record<string, unknown> = {}) =>
  run(createClientAction("acme", { name, ...extra }));
const createProject = (name: string, extra: Record<string, unknown> = {}) =>
  run(
    createProjectAction("acme", {
      name,
      status: "ACTIVE",
      priority: "MEDIUM",
      progress: "0",
      ...extra,
    }),
  );

function seedClients(
  organizationId: string,
  count: number,
  status: "ACTIVE" | "ARCHIVED" = "ACTIVE",
) {
  return getDb().client.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      organizationId,
      name: `Seed ${status} ${index}`,
      status,
      archivedAt: status === "ARCHIVED" ? new Date() : null,
    })),
  });
}

function seedProjects(
  organizationId: string,
  count: number,
  status: "ACTIVE" | "ARCHIVED" = "ACTIVE",
) {
  return getDb().project.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      organizationId,
      name: `Seed ${status} ${index}`,
      status,
      statusBeforeArchive: status === "ARCHIVED" ? "ACTIVE" : null,
      archivedAt: status === "ARCHIVED" ? new Date() : null,
    })),
  });
}

/** Billing state as the webhook sync would store it (fixture). */
function setPlan(organizationId: string, plan: BillingPlan, status: SubscriptionStatus = "ACTIVE") {
  const data = {
    plan,
    status,
    interval: "MONTH" as const,
    stripeCustomerId: `cus_${organizationId}`,
    stripeSubscriptionId: `sub_${organizationId}`,
  };
  return getDb().subscription.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
}

const activeClients = (organizationId: string) =>
  getDb().client.count({ where: { organizationId, status: { not: "ARCHIVED" } } });
const activeProjects = (organizationId: string) =>
  getDb().project.count({ where: { organizationId, status: { not: "ARCHIVED" } } });

beforeEach(async () => {
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
  manager = await createVerifiedUser("manager@example.com");
  await getDb().membership.create({
    data: { organizationId: acme.id, userId: manager.userId, role: "MANAGER" },
  });
  outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
  actAs(manager.cookie);
});

describe("Free plan (default for new organizations)", () => {
  it("has no billing row and allows exactly 5 clients", async () => {
    expect(await getDb().subscription.count()).toBe(0);
    for (let index = 1; index <= 5; index++) {
      expect(await createClient(`Client ${index}`)).toMatchObject({ ok: true });
    }
    const sixth = await createClient("Client 6");
    expect(sixth).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "You've reached your 5-client limit. Upgrade your plan to add more clients.",
        details: { reason: "plan_limit", resource: "clients", limit: 5, used: 5 },
      },
    });
    expect(await activeClients(acme.id)).toBe(5);
  });

  it("allows exactly 5 projects", async () => {
    await seedProjects(acme.id, 4);
    expect(await createProject("Fifth")).toMatchObject({ ok: true });
    const sixth = await createProject("Sixth");
    expect(sixth).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "You've reached your 5-project limit. Upgrade your plan to add more projects.",
      },
    });
    expect(await activeProjects(acme.id)).toBe(5);
  });

  it("does not count archived clients or projects", async () => {
    await seedClients(acme.id, 4);
    await seedClients(acme.id, 10, "ARCHIVED");
    await seedProjects(acme.id, 4);
    await seedProjects(acme.id, 10, "ARCHIVED");
    expect(await createClient("Fifth")).toMatchObject({ ok: true });
    expect(await createProject("Fifth")).toMatchObject({ ok: true });
    expect(await createClient("Sixth")).toMatchObject({ ok: false });
    expect(await createProject("Sixth")).toMatchObject({ ok: false });
  });

  it("frees a slot when a record is archived", async () => {
    await seedClients(acme.id, 5);
    expect(await createClient("Blocked")).toMatchObject({ ok: false });
    const [first] = await getDb().client.findMany({ where: { organizationId: acme.id }, take: 1 });
    expect(await archiveClientAction("acme", { id: first.id })).toMatchObject({ ok: true });
    expect(await createClient("Now allowed")).toMatchObject({ ok: true });
  });

  it("refuses restores that would exceed the limit (no create/archive/restore bypass)", async () => {
    await seedClients(acme.id, 5);
    await seedClients(acme.id, 1, "ARCHIVED");
    await seedProjects(acme.id, 5);
    await seedProjects(acme.id, 1, "ARCHIVED");
    const archivedClient = await getDb().client.findFirstOrThrow({ where: { status: "ARCHIVED" } });
    const archivedProject = await getDb().project.findFirstOrThrow({
      where: { status: "ARCHIVED" },
    });

    expect(await restoreClientAction("acme", { id: archivedClient.id })).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "You've reached your 5-client limit. Upgrade your plan to restore this client.",
      },
    });
    expect(await restoreProjectAction("acme", { id: archivedProject.id })).toMatchObject({
      ok: false,
      error: {
        message: "You've reached your 5-project limit. Upgrade your plan to restore this project.",
      },
    });
    expect(await activeClients(acme.id)).toBe(5);
    expect(await activeProjects(acme.id)).toBe(5);

    // Archiving another one makes room for the restore.
    const other = await getDb().project.findFirstOrThrow({ where: { status: "ACTIVE" } });
    expect(await archiveProjectAction("acme", { id: other.id })).toMatchObject({ ok: true });
    expect(await restoreProjectAction("acme", { id: archivedProject.id })).toMatchObject({
      ok: true,
    });
  });

  it("keeps editing existing records at the limit", async () => {
    await seedClients(acme.id, 5);
    const client = await getDb().client.findFirstOrThrow({ where: { organizationId: acme.id } });
    const result = await run(
      updateClientAction("acme", { id: client.id, name: "Renamed at limit" }),
    );
    expect(result).toMatchObject({ ok: true });
    expect((await getDb().client.findUniqueOrThrow({ where: { id: client.id } })).name).toBe(
      "Renamed at limit",
    );
  });
});

describe("paid plans", () => {
  it.each(["STARTER", "GROWTH", "PROFESSIONAL", "AGENCY"] as const)(
    "%s allows exactly its limit of clients and projects",
    async (plan) => {
      const limit = PLANS[plan].clientLimit;
      await setPlan(acme.id, plan);
      await seedClients(acme.id, limit - 1);
      await seedProjects(acme.id, limit - 1);
      expect(await createClient("Last client")).toMatchObject({ ok: true });
      expect(await createProject("Last project")).toMatchObject({ ok: true });
      expect(await createClient("One too many")).toMatchObject({
        ok: false,
        error: { details: { resource: "clients", limit, used: limit } },
      });
      expect(await createProject("One too many")).toMatchObject({
        ok: false,
        error: { details: { resource: "projects", limit, used: limit } },
      });
      expect(await activeClients(acme.id)).toBe(limit);
      expect(await activeProjects(acme.id)).toBe(limit);
    },
  );

  it("fall back to Free limits when the subscription is not in good standing", async () => {
    await seedClients(acme.id, 5);
    for (const status of [
      "UNPAID",
      "CANCELED",
      "INCOMPLETE",
      "INCOMPLETE_EXPIRED",
      "PAUSED",
    ] as const) {
      await setPlan(acme.id, "AGENCY", status);
      expect(await createClient(`Blocked while ${status}`)).toMatchObject({ ok: false });
    }
    // PAST_DUE keeps the plan while Stripe retries the payment.
    await setPlan(acme.id, "AGENCY", "PAST_DUE");
    expect(await createClient("Allowed while retrying")).toMatchObject({ ok: true });
  });
});

describe("downgrades", () => {
  it("keep every record usable and only block new ones until the organization upgrades again", async () => {
    await setPlan(acme.id, "GROWTH");
    await seedClients(acme.id, 12);
    await seedProjects(acme.id, 9);
    // Downgraded to Free (subscription cancelled): 12/5 clients, 9/5 projects.
    await setPlan(acme.id, "GROWTH", "CANCELED");

    const usage = await getUsage(getTenantDb(acme.id), "clients");
    expect(usage).toMatchObject({ plan: "FREE", used: 12, limit: 5, overBy: 7, atLimit: true });
    expect(await activeClients(acme.id)).toBe(12); // nothing deleted or archived
    expect(await activeProjects(acme.id)).toBe(9);

    const client = await getDb().client.findFirstOrThrow({ where: { organizationId: acme.id } });
    expect(
      await run(updateClientAction("acme", { id: client.id, name: "Still editable" })),
    ).toMatchObject({
      ok: true,
    });
    expect(await createClient("Over the limit")).toMatchObject({ ok: false });
    expect(await createProject("Over the limit")).toMatchObject({ ok: false });

    // Archiving down to 5 is not enough to add (5/5); to 4 is.
    await setPlan(acme.id, "GROWTH", "ACTIVE");
    expect(await createClient("After upgrading again")).toMatchObject({ ok: true });
    expect(await activeClients(acme.id)).toBe(13);
  });
});

describe("request tampering", () => {
  it("ignores plan, limit and organization values in the payload", async () => {
    await seedClients(acme.id, 5);
    const forged = {
      organizationId: globex.id,
      plan: "AGENCY",
      clientLimit: 1000,
      limit: 1000,
      subscription: { plan: "AGENCY", status: "ACTIVE" },
    };
    expect(await createClient("Forged", forged)).toMatchObject({
      ok: false,
      error: { details: { limit: 5 } },
    });
    expect(await createProject("Forged", forged)).toMatchObject({ ok: true }); // 0/5 projects
    const project = await getDb().project.findFirstOrThrow({ where: { name: "Forged" } });
    expect(project.organizationId).toBe(acme.id);
    expect(await getDb().subscription.count()).toBe(0);
  });

  it("an organization's plan and usage never affect another organization", async () => {
    await setPlan(globex.id, "AGENCY");
    await seedClients(acme.id, 5);
    expect(await createClient("Acme is still Free")).toMatchObject({ ok: false });

    await seedClients(globex.id, 5);
    actAs(outsider.cookie);
    expect(await run(createClientAction("globex", { name: "Globex has Agency" }))).toMatchObject({
      ok: true,
    });
    // A member of Globex cannot use Globex's plan in Acme (not a member there: 404).
    expect(await run(createClientAction("acme", { name: "Cross-tenant" }))).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    // Acme's tenant client cannot see or change Globex's subscription.
    const acmeDb = getTenantDb(acme.id);
    expect(await acmeDb.subscription.findFirst()).toBeNull();
    await expect(
      acmeDb.subscription.update({ where: { organizationId: globex.id }, data: { plan: "FREE" } }),
    ).rejects.toThrow();
    expect(
      (await getDb().subscription.findUniqueOrThrow({ where: { organizationId: globex.id } })).plan,
    ).toBe("AGENCY");
  });

  it("the database refuses a paid plan without a Stripe subscription", async () => {
    await expect(
      getDb().subscription.create({
        data: { organizationId: acme.id, plan: "AGENCY", status: "ACTIVE" },
      }),
    ).rejects.toThrow(/Subscription_paid_plan_has_subscription_check|check constraint/i);
  });
});

describe("concurrency", () => {
  it("serializes concurrent creations so they cannot both slip under the limit", async () => {
    await seedClients(acme.id, 4);
    // Hold the organization row lock so both requests are queued behind it,
    // then release: they must run one after the other.
    const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM "Organization" WHERE id = $1 FOR UPDATE`, [acme.id]);
      const first = createClient("Racer A");
      const second = createClient("Racer B");
      await new Promise((resolve) => setTimeout(resolve, 300));
      await holder.query("COMMIT");
      const results = await Promise.all([first, second]);
      expect(results.filter((result) => result.ok).length).toBe(1);
      expect(results.filter((result) => !result.ok)).toMatchObject([
        { error: { details: { resource: "clients", limit: 5 } } },
      ]);
    } finally {
      await holder.end();
    }
    expect(await activeClients(acme.id)).toBe(5);
  });
});
