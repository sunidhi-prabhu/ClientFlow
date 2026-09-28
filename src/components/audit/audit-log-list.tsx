import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { AUDIT_RESOURCE_LABELS, type AuditResourceType, auditActionLabel } from "@/lib/audit";
import { cn } from "@/lib/utils";

import { type AuditEntry, auditSummary, resourceHref, resourceName } from "./audit-format";

const timeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

const SECURITY_ACTIONS = new Set([
  "auth.login_failed",
  "auth.verification_failed",
  "auth.password_change_failed",
  "member.role_changed",
  "member.removed",
]);

function resourceTypeLabel(type: string) {
  return Object.hasOwn(AUDIT_RESOURCE_LABELS, type)
    ? AUDIT_RESOURCE_LABELS[type as AuditResourceType]
    : type;
}

/** Audit records, newest first. Each row: when, who, what, which resource, details. */
export function AuditLogList({ entries, basePath }: { entries: AuditEntry[]; basePath: string }) {
  return (
    <ol aria-label="Audit log entries" className="divide-y rounded-xl border">
      {entries.map((entry) => {
        const name = resourceName(entry);
        const href = resourceHref(entry, basePath);
        const facts = auditSummary(entry);
        return (
          <li
            key={entry.id}
            className="grid gap-2 p-4 md:grid-cols-[11rem_minmax(0,12rem)_minmax(0,1fr)] md:gap-4"
          >
            <time
              dateTime={entry.createdAt.toISOString()}
              className="text-xs text-muted-foreground tabular-nums md:pt-0.5"
            >
              {timeFormat.format(entry.createdAt)} UTC
            </time>
            <div className="min-w-0 text-sm">
              {entry.actor ? (
                <>
                  <p className="truncate font-medium">{entry.actor.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{entry.actor.email}</p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {entry.actorUserId === null &&
                  (entry.action === "auth.login_failed" ||
                    entry.action === "auth.verification_failed")
                    ? "Unauthenticated"
                    : "Deleted user or system"}
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={cn(
                    SECURITY_ACTIONS.has(entry.action) && "bg-destructive/10 text-destructive",
                  )}
                >
                  {auditActionLabel(entry.action)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {resourceTypeLabel(entry.resourceType)}
                </span>
                {name &&
                  (href ? (
                    <Link href={href} className="truncate text-sm font-medium hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium">{name}</span>
                  ))}
              </div>
              {facts.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {facts.map((fact) => (
                    <li key={fact} className="break-all">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Details
                </summary>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Action</dt>
                  <dd className="font-mono">{entry.action}</dd>
                  <dt className="text-muted-foreground">Resource id</dt>
                  <dd className="font-mono break-all">{entry.resourceId ?? "—"}</dd>
                  <dt className="text-muted-foreground">Record id</dt>
                  <dd className="font-mono break-all">{entry.id}</dd>
                </dl>
                <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
