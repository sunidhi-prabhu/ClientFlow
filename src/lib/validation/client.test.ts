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
