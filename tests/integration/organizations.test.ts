import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOrganizationAction } from "@/app/(onboarding)/onboarding/actions";
import { getDb } from "@/lib/db";
import { createOrganization } from "@/server/organizations/bootstrap";
import { listUserOrganizations } from "@/server/tenancy/memberships";

import { createVerifiedUser } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

/** Run the real Server Action; a successful call ends in redirect(). */
async function runCreateAction(input: unknown) {
  try {
    return { result: await createOrganizationAction(input), redirectedTo: undefined };
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return { result: undefined, redirectedTo: digest.split(";")[2] };
  }
}

let ada: Awaited<ReturnType<typeof createVerifiedUser>>;

beforeEach(async () => {
  ada = await createVerifiedUser("ada@example.com");
  actAs(ada.cookie);
});

describe("organization bootstrap", () => {
  it("creates the organization and makes the creator its OWNER", async () => {
    const { redirectedTo } = await runCreateAction({ name: "Acme Studio", slug: "acme" });

    expect(redirectedTo).toBe("/o/acme");
    const organization = await getDb().organization.findUniqueOrThrow({
      where: { slug: "acme" },
      include: { memberships: true },
    });
    expect(organization.name).toBe("Acme Studio");
    expect(organization.memberships).toEqual([
      expect.objectContaining({ userId: ada.userId, role: "OWNER" }),
    ]);
  });

  it("derives a slug from the name when none is given", async () => {
    const { redirectedTo } = await runCreateAction({ name: "Ünïcode & Co. Design" });
    expect(redirectedTo).toBe("/o/unicode-co-design");
  });

  it("takes the owner from the session, ignoring identity or role supplied by the client", async () => {
    const other = await createVerifiedUser("mallory@example.com");
    actAs(ada.cookie);

    await runCreateAction({
      name: "Acme",
      slug: "acme",
      userId: other.userId,
      ownerId: other.userId,
      role: "MEMBER",
    });

    const memberships = await getDb().membership.findMany();
    expect(memberships).toEqual([expect.objectContaining({ userId: ada.userId, role: "OWNER" })]);
  });

  it("rejects a duplicate slug with 409 and creates nothing", async () => {
    await runCreateAction({ name: "Acme", slug: "acme" });
    const { result } = await runCreateAction({ name: "Another Acme", slug: "acme" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "That organization URL is already taken",
        details: [{ path: "slug", message: "Already taken" }],
      },
    });
    await expect(getDb().organization.count()).resolves.toBe(1);
    await expect(getDb().membership.count()).resolves.toBe(1);
  });

  it("is atomic: if the membership cannot be created, the organization is rolled back", async () => {
    await expect(createOrganization("no-such-user", { name: "Orphan" })).rejects.toThrow();
    await expect(getDb().organization.count()).resolves.toBe(0);
  });

  it("validates input", async () => {
    const { result } = await runCreateAction({ name: "A", slug: "Not A Slug!" });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    await expect(getDb().organization.count()).resolves.toBe(0);
  });

  it("requires a signed-in user", async () => {
    actAs(undefined);
    const { result } = await runCreateAction({ name: "Acme", slug: "acme" });
    expect(result).toMatchObject({ ok: false, error: { code: "UNAUTHENTICATED" } });
    await expect(getDb().organization.count()).resolves.toBe(0);
  });
});

describe("multiple organizations", () => {
  it("a user can belong to several organizations with different roles", async () => {
    await createOrganization(ada.userId, { name: "Acme", slug: "acme" });
    await createOrganization(ada.userId, { name: "Beta", slug: "beta" });
    const grace = await createVerifiedUser("grace@example.com");
    const gamma = await createOrganization(grace.userId, { name: "Gamma", slug: "gamma" });
    await getDb().membership.create({
      data: { organizationId: gamma.id, userId: ada.userId, role: "MEMBER" },
    });

    await expect(listUserOrganizations(ada.userId)).resolves.toEqual([
      expect.objectContaining({ slug: "acme", role: "OWNER" }),
      expect.objectContaining({ slug: "beta", role: "OWNER" }),
      expect.objectContaining({ slug: "gamma", role: "MEMBER" }),
    ]);
    await expect(listUserOrganizations(grace.userId)).resolves.toEqual([
      expect.objectContaining({ slug: "gamma", role: "OWNER" }),
    ]);
  });

  it("a user cannot be added to the same organization twice", async () => {
    const acme = await createOrganization(ada.userId, { name: "Acme", slug: "acme" });
    await expect(
      getDb().membership.create({
        data: { organizationId: acme.id, userId: ada.userId, role: "MEMBER" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("at least one OWNER (database invariant)", () => {
  async function acmeWithAdmin() {
    const acme = await createOrganization(ada.userId, { name: "Acme", slug: "acme" });
    const grace = await createVerifiedUser("grace@example.com");
    await getDb().membership.create({
      data: { organizationId: acme.id, userId: grace.userId, role: "ADMIN" },
    });
    return { acme, grace };
  }

  it("the last owner cannot be demoted", async () => {
    const { acme } = await acmeWithAdmin();
    await expect(
      getDb().membership.updateMany({
        where: { organizationId: acme.id, userId: ada.userId },
        data: { role: "ADMIN" },
      }),
    ).rejects.toThrow(/must have at least one owner/);
  });

  it("the last owner cannot be removed", async () => {
    const { acme } = await acmeWithAdmin();
    await expect(
      getDb().membership.deleteMany({ where: { organizationId: acme.id, userId: ada.userId } }),
    ).rejects.toThrow(/must have at least one owner/);
  });

  it("the last owner's user account cannot be deleted while the organization exists", async () => {
    await acmeWithAdmin();
    await expect(getDb().user.delete({ where: { id: ada.userId } })).rejects.toThrow(
      /must have at least one owner/,
    );
  });

  it("ownership can be transferred within one transaction", async () => {
    const { acme, grace } = await acmeWithAdmin();
    await getDb().$transaction([
      getDb().membership.updateMany({
        where: { organizationId: acme.id, userId: grace.userId },
        data: { role: "OWNER" },
      }),
      getDb().membership.updateMany({
        where: { organizationId: acme.id, userId: ada.userId },
        data: { role: "MEMBER" },
      }),
    ]);
    await expect(listUserOrganizations(grace.userId)).resolves.toEqual([
      expect.objectContaining({ slug: "acme", role: "OWNER" }),
    ]);
  });

  it("deleting the whole organization is allowed", async () => {
    const { acme } = await acmeWithAdmin();
    await getDb().organization.delete({ where: { id: acme.id } });
    await expect(getDb().membership.count()).resolves.toBe(0);
  });
});
