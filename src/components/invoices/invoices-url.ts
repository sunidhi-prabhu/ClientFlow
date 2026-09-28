import { type InvoiceSort, type InvoiceStatusFilter } from "@/lib/validation/invoice";

export type InvoicesListParams = {
  q?: string;
  status?: InvoiceStatusFilter;
  clientId?: string;
  sort?: InvoiceSort;
  page?: number;
};

/** URL of the invoice list with only non-default parameters. */
export function invoicesListHref(basePath: string, params: InvoicesListParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.clientId) search.set("clientId", params.clientId);
  if (params.sort && params.sort !== "newest") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
