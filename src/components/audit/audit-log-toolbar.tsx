"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_LABELS,
  AUDIT_RESOURCE_TYPES,
  type AuditAction,
} from "@/lib/audit";

import { auditLogHref, type AuditLogParams } from "./audit-url";

type Filters = Required<Omit<AuditLogParams, "page">>;

const sameFilters = (a: Filters, b: Filters) =>
  (Object.keys(a) as (keyof Filters)[]).every((key) => a[key] === b[key]);

/** Filters for the audit log, kept in the URL (changing one returns to page 1). */
export function AuditLogToolbar({
  basePath,
  filters,
  actors,
  noActorValue,
}: {
  basePath: string;
  filters: Filters;
  actors: { id: string; name: string; email: string }[];
  /** Filter value for events without an actor (e.g. failed sign-ins). */
  noActorValue: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // The selected values, updated immediately; the URL (props) catches up when
  // the navigation completes. Building each URL from these (not the props)
  // keeps a change made while another is still loading from being lost.
  const [values, setValues] = useState(filters);
  const [synced, setSynced] = useState(filters);
  if (!sameFilters(synced, filters)) {
    setSynced(filters);
    setValues(filters);
  }

  function navigate(next: Partial<Filters>) {
    const merged = { ...values, ...next };
    setValues(merged);
    const href = auditLogHref(basePath, merged);
    startTransition(() => router.replace(href, { scroll: false }));
  }

  const filtered = Object.values(values).some(Boolean);

  return (
    <form
      role="search"
      aria-label="Filter audit log"
      aria-busy={pending}
      action={basePath}
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        navigate({});
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="audit-from">From</Label>
        <Input
          id="audit-from"
          name="from"
          type="date"
          value={values.from}
          max={values.to || undefined}
          onChange={(event) => navigate({ from: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-to">To</Label>
        <Input
          id="audit-to"
          name="to"
          type="date"
          value={values.to}
          min={values.from || undefined}
          onChange={(event) => navigate({ to: event.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-actor">Actor</Label>
        <NativeSelect
          id="audit-actor"
          name="actorId"
          value={values.actorId}
          onChange={(event) => navigate({ actorId: event.target.value })}
        >
          <option value="">Everyone</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name} ({actor.email})
            </option>
          ))}
          <option value={noActorValue}>No signed-in actor</option>
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-action">Action</Label>
        <NativeSelect
          id="audit-action"
          name="action"
          value={values.action}
          onChange={(event) => navigate({ action: event.target.value })}
        >
          <option value="">All actions</option>
          {AUDIT_RESOURCE_TYPES.map((type) => (
            <optgroup key={type} label={AUDIT_RESOURCE_LABELS[type]}>
              {(Object.keys(AUDIT_ACTIONS) as AuditAction[])
                .filter((action) => AUDIT_ACTIONS[action].resourceType === type)
                .map((action) => (
                  <option key={action} value={action}>
                    {AUDIT_ACTIONS[action].label}
                  </option>
                ))}
            </optgroup>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="audit-resource">Resource</Label>
        <NativeSelect
          id="audit-resource"
          name="resourceType"
          value={values.resourceType}
          onChange={(event) => navigate({ resourceType: event.target.value })}
        >
          <option value="">All resources</option>
          {AUDIT_RESOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {AUDIT_RESOURCE_LABELS[type]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {filtered && (
        <div className="flex h-8 items-center">
          <Link href={basePath} className="text-sm font-medium hover:underline">
            Clear filters
          </Link>
        </div>
      )}
      <button type="submit" className="sr-only">
        Apply filters
      </button>
    </form>
  );
}
