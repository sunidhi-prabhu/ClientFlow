import { describe, expect, it } from "vitest";

import { createClientInput, updateClientInput } from "@/lib/validation/client";

describe("client input validation", () => {
  it("trims, lowercases email, and turns blanks into null", () => {
    expect(
      createClientInput.parse({ name: " Acme ", email: " Hi@Acme.COM", company: "  ", notes: "" }),
    ).toEqual({
      name: "Acme",
      company: null,
      email: "hi@acme.com",
      phone: null,
      address: null,
      notes: null,
      status: "ACTIVE",
    });
  });

  it("strips fields the client may not set", () => {
    const parsed = createClientInput.parse({
      name: "Acme",
      organizationId: "org_other",
      id: "forced-id",
      archivedAt: "2020-01-01",
    });
    expect(parsed).not.toHaveProperty("organizationId");
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("archivedAt");
  });

  it("does not allow ARCHIVED as an editable status", () => {
    expect(createClientInput.safeParse({ name: "Acme", status: "ARCHIVED" }).success).toBe(false);
  });

  it("limits lengths", () => {
    expect(createClientInput.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(createClientInput.safeParse({ name: "x", notes: "x".repeat(5001) }).success).toBe(false);
  });

  it("requires an id for updates", () => {
    expect(updateClientInput.safeParse({ name: "Acme" }).success).toBe(false);
  });
});

describe("phone numbers", () => {
  const phone = (value: string) => createClientInput.safeParse({ name: "Acme", phone: value });

  it.each([
    "+91 98765 43210",
    "+1 (555) 010-2000",
    "9876543210",
    "020 7946 0958",
    "+44.20.7946.0958",
  ])("accepts %j", (value) => {
    expect(phone(value)).toMatchObject({ success: true, data: { phone: value } });
  });

  it("counts digits, not formatting: 15 digits pass, 16 do not", () => {
    expect(phone("+123 456 789 012 345").success).toBe(true);
    const tooLong = phone("+1234 5678 9012 3456");
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]).toMatchObject({
      path: ["phone"],
      message: "Enter 7–15 digits, including the country code",
    });
  });

  it.each(["123456", "12345678901234567890", "98765+43210", "call me", "++91 98765 43210"])(
    "rejects %j",
    (value) => {
      expect(phone(value).success).toBe(false);
    },
  );

  it("still treats an empty phone as no phone", () => {
    expect(phone("  ")).toMatchObject({ success: true, data: { phone: null } });
  });
});

describe("phone error messages", () => {
  it("reports one problem at a time", () => {
    const result = createClientInput.safeParse({ name: "Acme", phone: "call me" });
    expect(result.error?.issues.filter((issue) => issue.path[0] === "phone")).toHaveLength(1);
  });
});
