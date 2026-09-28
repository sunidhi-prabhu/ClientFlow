export type AuditLogParams = {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  page?: number;
};

/** URL of the audit log with only the filters that are set. */
export function auditLogHref(basePath: string, params: AuditLogParams): string {
  const search = new URLSearchParams();
  for (const key of ["from", "to", "actorId", "action", "resourceType"] as const) {
    const value = params[key];
    if (value) search.set(key, value);
  }
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
