import { Prisma } from "@/generated/prisma/client";

/**
 * How each Prisma model is treated by the tenant-scoped client.
 *
 * - `tenant`: owned by one organization via a required `organizationId`.
 *   Every query is scoped to the current organization.
 * - `organization`: the tenant root. A scoped client may only read or update
 *   its own organization row (matched on `id`); create/delete is bootstrap work.
 * - `global`: not organization-owned (e.g. users, sessions). Not reachable
 *   through the tenant client at all; use a dedicated server module.
 */
export type ModelScope = "tenant" | "organization" | "global";

type ModelPolicy = {
  scope: ModelScope;
  /** Scalar columns: the only keys allowed in write `data`. */
  scalarFields: Readonly<Record<string, string>>;
};

/**
 * Every model MUST be listed here. `satisfies` makes adding a model to the
 * schema without classifying it a type error.
 */
export const modelPolicies = {
  Organization: { scope: "organization", scalarFields: Prisma.OrganizationScalarFieldEnum },
  Client: { scope: "tenant", scalarFields: Prisma.ClientScalarFieldEnum },
  Project: { scope: "tenant", scalarFields: Prisma.ProjectScalarFieldEnum },
} satisfies Record<Prisma.ModelName, ModelPolicy>;

export type ModelName = keyof typeof modelPolicies;

export function getModelPolicy(model: string): ModelPolicy | undefined {
  return Object.hasOwn(modelPolicies, model) ? modelPolicies[model as ModelName] : undefined;
}
