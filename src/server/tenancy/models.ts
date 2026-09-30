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
  /** Rows can be created and read but never updated or deleted (e.g. the audit log). */
  appendOnly?: boolean;
};

/**
 * Every model MUST be listed here. `satisfies` makes adding a model to the
 * schema without classifying it a type error.
 */
export const modelPolicies = {
  Organization: { scope: "organization", scalarFields: Prisma.OrganizationScalarFieldEnum },
  Membership: { scope: "tenant", scalarFields: Prisma.MembershipScalarFieldEnum },
  Client: { scope: "tenant", scalarFields: Prisma.ClientScalarFieldEnum },
  ClientActivity: { scope: "tenant", scalarFields: Prisma.ClientActivityScalarFieldEnum },
  Project: { scope: "tenant", scalarFields: Prisma.ProjectScalarFieldEnum },
  ProjectMember: { scope: "tenant", scalarFields: Prisma.ProjectMemberScalarFieldEnum },
  ProjectActivity: { scope: "tenant", scalarFields: Prisma.ProjectActivityScalarFieldEnum },
  Task: { scope: "tenant", scalarFields: Prisma.TaskScalarFieldEnum },
  Invoice: { scope: "tenant", scalarFields: Prisma.InvoiceScalarFieldEnum },
  InvoiceItem: { scope: "tenant", scalarFields: Prisma.InvoiceItemScalarFieldEnum },
  AuditLog: { scope: "tenant", scalarFields: Prisma.AuditLogScalarFieldEnum, appendOnly: true },
  // Billing state: read by the limit checks and the billing page; written from
  // subscription data read back from the payment provider (src/server/billing).
  Subscription: { scope: "tenant", scalarFields: Prisma.SubscriptionScalarFieldEnum },
  // Authentication (Better Auth): accessed only through src/server/auth.
  User: { scope: "global", scalarFields: Prisma.UserScalarFieldEnum },
  Session: { scope: "global", scalarFields: Prisma.SessionScalarFieldEnum },
  Account: { scope: "global", scalarFields: Prisma.AccountScalarFieldEnum },
  Verification: { scope: "global", scalarFields: Prisma.VerificationScalarFieldEnum },
  RateLimit: { scope: "global", scalarFields: Prisma.RateLimitScalarFieldEnum },
  // Processed billing webhook events (idempotency); src/server/billing/sync.ts only.
  BillingEvent: { scope: "global", scalarFields: Prisma.BillingEventScalarFieldEnum },
} satisfies Record<Prisma.ModelName, ModelPolicy>;

export type ModelName = keyof typeof modelPolicies;

export function getModelPolicy(model: string): ModelPolicy | undefined {
  return Object.hasOwn(modelPolicies, model) ? modelPolicies[model as ModelName] : undefined;
}

/**
 * Relation fields of tenant models that point to the global `User` model
 * (Membership.user, *Activity.actor, AuditLog.actor). Through the tenant
 * client they may only select the user's own scalar columns: `User` also
 * leads to sessions and accounts (credentials) and to the user's memberships
 * and activity in other organizations. Kept complete by models.test.ts.
 */
export const USER_RELATION_FIELDS: ReadonlySet<string> = new Set(["user", "actor"]);

/** Columns of `User` that may be read through those relations. */
export const USER_SCALAR_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(Prisma.UserScalarFieldEnum),
);
