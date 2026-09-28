import { describe, expect, it } from "vitest";

import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  auditActionLabel,
  sanitizeAuditMetadata,
} from "./audit";
import { parseListAuditLogQuery } from "./validation/audit";

describe("sanitizeAuditMetadata", () => {
  it("drops credential-like keys at any depth", () => {
    const cleaned = sanitizeAuditMetadata({
      email: "ada@example.com",
      password: "hunter2hunter2",
      newPassword: "x",
      currentPassword: "y",
      token: "t",
      sessionToken: "s",
      accessToken: "a",
      apiKey: "k",
      api_key: "k2",
      secret: "s",
      clientSecret: "c",
      authorization: "Bearer x",
      cookie: "better-auth.session_token=abc",
      otp: "123456",
      code: "654321",
      passwordHash: "scrypt$...",
      nested: { deeper: [{ refreshToken: "r", keep: "yes" }], privateKey: "p" },
    });
    expect(cleaned).toEqual({ email: "ada@example.com", nested: { deeper: [{ keep: "yes" }] } });
    expect(JSON.stringify(cleaned)).not.toMatch(/hunter2|Bearer|abc|123456|654321|scrypt/);
  });

  it("keeps ordinary context and makes it JSON-safe", () => {
    expect(
      sanitizeAuditMetadata({
        name: "Acme",
        totalCents: 12_345,
        paid: true,
        dueDate: new Date("2026-09-30T00:00:00Z"),
        missing: undefined,
        infinite: Number.POSITIVE_INFINITY,
        fn: () => 1,
        changes: { status: { from: "ACTIVE", to: "ARCHIVED" } },
      }),
    ).toEqual({
      name: "Acme",
      totalCents: 12_345,
      paid: true,
      dueDate: "2026-09-30T00:00:00.000Z",
      infinite: null,
      changes: { status: { from: "ACTIVE", to: "ARCHIVED" } },
    });
  });

  it("limits sizes so metadata cannot grow without bound", () => {
    const cleaned = sanitizeAuditMetadata({
      long: "x".repeat(2_000),
      list: Array.from({ length: 200 }, (_, index) => index),
      deep: { a: { b: { c: { d: { e: { f: "too deep" } } } } } },
    });
    expect((cleaned.long as string).length).toBe(501);
    expect(cleaned.list).toHaveLength(50);
    expect(JSON.stringify(cleaned.deep)).not.toContain("too deep");
  });

  it("returns an empty object for nothing", () => {
    expect(sanitizeAuditMetadata(undefined)).toEqual({});
  });
});

describe("audit vocabulary", () => {
  it("uses <resource>.<verb> names (the database CHECK) and known resource types", () => {
    for (const [action, { resourceType }] of Object.entries(AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(AUDIT_RESOURCE_TYPES).toContain(resourceType);
    }
  });

  it("labels known actions and passes unknown ones through", () => {
    expect(auditActionLabel("member.role_changed")).toBe("Role changed");
    expect(auditActionLabel("something.else")).toBe("something.else");
  });
});

describe("parseListAuditLogQuery", () => {
  it("parses valid filters", () => {
    expect(
      parseListAuditLogQuery({
        from: "2026-09-01",
        to: "2026-09-28",
        actorId: "user_123",
        action: "client.created",
        resourceType: "client",
        page: "3",
      }),
    ).toEqual({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-09-28T00:00:00Z"),
      actorId: "user_123",
      action: "client.created",
      resourceType: "client",
      page: 3,
      pageSize: 25,
    });
  });

  it("ignores invalid values instead of failing", () => {
    expect(
      parseListAuditLogQuery({
        from: "yesterday",
        to: "2026-13-45",
        actorId: "' OR 1=1 --",
        action: "client.hacked",
        resourceType: "session",
        page: "-2",
        pageSize: "100000",
        organizationId: "org_other",
      }),
    ).toEqual({
      from: undefined,
      to: undefined,
      actorId: undefined,
      action: undefined,
      resourceType: undefined,
      page: 1,
      pageSize: 25,
    });
  });
});
