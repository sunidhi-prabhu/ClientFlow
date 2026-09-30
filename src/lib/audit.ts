/*
 * Audit log vocabulary and metadata sanitizing. Pure (no database) so the
 * audit page's filters and the tests share one list of actions.
 */

export const AUDIT_RESOURCE_TYPES = [
  "user",
  "organization",
  "membership",
  "client",
  "project",
  "task",
  "invoice",
  "billing",
] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export const AUDIT_RESOURCE_LABELS: Record<AuditResourceType, string> = {
  user: "User account",
  organization: "Organization",
  membership: "Member",
  client: "Client",
  project: "Project",
  task: "Task",
  invoice: "Invoice",
  billing: "Billing",
};

/** Every audited action, with its label and the resource type it applies to. */
export const AUDIT_ACTIONS = {
  "auth.login": { label: "Signed in", resourceType: "user" },
  "auth.logout": { label: "Signed out", resourceType: "user" },
  "auth.login_failed": { label: "Failed sign-in", resourceType: "user" },
  "auth.verification_failed": { label: "Failed email verification", resourceType: "user" },
  "auth.password_changed": { label: "Password changed", resourceType: "user" },
  "auth.password_change_failed": { label: "Failed password change", resourceType: "user" },
  "auth.password_reset": { label: "Password reset", resourceType: "user" },
  "organization.created": { label: "Organization created", resourceType: "organization" },
  "member.added": { label: "Member added", resourceType: "membership" },
  "member.role_changed": { label: "Role changed", resourceType: "membership" },
  "member.removed": { label: "Member removed", resourceType: "membership" },
  "client.created": { label: "Client created", resourceType: "client" },
  "client.updated": { label: "Client updated", resourceType: "client" },
  "client.archived": { label: "Client archived", resourceType: "client" },
  "client.restored": { label: "Client restored", resourceType: "client" },
  "project.created": { label: "Project created", resourceType: "project" },
  "project.updated": { label: "Project updated", resourceType: "project" },
  "project.status_changed": { label: "Project status changed", resourceType: "project" },
  "project.archived": { label: "Project archived", resourceType: "project" },
  "project.restored": { label: "Project restored", resourceType: "project" },
  "project.member_added": { label: "Added to project", resourceType: "project" },
  "project.member_removed": { label: "Removed from project", resourceType: "project" },
  "task.assigned": { label: "Task assigned", resourceType: "task" },
  "task.unassigned": { label: "Task unassigned", resourceType: "task" },
  "task.deleted": { label: "Task deleted", resourceType: "task" },
  "invoice.created": { label: "Invoice created", resourceType: "invoice" },
  "invoice.issued": { label: "Invoice issued", resourceType: "invoice" },
  "invoice.paid": { label: "Invoice marked paid", resourceType: "invoice" },
  "invoice.cancelled": { label: "Invoice cancelled", resourceType: "invoice" },
  "billing.checkout_started": { label: "Checkout started", resourceType: "billing" },
  "billing.plan_change_requested": { label: "Plan change requested", resourceType: "billing" },
  "billing.cancellation_requested": { label: "Cancellation requested", resourceType: "billing" },
  "billing.cancellation_withdrawn": { label: "Cancellation withdrawn", resourceType: "billing" },
  "billing.subscription_activated": { label: "Subscription activated", resourceType: "billing" },
  "billing.plan_changed": { label: "Plan changed", resourceType: "billing" },
  "billing.subscription_status_changed": {
    label: "Subscription status changed",
    resourceType: "billing",
  },
  "billing.subscription_cancelled": { label: "Subscription cancelled", resourceType: "billing" },
  "billing.payment_failed": { label: "Payment failed", resourceType: "billing" },
} as const satisfies Record<string, { label: string; resourceType: AuditResourceType }>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_NAMES = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function auditActionLabel(action: string): string {
  return Object.hasOwn(AUDIT_ACTIONS, action) ? AUDIT_ACTIONS[action as AuditAction].label : action;
}

export type AuditMetadataValue =
  string | number | boolean | null | AuditMetadataValue[] | { [key: string]: AuditMetadataValue };
export type AuditMetadata = { [key: string]: AuditMetadataValue };

/**
 * Keys that may hold credentials. Matching keys are dropped (at any depth),
 * so a secret can never reach the audit log even if a caller passes it by
 * mistake.
 */
const SECRET_KEY =
  /pass(word|phrase)?|secret|token|api[-_]?key|authorization|cookie|session|otp|^code$|hash|credential|private[-_]?key|signature/i;

const MAX_DEPTH = 5;
const MAX_STRING = 500;
const MAX_ITEMS = 50;

function clean(value: unknown, depth: number): AuditMetadataValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => clean(item, depth + 1))
      .filter((item): item is AuditMetadataValue => item !== undefined);
  }
  if (typeof value === "object") {
    const result: AuditMetadata = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) {
      if (SECRET_KEY.test(key)) continue;
      const cleaned = clean(item, depth + 1);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  // Functions, symbols, bigints, undefined: not recorded.
  return undefined;
}

/** JSON-safe, size-limited copy of `metadata` without any credential-like keys. */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): AuditMetadata {
  const cleaned = clean(metadata ?? {}, 0);
  return cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) ? cleaned : {};
}
