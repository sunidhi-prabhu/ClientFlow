import { type ClientSort, type ClientStatusFilter } from "@/lib/validation/client";

export type ClientsListParams = {
  q?: string;
  status?: ClientStatusFilter;
  sort?: ClientSort;
  page?: number;
};

/** URL of the client list with only non-default parameters, e.g. `/o/acme/clients?q=x&page=2`. */
export function clientsListHref(basePath: string, params: ClientsListParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status && params.status !== "current") search.set("status", params.status);
  if (params.sort && params.sort !== "name") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
