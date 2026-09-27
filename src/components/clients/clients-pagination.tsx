import { ListPagination } from "@/components/shared/list-pagination";

import { clientsListHref, type ClientsListParams } from "./clients-url";

/** Client list pagination; page links keep the current search and filters. */
export function ClientsPagination({
  basePath,
  params,
  ...pagination
}: {
  basePath: string;
  params: ClientsListParams;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  return (
    <ListPagination
      {...pagination}
      hrefForPage={(page) => clientsListHref(basePath, { ...params, page })}
    />
  );
}
