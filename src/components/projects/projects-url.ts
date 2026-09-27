import { type ProjectSort, type ProjectStatusFilter } from "@/lib/validation/project";

export type ProjectsListParams = {
  q?: string;
  status?: ProjectStatusFilter;
  clientId?: string;
  sort?: ProjectSort;
  page?: number;
};

/** URL of the project list with only non-default parameters. */
export function projectsListHref(basePath: string, params: ProjectsListParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status && params.status !== "current") search.set("status", params.status);
  if (params.clientId) search.set("clientId", params.clientId);
  if (params.sort && params.sort !== "name") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
