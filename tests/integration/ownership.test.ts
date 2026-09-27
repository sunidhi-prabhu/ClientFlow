import { beforeEach, describe, expect, it } from "vitest";

import { type MembershipRole } from "@/generated/prisma/enums";
import { errorResponse, toAppError } from "@/lib/api/handle-error";
import { getDb } from "@/lib/db";
import { OwnerRequiredError } from "@/lib/errors";
import { createOrganization } from "@/server/organizations/bootstrap";
import { changeMembershipRole, removeMembership } from "@/server/organizations/ownership";
import { getTenantDb, type TenantDb } from "@/server/tenancy";

import { createVerifiedUser } from "./support/auth";

const OWNER_REQUIRED_BODY = {
  error: {
    code: "CONFLICT",
    message:
      "An organization must always have at least one owner. Make another member an owner first.",
  },
};

let acme: { id: string };
let db: TenantDb;
let owner: { userId: string; membershipId: string };

async function addMember(email: string, role: MembershipRole) {
  const user = await createVerifiedUser(email);
  const membership = await getDb().membership.create({
    data: { organizationId: acme.id, userId: user.userId, role },
  });
  return { userId: user.userId, membershipId: membership.id };
}

async function roles() {
  const memberships = await getDb().membership.findMany({
    where: { organizationId: acme.id },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map(({ role }) => role);
}

beforeEach(async () => {
  const user = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(user.userId, { name: "Acme", slug: "acme" });
  db = getTenantDb(acme.id);
  const membership = await getDb().membership.findFirstOrThrow({
    where: { organizationId: acme.id },
  });
  owner = { userId: user.userId, membershipId: membership.id };
});

describe("last OWNER protection (application check)", () => {
  it("refuses to remove the last OWNER with 409", async () => {
    await addMember("admin@example.com", "ADMIN");
    const error = await removeMembership(db, owner.membershipId).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OwnerRequiredError);
    const response = errorResponse(error);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(OWNER_REQUIRED_BODY);
    expect(await roles()).toEqual(["OWNER", "ADMIN"]);
  });

  it.each(["ADMIN", "MANAGER", "MEMBER"] as const)(
    "refuses to demote the last OWNER to %s with 409",
    async (role) => {
      const error = await changeMembershipRole(db, owner.membershipId, role).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(OwnerRequiredError);
      expect(toAppError(error)).toMatchObject({ status: 409, code: "CONFLICT" });
      expect(await roles()).toEqual(["OWNER"]);
    },
  );

  it("allows demoting or removing an OWNER while another OWNER exists", async () => {
    const second = await addMember("second-owner@example.com", "OWNER");

    await expect(changeMembershipRole(db, owner.membershipId, "ADMIN")).resolves.toMatchObject({
      role: "ADMIN",
    });
    expect(await roles()).toEqual(["ADMIN", "OWNER"]);

    // Now `second` is the only owner and is protected in turn.
    await expect(removeMembership(db, second.membershipId)).rejects.toBeInstanceOf(
      OwnerRequiredError,
    );
  });

  it("transfers ownership: promote the new owner, then demote or remove the old one", async () => {
    const successor = await addMember("successor@example.com", "ADMIN");

    await changeMembershipRole(db, successor.membershipId, "OWNER");
    await changeMembershipRole(db, owner.membershipId, "MEMBER");
    expect(await roles()).toEqual(["MEMBER", "OWNER"]);

    await removeMembership(db, owner.membershipId);
    expect(await roles()).toEqual(["OWNER"]);
  });

  it("does not restrict changes to non-owners", async () => {
    const member = await addMember("member@example.com", "MEMBER");
    await expect(changeMembershipRole(db, member.membershipId, "MANAGER")).resolves.toMatchObject({
      role: "MANAGER",
    });
    await expect(removeMembership(db, member.membershipId)).resolves.toMatchObject({
      id: member.membershipId,
    });
    expect(await roles()).toEqual(["OWNER"]);
  });

  it("cannot touch another organization's owner", async () => {
    const outsider = await createVerifiedUser("outsider@example.com");
    const globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
    const foreignOwner = await getDb().membership.findFirstOrThrow({
      where: { organizationId: globex.id },
    });

    const error = await removeMembership(db, foreignOwner.id).catch((caught: unknown) => caught);
    expect(toAppError(error)).toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(getDb().membership.count({ where: { organizationId: globex.id } })).resolves.toBe(
      1,
    );
  });
});

describe("database trigger backstop maps to 409", () => {
  it("a single statement that bypasses the check (Prisma P2039)", async () => {
    const error = await db.membership
      .update({ where: { id: owner.membershipId }, data: { role: "ADMIN" } })
      .catch((caught: unknown) => caught);
    expect(errorResponse(error).status).toBe(409);
    expect(await errorResponse(error).json()).toEqual(OWNER_REQUIRED_BODY);
    expect(await roles()).toEqual(["OWNER"]);
  });

  it("a transaction that fails at COMMIT (deferred trigger)", async () => {
    const error = await getDb()
      .$transaction(async (tx) => tx.membership.delete({ where: { id: owner.membershipId } }))
      .catch((caught: unknown) => caught);
    expect(toAppError(error)).toBeInstanceOf(OwnerRequiredError);
    expect(await roles()).toEqual(["OWNER"]);
  });

  it("deleting the last owner's user account", async () => {
    const error = await getDb()
      .user.delete({ where: { id: owner.userId } })
      .catch((caught: unknown) => caught);
    expect(toAppError(error)).toBeInstanceOf(OwnerRequiredError);
  });

  it("two concurrent demotions of the only two owners: one succeeds, one gets 409", async () => {
    const second = await addMember("second-owner@example.com", "OWNER");

    const results = await Promise.allSettled([
      changeMembershipRole(db, owner.membershipId, "ADMIN"),
      changeMembershipRole(getTenantDb(acme.id), second.membershipId, "ADMIN"),
    ]);

    const failures = results.filter((result) => result.status === "rejected");
    expect(failures).toHaveLength(1);
    expect(toAppError((failures[0] as PromiseRejectedResult).reason)).toBeInstanceOf(
      OwnerRequiredError,
    );
    expect((await roles()).filter((role) => role === "OWNER")).toHaveLength(1);
  });

  it("unrelated check violations are still reported as 500", async () => {
    const error = new Error("some other check") as Error & { cause: unknown };
    error.name = "DriverAdapterError";
    error.cause = { originalCode: "23514", originalMessage: "new row violates check constraint" };
    expect(toAppError(error)).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});

describe("organization deletion", () => {
  it("deletes the organization with all owners and members, leaving other organizations intact", async () => {
    await addMember("second-owner@example.com", "OWNER");
    await addMember("member@example.com", "MEMBER");
    const outsider = await createVerifiedUser("outsider@example.com");
    const globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });

    await getDb().organization.delete({ where: { id: acme.id } });

    await expect(getDb().organization.findUnique({ where: { id: acme.id } })).resolves.toBeNull();
    await expect(getDb().membership.count({ where: { organizationId: acme.id } })).resolves.toBe(0);
    await expect(getDb().membership.count({ where: { organizationId: globex.id } })).resolves.toBe(
      1,
    );
    // Users are global and survive; the former owner can still sign in and create a new org.
    await expect(getDb().user.count()).resolves.toBe(4);
    await expect(
      createOrganization(owner.userId, { name: "Acme Again", slug: "acme" }),
    ).resolves.toMatchObject({ slug: "acme" });
  });
});
