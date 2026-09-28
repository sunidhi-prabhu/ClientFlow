import { type AuditResourceType } from "@/lib/audit";

/** One audit record as the page receives it. */
export type AuditEntry = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: Date;
  actorUserId: string | null;
  actor: { name: string; email: string } | null;
};

type Metadata = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const record = (value: unknown): Metadata =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Metadata) : {};

function metadataOf(entry: AuditEntry): Metadata {
  return record(entry.metadata);
}

/** Human name of the affected resource, captured when the event was recorded. */
export function resourceName(entry: AuditEntry): string | undefined {
  const metadata = metadataOf(entry);
  const member = record(metadata.member);
  return (
    text(metadata.name) ??
    text(metadata.title) ??
    text(metadata.label) ??
    text(member.name) ??
    text(member.email) ??
    text(metadata.email)
  );
}

/** Link to the resource inside the organization, when it has a page. */
export function resourceHref(entry: AuditEntry, basePath: string): string | undefined {
  const id = entry.resourceId;
  if (!id) return undefined;
  switch (entry.resourceType as AuditResourceType) {
    case "client":
      return `${basePath}/clients/${id}`;
    case "project":
      return `${basePath}/projects/${id}`;
    case "invoice":
      return `${basePath}/invoices/${id}`;
    case "task": {
      const projectId = text(metadataOf(entry).projectId);
      return projectId && entry.action !== "task.deleted"
        ? `${basePath}/projects/${projectId}/tasks/${id}`
        : undefined;
    }
    default:
      return undefined;
  }
}

function fromTo(value: unknown): string | undefined {
  const change = record(value);
  if (!("from" in change) && !("to" in change)) return undefined;
  const show = (side: unknown) => text(side) ?? text(record(side).name) ?? "none";
  return `${show(change.from)} → ${show(change.to)}`;
}

/** Short, readable facts about the event (the full metadata is shown on demand). */
export function auditSummary(entry: AuditEntry): string[] {
  const metadata = metadataOf(entry);
  const facts: string[] = [];

  const role = typeof metadata.role === "string" ? metadata.role : fromTo(metadata.role);
  if (role) facts.push(`Role: ${role}`);
  const permissions = record(metadata.permissions);
  const granted = Array.isArray(permissions.granted) ? permissions.granted.length : 0;
  const revoked = Array.isArray(permissions.revoked) ? permissions.revoked.length : 0;
  if (granted || revoked) facts.push(`Permissions: +${granted} / −${revoked}`);

  const status = fromTo(metadata.status);
  if (status) facts.push(`Status: ${status}`);
  const assignee = fromTo(metadata.assignee);
  if (assignee) facts.push(`Assignee: ${assignee}`);

  const changes = Object.keys(record(metadata.changes));
  if (changes.length > 0) facts.push(`Changed: ${changes.join(", ")}`);

  const method = text(metadata.method);
  if (method) facts.push(`Method: ${method.replaceAll("_", " ")}`);
  const reason = text(metadata.reason);
  if (reason) facts.push(`Reason: ${reason.toLowerCase().replaceAll("_", " ")}`);
  const email = entry.action === "auth.login_failed" ? text(metadata.email) : undefined;
  if (email) facts.push(`Account: ${email}`);
  const ip = text(metadata.ip);
  if (ip) facts.push(`IP: ${ip}`);

  return facts;
}
