import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { modelPolicies } from "@/server/tenancy/models";

describe("modelPolicies", () => {
  it("classifies every model in the Prisma schema", () => {
    expect(Object.keys(modelPolicies).sort()).toEqual(Object.values(Prisma.ModelName).sort());
  });

  it("marks exactly the models with an organizationId column as tenant-owned", () => {
    for (const [model, policy] of Object.entries(modelPolicies)) {
      const hasOrganizationId = Object.hasOwn(policy.scalarFields, "organizationId");
      expect({ model, tenant: policy.scope === "tenant" }).toEqual({
        model,
        tenant: hasOrganizationId,
      });
    }
  });
});

describe("USER_RELATION_FIELDS", () => {
  it("names every relation from a tenant model to User, and nothing else", async () => {
    const { readFileSync } = await import("node:fs");
    const { USER_RELATION_FIELDS } = await import("@/server/tenancy/models");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const toUser = new Set<string>();
    const otherRelations = new Set<string>();
    for (const [, model, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      if (modelPolicies[model as keyof typeof modelPolicies]?.scope === "global") continue;
      for (const [, field, type] of body.matchAll(/^\s+(\w+)\s+(\w+)(?:\[\]|\?)?\s+@relation/gm)) {
        (type === "User" ? toUser : otherRelations).add(field);
      }
    }
    expect([...toUser].sort()).toEqual([...USER_RELATION_FIELDS].sort());
    for (const field of USER_RELATION_FIELDS) expect(otherRelations.has(field)).toBe(false);
  });
});
