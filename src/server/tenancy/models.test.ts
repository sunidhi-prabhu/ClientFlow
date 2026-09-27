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
