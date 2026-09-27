import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import { createOrganization } from "@/server/organizations/bootstrap";
import { getTenantContext, resolveTenantContext } from "@/server/tenancy/context";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

let ada: Awaited<ReturnType<typeof createVerifiedUser>>;
let grace: Awaited<ReturnType<typeof createVerifiedUser>>;
let acme: { id: string; slug: string };
let globex: { id: string; slug: string };

beforeEach(async () => {
  ada = await createVerifiedUser("ada@example.com");
  grace = await createVerifiedUser("grace@example.com");
  acme = await createOrganization(ada.userId, { name: "Acme", slug: "acme" });
  globex = await createOrganization(grace.userId, { name: "Globex", slug: "globex" });
  actAs(ada.cookie);
});

describe("getTenantContext", () => {
  it("resolves user, organization, membership and role from the session and database", async () => {
    const ctx = await getTenantContext("acme");
    const membership = await getDb().membership.findFirstOrThrow({
      where: { organizationId: acme.id, userId: ada.userId },
    });

    expect(ctx).toEqual({
      userId: ada.userId,
      organization: { id: acme.id, slug: "acme", name: "Acme" },
      membership: { id: membership.id, role: "OWNER" },
      role: "OWNER",
    });
  });

  it("reflects the role stored on the membership", async () => {
    await getDb().membership.create({
      data: { organizationId: globex.id, userId: ada.userId, role: "MANAGER" },
    });
    await expect(getTenantContext("globex")).resolves.toMatchObject({
      userId: ada.userId,
      organization: { id: globex.id },
      role: "MANAGER",
    });
  });

  it("rejects an organization the user is not a member of (404)", async () => {
    const error = await getTenantContext("globex").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ message: "Organization not found" });
  });

  it("treats a nonexistent organization exactly like one the user cannot access", async () => {
    const missing = await getTenantContext("no-such-org").catch((caught: unknown) => caught);
    const foreign = await getTenantContext("globex").catch((caught: unknown) => caught);
    expect(missing).toBeInstanceOf(NotFoundError);
    expect(missing).toMatchObject({
      code: (foreign as NotFoundError).code,
      message: (foreign as NotFoundError).message,
    });
  });

  it.each(["", "ACME!", "../acme", "acme; DROP TABLE", "a", 42, null])(
    "rejects a malformed organization selector %j",
    async (selector) => {
      await expect(resolveTenantContext(ada.userId, selector)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    },
  );

  it("does not accept an organization id in place of the slug", async () => {
    await expect(getTenantContext(globex.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a user without any membership has no tenant context", async () => {
    const newcomer = await createVerifiedUser("newcomer@example.com");
    actAs(newcomer.cookie);
    await expect(getTenantContext("acme")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requires an authenticated session (401)", async () => {
    actAs(undefined);
    await expect(getTenantContext("acme")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects an expired session", async () => {
    await getDb().session.updateMany({
      where: { userId: ada.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(getTenantContext("acme")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("stops working as soon as the membership is removed", async () => {
    await getDb().membership.create({
      data: { organizationId: globex.id, userId: ada.userId, role: "MEMBER" },
    });
    await expect(getTenantContext("globex")).resolves.toMatchObject({ role: "MEMBER" });

    await getDb().membership.deleteMany({
      where: { organizationId: globex.id, userId: ada.userId },
    });
    await expect(getTenantContext("globex")).rejects.toBeInstanceOf(NotFoundError);
  });
});
