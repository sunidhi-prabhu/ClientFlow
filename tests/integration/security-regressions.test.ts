import { beforeEach, describe, expect, it, vi } from "vitest";

import { signUpAction } from "@/app/(auth)/actions";
import { getDb } from "@/lib/db";
import { TenantIsolationError } from "@/lib/errors";
import { createOrganization } from "@/server/organizations/bootstrap";
import { getTenantDb } from "@/server/tenancy";

import { authFetch, createVerifiedUser, PASSWORD, signUp } from "./support/auth";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);

/*
 * Regression tests for the security audit findings that are fixed in code.
 * (Rate limiting of the auth Server Actions: auth-rate-limit.test.ts;
 * member authorization inside the ownership service: audit.test.ts;
 * database privileges: database-privileges.test.ts.)
 */

let acme: { id: string };
let owner: { userId: string; cookie: string };

beforeEach(async () => {
  owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
});

describe("L5: display names are limited on every endpoint that sets them", () => {
  const long = "A".repeat(5_000);

  it("rejects an oversized name on the Better Auth sign-up endpoint", async () => {
    const response = await authFetch("/sign-up/email", {
      body: { email: "big@example.com", password: PASSWORD, name: long },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_NAME" });
    expect(await getDb().user.findUnique({ where: { email: "big@example.com" } })).toBeNull();
  });

  it("rejects an oversized or blank name on update-user", async () => {
    for (const name of [long, "   "]) {
      const response = await authFetch("/update-user", { cookie: owner.cookie, body: { name } });
      expect(response.status).toBe(400);
    }
    expect((await getDb().user.findUniqueOrThrow({ where: { id: owner.userId } })).name).toBe(
      "Test User",
    );
    // Normal updates still work.
    const ok = await authFetch("/update-user", { cookie: owner.cookie, body: { name: "Ada" } });
    expect(ok.status).toBe(200);
  });

  it("still accepts a normal sign-up (HTTP and Server Action)", async () => {
    expect((await signUp("normal@example.com")).status).toBe(200);
    actAs(undefined);
    const result = await signUpAction({
      name: "Grace",
      email: "grace@example.com",
      password: PASSWORD,
    }).catch((error: { digest?: string }) => error.digest);
    expect(result).toMatch(/^NEXT_REDIRECT;.*verify-email/);
    expect(await getDb().user.count({ where: { email: "grace@example.com" } })).toBe(1);
  });
});

describe("L1: the tenant client cannot reach credentials or other organizations through User", () => {
  it("rejects nested reads of sessions, accounts and the user's other memberships", async () => {
    await createOrganization(owner.userId, { name: "Other", slug: "other" });
    const db = getTenantDb(acme.id);
    await expect(
      db.membership.findMany({ include: { user: { include: { sessions: true } } } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      db.membership.findMany({ include: { user: { include: { accounts: true } } } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      db.membership.findMany({
        select: { user: { select: { memberships: { select: { organizationId: true } } } } },
      }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      db.auditLog.findMany({ include: { actor: { include: { auditLogs: true } } } }),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it("still returns member names and emails", async () => {
    const members = await getTenantDb(acme.id).membership.findMany({
      select: { role: true, user: { select: { name: true, email: true } } },
    });
    expect(members).toEqual([
      { role: "OWNER", user: { name: "Test User", email: "owner@example.com" } },
    ]);
  });
});

describe("L3: failed verification codes and failed password changes are audited", () => {
  it("records a wrong verification code for an existing account", async () => {
    await signUp("pending@example.com");
    const pending = await getDb().user.findUniqueOrThrow({
      where: { email: "pending@example.com" },
    });
    await getDb().membership.create({
      data: { organizationId: acme.id, userId: pending.id, role: "MEMBER" },
    });
    const response = await authFetch("/email-otp/verify-email", {
      body: { email: "pending@example.com", otp: "000000" },
    });
    expect(response.status).toBe(400);
    const [failed] = await getDb().auditLog.findMany({
      where: { organizationId: acme.id, action: "auth.verification_failed" },
    });
    expect(failed).toMatchObject({
      actorUserId: null,
      resourceId: pending.id,
      metadata: expect.objectContaining({ email: "pending@example.com", reason: "INVALID_OTP" }),
    });
    expect(JSON.stringify(failed.metadata)).not.toContain("000000");
  });

  it("records a wrong current password on change-password without storing it", async () => {
    const response = await authFetch("/change-password", {
      cookie: owner.cookie,
      body: { currentPassword: "not-my-password-77", newPassword: "another-password-88" },
    });
    expect(response.status).toBe(400);
    const [failed] = await getDb().auditLog.findMany({
      where: { organizationId: acme.id, action: "auth.password_change_failed" },
    });
    expect(failed).toMatchObject({ actorUserId: owner.userId, resourceId: owner.userId });
    const stored = JSON.stringify(await getDb().auditLog.findMany());
    expect(stored).not.toContain("not-my-password-77");
    expect(stored).not.toContain("another-password-88");
  });
});
